import {
  adminClient,
  assertInternalRequest,
  boundedInteger,
  hmacHex,
  jsonResponse,
} from "../_shared/runtime.ts";

function allowedWebhookHosts(): Set<string> {
  return new Set(
    (Deno.env.get("WEBHOOK_ALLOWED_HOSTS") ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

function safeWebhookUrl(rawValue: unknown, hosts: Set<string>): URL {
  const url = new URL(String(rawValue ?? ""));
  const allowed = [...hosts].some(
    (host) =>
      url.hostname.toLowerCase() === host ||
      url.hostname.toLowerCase().endsWith(`.${host}`),
  );
  if (url.protocol !== "https:" || !allowed) {
    throw new Error("Webhook URL must use HTTPS and an allowlisted host");
  }
  url.username = "";
  url.password = "";
  return url;
}

function normalizedEmail(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

async function queueForward(
  supabase: ReturnType<typeof adminClient>,
  job: Record<string, unknown>,
  message: Record<string, unknown> | null,
) {
  if (!message) throw new Error("Source message is unavailable");
  const config =
    job.action_config &&
    typeof job.action_config === "object" &&
    !Array.isArray(job.action_config)
      ? (job.action_config as Record<string, unknown>)
      : {};
  const recipient = normalizedEmail(config.to ?? config.value);
  if (!recipient) throw new Error("Forward action requires a valid recipient");

  let deliveryAccountId =
    typeof config.delivery_account_id === "string"
      ? config.delivery_account_id
      : null;
  if (!deliveryAccountId) {
    const { data: account, error: accountError } = await supabase
      .from("delivery_accounts")
      .select("id")
      .eq("organization_id", job.organization_id)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (accountError) throw accountError;
    deliveryAccountId = account?.id ?? null;
  }
  if (!deliveryAccountId) {
    throw new Error("No active delivery account is configured");
  }

  const prefix = String(config.subject_prefix ?? "Fwd:");
  const subject = `${prefix} ${String(message.subject ?? "")}`.trim();
  const { data: outbound, error: outboundError } = await supabase
    .from("outbound_messages")
    .insert({
      organization_id: job.organization_id,
      delivery_account_id: deliveryAccountId,
      source_message_id: message.id,
      subject,
      text_body: String(message.body_text ?? message.preview ?? ""),
      html_body:
        typeof message.body_html === "string" ? message.body_html : null,
      audience_definition: {
        type: "rule_forward",
        action_job_id: job.id,
      },
      status: "pending",
      scheduled_at: new Date().toISOString(),
      recipient_count: 1,
    })
    .select("id")
    .single();
  if (outboundError) throw outboundError;

  const { error: recipientError } = await supabase
    .from("outbound_recipients")
    .insert({
      organization_id: job.organization_id,
      outbound_message_id: outbound.id,
      email: recipient,
    });
  if (recipientError) throw recipientError;
  return { outbound_message_id: outbound.id, recipient };
}

async function sendWebhook(
  job: Record<string, unknown>,
  message: Record<string, unknown> | null,
) {
  const config =
    job.action_config &&
    typeof job.action_config === "object" &&
    !Array.isArray(job.action_config)
      ? (job.action_config as Record<string, unknown>)
      : {};
  const url = safeWebhookUrl(config.url ?? config.value, allowedWebhookHosts());
  const body = JSON.stringify({
    event: "mailflow.rule_action",
    actionJobId: job.id,
    organizationId: job.organization_id,
    ruleId: job.rule_id,
    message,
    metadata:
      config.metadata &&
      typeof config.metadata === "object" &&
      !Array.isArray(config.metadata)
        ? config.metadata
        : {},
  });
  const signingSecret = Deno.env.get("WEBHOOK_SIGNING_SECRET");
  if (!signingSecret) throw new Error("WEBHOOK_SIGNING_SECRET is not configured");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mailflow-signature": `sha256=${await hmacHex(signingSecret, body)}`,
      "x-mailflow-event": "rule_action",
    },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`Webhook returned HTTP ${response.status}`);
  }
  return { status: response.status, url: url.origin };
}

async function failOrRetry(
  supabase: ReturnType<typeof adminClient>,
  job: Record<string, unknown>,
  error: unknown,
) {
  const attemptCount = boundedInteger(job.attempt_count, 1, 1, 20);
  const maxAttempts = boundedInteger(job.max_attempts, 5, 1, 20);
  const retry = attemptCount < maxAttempts;
  await supabase
    .from("action_jobs")
    .update({
      status: retry ? "pending" : "failed",
      scheduled_at: retry
        ? new Date(Date.now() + 2 ** attemptCount * 60_000).toISOString()
        : job.scheduled_at,
      claimed_by: null,
      claimed_at: null,
      error_message:
        error instanceof Error ? error.message : "Unknown action error",
    })
    .eq("id", job.id);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  try {
    assertInternalRequest(request);
    const payload = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const batchSize = boundedInteger(payload.batchSize, 25, 1, 100);
    const supabase = adminClient();
    const { data: jobs, error: claimError } = await supabase.rpc(
      "claim_action_jobs",
      {
        worker_name: `action-worker-${crypto.randomUUID()}`,
        batch_size: batchSize,
      },
    );
    if (claimError) throw claimError;

    const messageIds = [
      ...new Set(
        (jobs ?? [])
          .map((job) => job.message_id)
          .filter((id): id is string => typeof id === "string"),
      ),
    ];
    const messagesById = new Map<string, Record<string, unknown>>();
    if (messageIds.length > 0) {
      const { data: messages, error: messageError } = await supabase
        .from("messages")
        .select(
          "id, organization_id, sender_email, recipients, subject, preview, body_text, body_html, received_at, category_id, score, tags",
        )
        .in("id", messageIds);
      if (messageError) throw messageError;
      (messages ?? []).forEach((message) =>
        messagesById.set(String(message.id), message),
      );
    }

    const results: Record<string, unknown>[] = [];
    for (const job of jobs ?? []) {
      try {
        const message = job.message_id
          ? messagesById.get(String(job.message_id)) ?? null
          : null;
        let result: Record<string, unknown>;
        if (job.action_type === "send_webhook") {
          result = await sendWebhook(job, message);
        } else if (
          job.action_type === "forward_smtp" ||
          job.action_type === "send_email"
        ) {
          result = await queueForward(supabase, job, message);
        } else if (
          job.action_type === "create_task" ||
          job.action_type === "notify_team"
        ) {
          result = {
            queued_for_integration: true,
            config: job.action_config,
          };
        } else {
          throw new Error(`Unsupported action type: ${job.action_type}`);
        }

        const { error: updateError } = await supabase
          .from("action_jobs")
          .update({
            status: "complete",
            completed_at: new Date().toISOString(),
            result,
            claimed_by: null,
            claimed_at: null,
            error_message: null,
          })
          .eq("id", job.id);
        if (updateError) throw updateError;
        results.push({ id: job.id, status: "complete", result });
      } catch (error) {
        await failOrRetry(supabase, job, error);
        results.push({
          id: job.id,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown action error",
        });
      }
    }

    return jsonResponse(200, {
      ok: true,
      claimed: (jobs ?? []).length,
      completed: results.filter((result) => result.status === "complete").length,
      results,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("action_worker_error", error);
    return jsonResponse(500, {
      ok: false,
      error: error instanceof Error ? error.message : "Unexpected action error",
    });
  }
});
