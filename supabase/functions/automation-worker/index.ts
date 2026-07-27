import {
  adminClient,
  assertInternalRequest,
  boundedInteger,
  compactText,
  jsonResponse,
} from "../_shared/runtime.ts";

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const renderString = (
  value: string,
  context: { message: JsonRecord | null; input: JsonRecord },
) =>
  value.replace(
    /\{\{\s*(message|input)\.([a-zA-Z0-9_.-]+)\s*\}\}/g,
    (_match, root: "message" | "input", path: string) => {
      let current: unknown = root === "message" ? context.message : context.input;
      for (const part of path.split(".")) {
        current = asRecord(current)[part];
      }
      return current === null || current === undefined
        ? ""
        : typeof current === "object"
          ? JSON.stringify(current)
          : String(current);
    },
  );

const renderValue = (
  value: unknown,
  context: { message: JsonRecord | null; input: JsonRecord },
): unknown => {
  if (typeof value === "string") return renderString(value, context);
  if (Array.isArray(value)) {
    return value.map((item) => renderValue(item, context));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        renderValue(item, context),
      ]),
    );
  }
  return value;
};

const stepConfiguration = (
  step: JsonRecord,
  context: { message: JsonRecord | null; input: JsonRecord },
) => {
  const source =
    step.config && typeof step.config === "object" && !Array.isArray(step.config)
      ? asRecord(step.config)
      : Object.fromEntries(
          Object.entries(step).filter(([key]) => key !== "type"),
        );
  return asRecord(renderValue(source, context));
};

async function queueAction(
  supabase: ReturnType<typeof adminClient>,
  run: JsonRecord,
  actionType: string,
  config: JsonRecord,
): Promise<JsonRecord> {
  const { data, error } = await supabase
    .from("action_jobs")
    .insert({
      organization_id: run.organization_id,
      message_id: run.message_id ?? null,
      action_type: actionType,
      action_config: config,
      status: "pending",
      priority: boundedInteger(config.priority, 50, 0, 1000),
      scheduled_at: new Date().toISOString(),
      max_attempts: boundedInteger(config.max_attempts, 5, 1, 20),
    })
    .select("id,action_type,status")
    .single();
  if (error) throw error;
  return data as JsonRecord;
}

async function updateMessage(
  supabase: ReturnType<typeof adminClient>,
  run: JsonRecord,
  message: JsonRecord | null,
  patch: JsonRecord,
): Promise<JsonRecord> {
  if (!message || !run.message_id) {
    throw new Error("This automation step requires a source message");
  }
  const { data, error } = await supabase
    .from("messages")
    .update(patch)
    .eq("organization_id", run.organization_id)
    .eq("id", run.message_id)
    .select(
      "id,organization_id,status,category_id,score,tags,subject,sender_email,recipients,preview,body_text,body_html",
    )
    .single();
  if (error) throw error;
  Object.assign(message, data as JsonRecord);
  return data as JsonRecord;
}

async function executeStep(
  supabase: ReturnType<typeof adminClient>,
  run: JsonRecord,
  message: JsonRecord | null,
  input: JsonRecord,
  step: JsonRecord,
): Promise<JsonRecord> {
  const type = String(step.type ?? "");
  const config = stepConfiguration(step, { message, input });
  switch (type) {
    case "set_category":
    case "assign_category": {
      const categoryId = String(
        config.category_id ?? config.value ?? "",
      ).trim();
      if (!categoryId) throw new Error("set_category requires category_id");
      const { data: category, error } = await supabase
        .from("categories")
        .select("id,name")
        .eq("organization_id", run.organization_id)
        .eq("id", categoryId)
        .single();
      if (error) throw error;
      await updateMessage(supabase, run, message, {
        category_id: category.id,
        status: "classified",
      });
      return { category_id: category.id, category_name: category.name };
    }
    case "set_score": {
      const score = boundedInteger(config.score ?? config.value, 0, -100, 100);
      await updateMessage(supabase, run, message, { score });
      return { score };
    }
    case "add_score": {
      const delta = boundedInteger(config.delta ?? config.value, 0, -100, 100);
      const score = Math.min(
        100,
        Math.max(-100, Number(message?.score ?? 0) + delta),
      );
      await updateMessage(supabase, run, message, { score });
      return { delta, score };
    }
    case "add_tag": {
      const tag = compactText(config.tag ?? config.value, 100).trim();
      if (!tag) throw new Error("add_tag requires tag");
      const tags = [
        ...new Set([
          ...(Array.isArray(message?.tags) ? message.tags.map(String) : []),
          tag,
        ]),
      ].slice(0, 50);
      await updateMessage(supabase, run, message, { tags });
      return { tag, tags };
    }
    case "set_review": {
      const reviewReason = compactText(
        config.reason ?? config.value ?? "Automation requested review",
        2000,
      );
      await updateMessage(supabase, run, message, {
        status: "review",
        review_reason: reviewReason,
      });
      return { status: "review", review_reason: reviewReason };
    }
    case "archive": {
      await updateMessage(supabase, run, message, { status: "archived" });
      return { status: "archived" };
    }
    case "send_webhook":
    case "forward_smtp":
    case "send_email":
    case "create_task":
    case "notify_team":
      return queueAction(supabase, run, type, {
        ...config,
        automation_id: run.automation_id,
        automation_run_id: run.id,
      });
    case "delay": {
      const seconds = boundedInteger(
        config.seconds ?? Number(config.minutes ?? 0) * 60,
        60,
        1,
        604800,
      );
      return {
        delayed: true,
        seconds,
        resume_at: new Date(Date.now() + seconds * 1000).toISOString(),
      };
    }
    case "stop":
      return { stopped: true };
    default:
      throw new Error(`Unsupported automation step: ${type || "(empty)"}`);
  }
}

async function processRun(
  supabase: ReturnType<typeof adminClient>,
  run: JsonRecord,
  automation: JsonRecord,
  message: JsonRecord | null,
) {
  const steps = Array.isArray(automation.steps) ? automation.steps : [];
  const input = asRecord(run.input);
  const output = asRecord(run.output);
  const stepResults = Array.isArray(output.steps)
    ? [...output.steps]
    : [];
  let currentStep = boundedInteger(run.current_step, 0, 0, steps.length);

  while (currentStep < steps.length) {
    const step = asRecord(steps[currentStep]);
    const result: JsonRecord = await executeStep(
      supabase,
      run,
      message,
      input,
      step,
    );
    stepResults[currentStep] = {
      type: String(step.type ?? ""),
      completed_at: new Date().toISOString(),
      result,
    };
    currentStep += 1;

    if (result.delayed === true) {
      const resumeAt = String(result.resume_at);
      const { error } = await supabase
        .from("automation_runs")
        .update({
          status: "pending",
          output: { ...output, steps: stepResults },
          current_step: currentStep,
          resume_at: resumeAt,
          claimed_by: null,
          claimed_at: null,
          error_message: null,
        })
        .eq("id", run.id)
        .eq("status", "processing");
      if (error) throw error;
      return { status: "delayed", current_step: currentStep, ...result };
    }
    if (result.stopped === true) break;
  }

  const finalOutput = {
    ...output,
    steps: stepResults,
    completed_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.rpc("finish_automation_run", {
    target_run_id: run.id,
    succeeded: true,
    run_output: finalOutput,
    finished_step: currentStep,
    failure_message: null,
  });
  if (error) throw error;
  return { status: "complete", run: data };
}

async function retryOrFail(
  supabase: ReturnType<typeof adminClient>,
  run: JsonRecord,
  error: unknown,
) {
  const attempt = boundedInteger(run.attempt_count, 1, 1, 20);
  const message =
    error instanceof Error ? error.message : "Unknown automation error";
  if (attempt < 3) {
    const resumeAt = new Date(
      Date.now() + Math.min(2 ** attempt * 30_000, 15 * 60_000),
    ).toISOString();
    const { error: updateError } = await supabase
      .from("automation_runs")
      .update({
        status: "pending",
        resume_at: resumeAt,
        claimed_by: null,
        claimed_at: null,
        error_message: message,
      })
      .eq("id", run.id)
      .eq("status", "processing");
    if (updateError) throw updateError;
    return { status: "retry", resume_at: resumeAt, error: message };
  }

  const { error: finishError } = await supabase.rpc("finish_automation_run", {
    target_run_id: run.id,
    succeeded: false,
    run_output: asRecord(run.output),
    finished_step: boundedInteger(run.current_step, 0, 0, 100),
    failure_message: message,
  });
  if (finishError) throw finishError;
  return { status: "failed", error: message };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  try {
    assertInternalRequest(request);
    const payload = asRecord(await request.json().catch(() => ({})));
    const batchSize = boundedInteger(payload.batchSize, 25, 1, 100);
    const candidateLimit = boundedInteger(
      payload.candidateLimit,
      Math.max(batchSize * 5, 100),
      1,
      1000,
    );
    const supabase = adminClient();

    const { data: enqueued, error: enqueueError } = await supabase.rpc(
      "enqueue_ready_automations",
      { candidate_limit: candidateLimit },
    );
    if (enqueueError) throw enqueueError;

    const { data: runs, error: claimError } = await supabase.rpc(
      "claim_automation_runs",
      {
        worker_name: `automation-worker-${crypto.randomUUID()}`,
        batch_size: batchSize,
      },
    );
    if (claimError) throw claimError;

    const claimedRuns = (runs ?? []) as JsonRecord[];
    const automationIds = [
      ...new Set(claimedRuns.map((run) => String(run.automation_id))),
    ];
    const messageIds = [
      ...new Set(
        claimedRuns
          .map((run) => run.message_id)
          .filter((id): id is string => typeof id === "string"),
      ),
    ];
    const { data: automations, error: automationError } =
      automationIds.length > 0
        ? await supabase
            .from("automations")
            .select("id,organization_id,name,steps,active,version")
            .in("id", automationIds)
        : { data: [], error: null };
    if (automationError) throw automationError;
    const { data: messages, error: messageError } =
      messageIds.length > 0
        ? await supabase
            .from("messages")
            .select(
              "id,organization_id,status,category_id,score,tags,subject,sender_email,recipients,preview,body_text,body_html",
            )
            .in("id", messageIds)
        : { data: [], error: null };
    if (messageError) throw messageError;

    const automationsById = new Map(
      (automations ?? []).map((automation) => [
        String(automation.id),
        automation as JsonRecord,
      ]),
    );
    const messagesById = new Map(
      (messages ?? []).map((message) => [
        String(message.id),
        message as JsonRecord,
      ]),
    );

    const results: JsonRecord[] = [];
    for (const run of claimedRuns) {
      try {
        const automation = automationsById.get(String(run.automation_id));
        if (!automation) throw new Error("Automation definition is unavailable");
        const message = run.message_id
          ? messagesById.get(String(run.message_id)) ?? null
          : null;
        const result = await processRun(
          supabase,
          run,
          automation,
          message,
        );
        results.push({ id: run.id, ...result });
      } catch (error) {
        results.push({
          id: run.id,
          ...(await retryOrFail(supabase, run, error)),
        });
      }
    }

    return jsonResponse(200, {
      ok: true,
      enqueued,
      claimed: claimedRuns.length,
      completed: results.filter((result) => result.status === "complete").length,
      delayed: results.filter((result) => result.status === "delayed").length,
      retried: results.filter((result) => result.status === "retry").length,
      failed: results.filter((result) => result.status === "failed").length,
      results,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("automation_worker_error", error);
    return jsonResponse(500, {
      ok: false,
      error:
        error instanceof Error ? error.message : "Unexpected automation error",
    });
  }
});
