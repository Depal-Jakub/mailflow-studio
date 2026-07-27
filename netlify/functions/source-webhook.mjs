import crypto from "node:crypto";
import {
  getConnectorSecret,
  response,
  serviceClient,
  sha256,
} from "./_shared/server.mjs";

const MAX_BODY_BYTES = 2_000_000;

const sourceIdFromEvent = (event) => {
  const path = String(event.path ?? "");
  const match = path.match(/(?:source-webhook\/|\/hooks\/)([\w-]+)\/?$/);
  return match?.[1] ?? null;
};

const rawBody = (event) =>
  event.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64")
    : Buffer.from(event.body ?? "", "utf8");

const safeEqual = (left, right) => {
  const first = Buffer.from(String(left ?? ""));
  const second = Buffer.from(String(right ?? ""));
  return (
    first.length === second.length &&
    first.length > 0 &&
    crypto.timingSafeEqual(first, second)
  );
};

const valueAtPath = (payload, path) => {
  if (!path || typeof path !== "string") return undefined;
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)
    .reduce(
      (value, key) =>
        value && typeof value === "object" ? value[key] : undefined,
      payload,
    );
};

const mappedValue = (payload, mapping, key, fallbacks = []) => {
  const mapped = valueAtPath(payload, mapping?.[key]);
  if (mapped !== undefined && mapped !== null) return mapped;
  for (const fallback of fallbacks) {
    const value = valueAtPath(payload, fallback);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
};

const normalizeRecipients = (value) => {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items
    .map((item) =>
      typeof item === "string"
        ? { email: item.trim().toLowerCase() }
        : {
            email: String(item.email ?? item.address ?? "")
              .trim()
              .toLowerCase(),
            name: item.name ? String(item.name) : undefined,
          },
    )
    .filter((item) => item.email.includes("@"))
    .slice(0, 500);
};

const logDelivery = async (service, source, details) => {
  const { error } = await service.from("webhook_deliveries").insert({
    organization_id: source.organization_id,
    source_connector_id: source.id,
    ...details,
  });
  if (error?.code !== "23505") {
    if (error) console.error("webhook_delivery_log_error", error.message);
  }
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers":
          "content-type, authorization, x-mailflow-signature",
      },
      body: "",
    };
  }
  if (event.httpMethod !== "POST") {
    return response(405, { ok: false, error: "Method not allowed" });
  }

  const bodyBytes = rawBody(event);
  if (bodyBytes.byteLength === 0 || bodyBytes.byteLength > MAX_BODY_BYTES) {
    return response(413, {
      ok: false,
      error: "Body musi mieć od 1 B do 2 MB.",
    });
  }

  try {
    const sourceId = sourceIdFromEvent(event);
    if (!sourceId) return response(404, { ok: false, error: "Source not found" });
    const service = serviceClient();
    const { data: source, error: sourceError } = await service
      .from("source_connectors")
      .select("*")
      .eq("id", sourceId)
      .eq("type", "webhook")
      .in("status", ["active", "warning"])
      .single();
    if (sourceError || !source) {
      return response(404, { ok: false, error: "Aktywny webhook nie istnieje." });
    }

    const credentials = await getConnectorSecret(service, source.id);
    const secret = String(
      credentials.webhookSecret ?? credentials.webhook_secret ?? "",
    );
    const signatureHeader = String(
      source.public_config?.signature_header ?? "x-mailflow-signature",
    ).toLowerCase();
    const providedSignature = String(event.headers?.[signatureHeader] ?? "")
      .replace(/^sha256=/i, "")
      .trim()
      .toLowerCase();
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(bodyBytes)
      .digest("hex");
    const bearer = String(event.headers?.authorization ?? "").replace(
      /^Bearer\s+/i,
      "",
    );
    const signatureValid =
      safeEqual(providedSignature, expectedSignature) || safeEqual(bearer, secret);
    if (!signatureValid) {
      await logDelivery(service, source, {
        signature_valid: false,
        status: "rejected",
        response_code: 401,
        error_message: "Invalid HMAC or Bearer token",
      });
      return response(401, { ok: false, error: "Nieprawidłowy podpis webhooka." });
    }

    let payload;
    try {
      payload = JSON.parse(bodyBytes.toString("utf8"));
    } catch {
      await logDelivery(service, source, {
        signature_valid: true,
        status: "rejected",
        response_code: 400,
        error_message: "Invalid JSON",
      });
      return response(400, { ok: false, error: "Body nie jest poprawnym JSON-em." });
    }

    const mapping = source.public_config?.payload_mapping ?? {};
    const externalId = String(
      mappedValue(payload, mapping, "externalId", [
        "externalId",
        "external_id",
        "event.id",
        "id",
      ]) ?? "",
    ).trim();
    if (!externalId) {
      return response(400, {
        ok: false,
        error: "Payload po mapowaniu nie zawiera externalId.",
      });
    }
    const senderEmail = String(
      mappedValue(payload, mapping, "senderEmail", [
        "senderEmail",
        "sender.email",
        "from.email",
        "from",
      ]) ?? "webhook@external.invalid",
    )
      .trim()
      .toLowerCase();
    const receivedValue = mappedValue(payload, mapping, "receivedAt", [
      "receivedAt",
      "received_at",
      "created_at",
      "timestamp",
    ]);
    const receivedAt = receivedValue ? new Date(receivedValue) : new Date();
    if (Number.isNaN(receivedAt.getTime())) {
      return response(400, { ok: false, error: "receivedAt ma nieprawidłowy format." });
    }
    const subject = String(
      mappedValue(payload, mapping, "subject", ["subject", "title"]) ??
        "Zdarzenie webhook",
    ).slice(0, 2000);
    const textBody = String(
      mappedValue(payload, mapping, "bodyText", [
        "bodyText",
        "body.text",
        "text",
        "content",
      ]) ?? "",
    ).slice(0, 2_000_000);
    const htmlBody = mappedValue(payload, mapping, "bodyHtml", [
      "bodyHtml",
      "body.html",
      "html",
    ]);
    const dedupeHash = sha256(
      [source.organization_id, source.id, externalId].join("\u001f"),
    );
    const messagePayload = {
      organization_id: source.organization_id,
      source_connector_id: source.id,
      external_id: externalId,
      thread_id:
        String(
          mappedValue(payload, mapping, "threadId", [
            "threadId",
            "thread_id",
          ]) ?? "",
        ) || null,
      direction: "incoming",
      sender_email: senderEmail.includes("@")
        ? senderEmail
        : "webhook@external.invalid",
      sender_name:
        String(
          mappedValue(payload, mapping, "senderName", [
            "senderName",
            "sender.name",
            "from.name",
          ]) ?? "",
        ) || null,
      recipients: normalizeRecipients(
        mappedValue(payload, mapping, "recipients", ["recipients", "to"]),
      ),
      subject,
      preview: textBody.replace(/\s+/g, " ").trim().slice(0, 1000),
      body_text: textBody || null,
      body_html:
        typeof htmlBody === "string" ? htmlBody.slice(0, 4_000_000) : null,
      headers: {
        webhook_request_id:
          event.headers?.["x-request-id"] ??
          event.headers?.["x-netlify-request-id"] ??
          null,
        content_type: event.headers?.["content-type"] ?? null,
      },
      received_at: receivedAt.toISOString(),
      status: "new",
      dedupe_hash: dedupeHash,
    };
    const { data: message, error: insertError } = await service
      .from("messages")
      .insert(messagePayload)
      .select("id")
      .single();
    if (insertError?.code === "23505") {
      await logDelivery(service, source, {
        external_id: externalId,
        signature_valid: true,
        status: "duplicate",
        response_code: 200,
        dedupe_hash: dedupeHash,
      });
      return response(200, {
        ok: true,
        duplicate: true,
        external_id: externalId,
      });
    }
    if (insertError) throw insertError;

    await logDelivery(service, source, {
      external_id: externalId,
      request_id:
        event.headers?.["x-request-id"] ??
        event.headers?.["x-netlify-request-id"] ??
        null,
      signature_valid: true,
      status: "accepted",
      response_code: 202,
      dedupe_hash: dedupeHash,
      metadata: { message_id: message.id },
    });
    return response(202, {
      ok: true,
      accepted: true,
      message_id: message.id,
      external_id: externalId,
    });
  } catch (error) {
    console.error("source_webhook_error", error);
    return response(500, {
      ok: false,
      error: error instanceof Error ? error.message : "Unexpected webhook error",
    });
  }
};
