import {
  requireInternalSecret,
  response,
  safeInteger,
  serviceClient,
} from "./_shared/server.mjs";

const authorize = (event) => {
  if (event.next_run) return;
  requireInternalSecret(event);
};

const invokeEdgeFunction = async (name, payload) => {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.WORKER_SECRET;
  if (!url || !secret) {
    throw new Error("Missing SUPABASE_URL or WORKER_SECRET");
  }
  const result = await fetch(`${url}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(22_000),
  });
  const body = await result.json().catch(() => ({
    ok: false,
    error: `Function returned HTTP ${result.status}`,
  }));
  if (!result.ok) {
    throw new Error(`${name}: ${body.error ?? `HTTP ${result.status}`}`);
  }
  return body;
};

export const handler = async (event) => {
  try {
    authorize(event);
    const service = serviceClient();
    const organizationLimit = safeInteger(
      process.env.ORGANIZATIONS_PER_RUN,
      10,
      1,
      50,
    );
    const messageBatchSize = safeInteger(
      process.env.PROCESSING_BATCH_SIZE,
      50,
      1,
      100,
    );
    const { data: queuedMessages, error } = await service
      .from("messages")
      .select("organization_id")
      .eq("status", "new")
      .order("created_at", { ascending: true })
      .limit(1000);
    if (error) throw error;

    const organizationIds = [
      ...new Set((queuedMessages ?? []).map((item) => item.organization_id)),
    ].slice(0, organizationLimit);
    const processing = [];
    for (const organizationId of organizationIds) {
      try {
        processing.push(
          await invokeEdgeFunction("process-message", {
            organizationId,
            batchSize: messageBatchSize,
          }),
        );
      } catch (processingError) {
        processing.push({
          ok: false,
          organizationId,
          error:
            processingError instanceof Error
              ? processingError.message
              : String(processingError),
        });
      }
    }

    const workers = {};
    for (const [name, batchSize] of [
      ["scrape-worker", 10],
      ["action-worker", 25],
    ]) {
      try {
        workers[name] = await invokeEdgeFunction(name, { batchSize });
      } catch (workerError) {
        workers[name] = {
          ok: false,
          error:
            workerError instanceof Error
              ? workerError.message
              : String(workerError),
        };
      }
    }

    return response(200, {
      ok: true,
      organizations: organizationIds.length,
      processing,
      workers,
    });
  } catch (error) {
    console.error("pipeline_worker_error", error);
    return response(error.statusCode ?? 500, {
      ok: false,
      error: error instanceof Error ? error.message : "Unexpected worker error",
    });
  }
};
