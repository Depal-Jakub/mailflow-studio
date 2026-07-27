import { requireInternalSecret, response } from "./_shared/server.mjs";

const authorize = (event) => {
  if (event.next_run) return;
  requireInternalSecret(event);
};

export const handler = async (event) => {
  try {
    authorize(event);
    const supabaseUrl = process.env.SUPABASE_URL;
    const workerSecret = process.env.WORKER_SECRET;
    if (!supabaseUrl || !workerSecret) {
      throw new Error("Missing SUPABASE_URL or WORKER_SECRET");
    }
    const result = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/functions/v1/scrape-worker`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${workerSecret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ batchSize: 10 }),
        signal: AbortSignal.timeout(25_000),
      },
    );
    const raw = await result.text();
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { error: raw.slice(0, 500) };
    }
    if (!result.ok) {
      throw new Error(
        `scrape-worker HTTP ${result.status}: ${payload.error ?? "unknown error"}`,
      );
    }
    return response(200, payload);
  } catch (error) {
    console.error("scrape_dispatcher_error", error);
    return response(error.statusCode ?? 500, {
      ok: false,
      error: error instanceof Error ? error.message : "Unexpected dispatcher error",
    });
  }
};
