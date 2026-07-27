import {
  adminClient,
  assertInternalRequest,
  boundedInteger,
  jsonResponse,
} from "../_shared/runtime.ts";

type Condition = {
  id?: string;
  field?: string;
  operator?: string;
  value?: unknown;
};

type Action = {
  id?: string;
  type?: string;
  value?: unknown;
  config?: Record<string, unknown>;
};

type MessageRow = Record<string, unknown> & {
  id: string;
  organization_id: string;
  source_connector_id: string | null;
  sender_email: string;
  recipients: unknown;
  subject: string;
  body_text: string | null;
  body_html: string | null;
  headers: Record<string, unknown> | null;
  status: string;
  score: number;
  tags: string[];
};

const MAX_RULES_PER_RUN = 500;
const MAX_URLS_PER_MESSAGE = 20;

function textValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function normalized(value: unknown): string {
  return textValue(value).trim().toLocaleLowerCase("pl");
}

function extractUrls(value: string): string[] {
  const matches = value.match(/https?:\/\/[^\s<>"')\]}]+/gi) ?? [];
  return [...new Set(matches.map((item) => item.replace(/[.,;:!?]+$/, "")))];
}

function recipientText(value: unknown): string {
  if (!Array.isArray(value)) return textValue(value);
  return value
    .map((recipient) => {
      if (typeof recipient === "string") return recipient;
      if (recipient && typeof recipient === "object" && "email" in recipient) {
        return textValue((recipient as { email?: unknown }).email);
      }
      return "";
    })
    .filter(Boolean)
    .join(", ");
}

function fieldValue(
  condition: Condition,
  message: MessageRow,
  attachments: Record<string, unknown>[],
  source: Record<string, unknown> | undefined,
): unknown {
  const body = `${message.body_text ?? ""}\n${message.body_html ?? ""}`;
  switch (condition.field) {
    case "sender":
      return message.sender_email;
    case "sender_domain":
      return message.sender_email.split("@").at(-1) ?? "";
    case "recipient":
      return recipientText(message.recipients);
    case "subject":
      return message.subject;
    case "body":
      return body;
    case "attachment_name":
      return attachments.map((item) => textValue(item.filename)).join(" ");
    case "attachment_type":
      return attachments.map((item) => textValue(item.content_type)).join(" ");
    case "source":
      return [
        source?.id,
        source?.name,
        source?.type,
        source?.address,
      ]
        .map(textValue)
        .join(" ");
    case "sentiment":
      return message.headers?.sentiment ?? "";
    case "url":
      return extractUrls(body).join(" ");
    case "size":
      return new TextEncoder().encode(body).byteLength;
    default:
      return "";
  }
}

function evaluateCondition(
  condition: Condition,
  actualValue: unknown,
): { matched: boolean; actual: string } {
  const actual = textValue(actualValue);
  const expected = textValue(condition.value);
  const left = normalized(actual);
  const right = normalized(expected);
  let matched = false;

  switch (condition.operator) {
    case "contains":
      matched = right.length > 0 && left.includes(right);
      break;
    case "not_contains":
      matched = right.length > 0 && !left.includes(right);
      break;
    case "equals":
      matched = left === right;
      break;
    case "not_equals":
      matched = left !== right;
      break;
    case "starts_with":
      matched = right.length > 0 && left.startsWith(right);
      break;
    case "ends_with":
      matched = right.length > 0 && left.endsWith(right);
      break;
    case "matches":
      if (expected.length > 0 && expected.length <= 500) {
        try {
          matched = new RegExp(expected, "iu").test(actual.slice(0, 250_000));
        } catch {
          matched = false;
        }
      }
      break;
    case "greater_than":
      matched = Number(actualValue) > Number(condition.value);
      break;
    case "less_than":
      matched = Number(actualValue) < Number(condition.value);
      break;
    case "exists":
      matched = actual.trim().length > 0;
      break;
    default:
      matched = false;
  }

  return { matched, actual: actual.slice(0, 500) };
}

function resolveCategory(
  value: unknown,
  categories: Record<string, unknown>[],
): string | null {
  const target = normalized(value);
  const category = categories.find(
    (item) =>
      normalized(item.id) === target ||
      normalized(item.slug) === target ||
      normalized(item.name) === target,
  );
  return category ? textValue(category.id) : null;
}

function actionConfig(action: Action): Record<string, unknown> {
  return {
    ...(action.config && typeof action.config === "object" ? action.config : {}),
    value: action.value ?? null,
  };
}

async function processOne(
  supabase: ReturnType<typeof adminClient>,
  message: MessageRow,
  rules: Record<string, unknown>[],
  versionsByRule: Map<string, Record<string, unknown>>,
  categories: Record<string, unknown>[],
  attachments: Record<string, unknown>[],
  source: Record<string, unknown> | undefined,
  dryRun: boolean,
) {
  let categoryId =
    typeof message.category_id === "string" ? message.category_id : null;
  let score = boundedInteger(message.score, 0, 0, 100);
  const tags = new Set(
    Array.isArray(message.tags)
      ? message.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
  );
  let finalStatus = "classified";
  let reviewReason: string | null = null;
  let stopProcessing = false;
  const matchedRules: Record<string, unknown>[] = [];
  const scrapeRows: Record<string, unknown>[] = [];
  const actionRows: Record<string, unknown>[] = [];

  for (const rule of rules) {
    if (stopProcessing) break;
    const ruleId = textValue(rule.id);
    const version = versionsByRule.get(ruleId);
    if (!version) continue;

    const conditions = Array.isArray(version.conditions)
      ? (version.conditions as Condition[])
      : [];
    if (conditions.length === 0) continue;

    const conditionResults = conditions.map((condition) => {
      const result = evaluateCondition(
        condition,
        fieldValue(condition, message, attachments, source),
      );
      return {
        id: condition.id ?? null,
        field: condition.field ?? null,
        operator: condition.operator ?? null,
        expected: condition.value ?? null,
        actual: result.actual,
        matched: result.matched,
      };
    });
    const matchMode = version.match_mode === "any" ? "any" : "all";
    const matched =
      matchMode === "any"
        ? conditionResults.some((item) => item.matched)
        : conditionResults.every((item) => item.matched);
    if (!matched) continue;

    const actions = Array.isArray(version.actions)
      ? (version.actions as Action[])
      : [];
    const executedActions: Record<string, unknown>[] = [];
    let scoreDelta = 0;

    for (const action of actions) {
      const type = textValue(action.type);
      const value = action.value;

      if (type === "assign_category") {
        const resolved = resolveCategory(value, categories);
        if (resolved) categoryId = resolved;
      } else if (type === "add_score") {
        const delta = boundedInteger(value, 0, -100, 100);
        scoreDelta += delta;
        score = Math.min(100, Math.max(0, score + delta));
      } else if (type === "add_tag") {
        textValue(value)
          .split(",")
          .map((tag) => tag.trim().toLocaleLowerCase("pl"))
          .filter(Boolean)
          .slice(0, 25)
          .forEach((tag) => tags.add(tag));
      } else if (type === "set_review") {
        finalStatus = "review";
        reviewReason =
          textValue(action.config?.reason) ||
          `Reguła „${textValue(rule.name)}” wymaga weryfikacji.`;
      } else if (type === "archive") {
        finalStatus = "archived";
      } else if (type === "scrape_urls") {
        const urls = extractUrls(
          `${message.body_text ?? ""}\n${message.body_html ?? ""}`,
        ).slice(0, MAX_URLS_PER_MESSAGE);
        urls.forEach((url) => {
          scrapeRows.push({
            organization_id: message.organization_id,
            source_connector_id: message.source_connector_id,
            message_id: message.id,
            url,
            priority: boundedInteger(rule.priority, 50, 0, 1000),
          });
        });
      } else if (
        ["forward_smtp", "send_webhook", "create_task"].includes(type)
      ) {
        actionRows.push({
          organization_id: message.organization_id,
          message_id: message.id,
          rule_id: ruleId,
          action_type: type,
          action_config: actionConfig(action),
          priority: boundedInteger(rule.priority, 50, 0, 1000),
        });
      } else if (type === "stop_processing") {
        stopProcessing = true;
      }

      executedActions.push({
        id: action.id ?? null,
        type,
        value: value ?? null,
      });
    }

    matchedRules.push({
      rule_id: ruleId,
      rule_name: rule.name,
      rule_version: version.version,
      score_delta: scoreDelta,
      condition_results: conditionResults,
      actions_executed: executedActions,
    });
  }

  if (matchedRules.length === 0) {
    finalStatus = "review";
    reviewReason = "Żadna aktywna reguła nie dopasowała wiadomości.";
  } else if (actionRows.length > 0 && finalStatus === "classified") {
    finalStatus = "automated";
  }

  const result = {
    messageId: message.id,
    status: finalStatus,
    categoryId,
    score,
    tags: [...tags].slice(0, 100),
    reviewReason,
    matchedRules,
    queuedActions: actionRows.length,
    queuedScrapes: scrapeRows.length,
  };
  if (dryRun) return result;

  if (matchedRules.length > 0) {
    const { error: matchError } = await supabase
      .from("message_rule_matches")
      .upsert(
        matchedRules.map((match) => ({
          organization_id: message.organization_id,
          message_id: message.id,
          rule_id: match.rule_id,
          rule_version: match.rule_version,
          matched: true,
          score_delta: match.score_delta,
          condition_results: match.condition_results,
          actions_executed: match.actions_executed,
          evaluated_at: new Date().toISOString(),
        })),
        { onConflict: "message_id,rule_id,rule_version" },
      );
    if (matchError) throw matchError;
  }

  if (scrapeRows.length > 0) {
    const { error: scrapeError } = await supabase
      .from("scrape_jobs")
      .insert(scrapeRows);
    if (scrapeError) throw scrapeError;
  }

  if (actionRows.length > 0) {
    const { error: actionError } = await supabase
      .from("action_jobs")
      .insert(actionRows);
    if (actionError) throw actionError;
  }

  const { error: updateError } = await supabase
    .from("messages")
    .update({
      status: finalStatus,
      category_id: categoryId,
      score,
      tags: result.tags,
      review_reason: reviewReason,
      processed_at: new Date().toISOString(),
      claimed_by: null,
      claimed_at: null,
      error_message: null,
    })
    .eq("id", message.id)
    .eq("organization_id", message.organization_id);
  if (updateError) throw updateError;

  for (const match of matchedRules) {
    const { error: hitError } = await supabase.rpc("increment_rule_hits", {
      target_rule_id: match.rule_id,
    });
    if (hitError) console.error("increment_rule_hit_error", hitError);
  }

  return result;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  try {
    assertInternalRequest(request);
    const payload = (await request.json()) as Record<string, unknown>;
    const organizationId = textValue(payload.organizationId);
    const batchSize = boundedInteger(payload.batchSize, 25, 1, 100);
    const dryRun = payload.dryRun === true;
    const requestedIds = Array.isArray(payload.messageIds)
      ? payload.messageIds
          .filter((id): id is string => typeof id === "string")
          .slice(0, 100)
      : [];
    if (!organizationId) {
      return jsonResponse(400, {
        ok: false,
        error: "organizationId is required",
      });
    }

    const supabase = adminClient();
    let messages: MessageRow[] = [];
    if (requestedIds.length > 0) {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("organization_id", organizationId)
        .in("id", requestedIds)
        .limit(batchSize);
      if (error) throw error;
      messages = (data ?? []) as MessageRow[];

      if (!dryRun && messages.length > 0) {
        const { error: claimError } = await supabase
          .from("messages")
          .update({
            status: "processing",
            claimed_by: `process-message-${crypto.randomUUID()}`,
            claimed_at: new Date().toISOString(),
          })
          .eq("organization_id", organizationId)
          .in(
            "id",
            messages.map((message) => message.id),
          );
        if (claimError) throw claimError;
      }
    } else {
      if (dryRun) {
        return jsonResponse(400, {
          ok: false,
          error: "dryRun requires messageIds",
        });
      }
      const { data, error } = await supabase.rpc("claim_pending_messages", {
        target_organization_id: organizationId,
        worker_name: `process-message-${crypto.randomUUID()}`,
        batch_size: batchSize,
      });
      if (error) throw error;
      messages = (data ?? []) as MessageRow[];
    }

    if (messages.length === 0) {
      return jsonResponse(200, {
        ok: true,
        processed: 0,
        results: [],
      });
    }

    const { data: rules, error: rulesError } = await supabase
      .from("rules")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("active", true)
      .order("priority", { ascending: false })
      .limit(MAX_RULES_PER_RUN);
    if (rulesError) throw rulesError;

    const ruleIds = (rules ?? []).map((rule) => String(rule.id));
    const versionsByRule = new Map<string, Record<string, unknown>>();
    if (ruleIds.length > 0) {
      const { data: versions, error: versionsError } = await supabase
        .from("rule_versions")
        .select("*")
        .eq("organization_id", organizationId)
        .in("rule_id", ruleIds);
      if (versionsError) throw versionsError;

      const currentVersions = new Map(
        (rules ?? []).map((rule) => [
          String(rule.id),
          Number(rule.current_version),
        ]),
      );
      (versions ?? []).forEach((version) => {
        if (
          Number(version.version) ===
          currentVersions.get(String(version.rule_id))
        ) {
          versionsByRule.set(String(version.rule_id), version);
        }
      });
    }

    const { data: categories, error: categoryError } = await supabase
      .from("categories")
      .select("id, slug, name, default_score")
      .eq("organization_id", organizationId)
      .eq("active", true);
    if (categoryError) throw categoryError;

    const messageIds = messages.map((message) => message.id);
    const { data: allAttachments, error: attachmentError } = await supabase
      .from("message_attachments")
      .select("message_id, filename, content_type, size_bytes, extracted_text")
      .eq("organization_id", organizationId)
      .in("message_id", messageIds);
    if (attachmentError) throw attachmentError;

    const sourceIds = [
      ...new Set(
        messages
          .map((message) => message.source_connector_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    let sources: Record<string, unknown>[] = [];
    if (sourceIds.length > 0) {
      const { data, error } = await supabase
        .from("source_connectors")
        .select("id, name, type, address")
        .eq("organization_id", organizationId)
        .in("id", sourceIds);
      if (error) throw error;
      sources = data ?? [];
    }

    const attachmentsByMessage = new Map<string, Record<string, unknown>[]>();
    (allAttachments ?? []).forEach((attachment) => {
      const key = String(attachment.message_id);
      attachmentsByMessage.set(key, [
        ...(attachmentsByMessage.get(key) ?? []),
        attachment,
      ]);
    });
    const sourcesById = new Map(
      sources.map((source) => [String(source.id), source]),
    );

    const results: Record<string, unknown>[] = [];
    for (const message of messages) {
      try {
        results.push(
          await processOne(
            supabase,
            message,
            rules ?? [],
            versionsByRule,
            categories ?? [],
            attachmentsByMessage.get(message.id) ?? [],
            message.source_connector_id
              ? sourcesById.get(message.source_connector_id)
              : undefined,
            dryRun,
          ),
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown processing error";
        if (!dryRun) {
          await supabase
            .from("messages")
            .update({
              status: "failed",
              failed_at: new Date().toISOString(),
              error_message: errorMessage,
              claimed_by: null,
              claimed_at: null,
            })
            .eq("id", message.id)
            .eq("organization_id", organizationId);
        }
        results.push({
          messageId: message.id,
          status: "failed",
          error: errorMessage,
        });
      }
    }

    const failed = results.filter((result) => result.status === "failed").length;
    return jsonResponse(failed === results.length ? 500 : 200, {
      ok: failed === 0,
      processed: results.length,
      failed,
      dryRun,
      results,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("process_message_error", error);
    return jsonResponse(500, {
      ok: false,
      error:
        error instanceof Error ? error.message : "Unexpected processing error",
    });
  }
});
