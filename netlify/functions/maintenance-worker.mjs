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

export const handler = async (event) => {
  try {
    authorize(event);
    const service = serviceClient();
    const requestLogRetentionDays = safeInteger(
      process.env.API_REQUEST_LOG_RETENTION_DAYS,
      90,
      1,
      3650,
    );
    const rateBucketRetentionHours = safeInteger(
      process.env.API_RATE_BUCKET_RETENTION_HOURS,
      24,
      1,
      168,
    );
    const { data, error } = await service.rpc("cleanup_api_history", {
      request_log_retention_days: requestLogRetentionDays,
      rate_bucket_retention_hours: rateBucketRetentionHours,
    });
    if (error) throw error;
    return response(200, {
      ok: true,
      retention: {
        request_log_days: requestLogRetentionDays,
        rate_bucket_hours: rateBucketRetentionHours,
      },
      cleanup: data,
      completed_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("maintenance_worker_error", error);
    return response(error.statusCode ?? 500, {
      ok: false,
      error:
        error instanceof Error ? error.message : "Unexpected maintenance error",
    });
  }
};
