import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const serviceClient = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
};

const encryptionKey = () => {
  const encoded = process.env.APP_ENCRYPTION_KEY;
  if (!encoded) throw new Error("Missing APP_ENCRYPTION_KEY");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must contain 32 Base64-encoded bytes");
  }
  return key;
};

export const decryptSecret = (encryptedPayload) => {
  const [version, ivValue, tagValue, ciphertextValue] = String(
    encryptedPayload ?? "",
  ).split(".");
  if (
    version !== "v1" ||
    !ivValue ||
    !tagValue ||
    !ciphertextValue
  ) {
    throw new Error("Unsupported encrypted secret format");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
};

export const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

export const requireInternalSecret = (event) => {
  const configured = process.env.WORKER_SECRET;
  const provided = event.headers?.authorization?.replace(/^Bearer\s+/i, "");
  if (
    !configured ||
    !provided ||
    configured.length !== provided.length ||
    !crypto.timingSafeEqual(Buffer.from(configured), Buffer.from(provided))
  ) {
    const error = new Error("Unauthorized");
    error.statusCode = 401;
    throw error;
  }
};

export const parseWorkerBody = (event) => {
  if (!event.body) return {};
  return JSON.parse(event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body);
};

export const response = (statusCode, body) => ({
  statusCode,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  },
  body: JSON.stringify(body),
});

export const safeInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback;
};

export const getConnectorSecret = async (service, connectorId) => {
  const { data, error } = await service.rpc("get_connector_secret", {
    target_connector_id: connectorId,
  });
  if (error) throw error;
  if (!data) throw new Error("Connector credentials are not configured");
  return decryptSecret(data);
};

export const getDeliverySecret = async (service, accountId) => {
  const { data, error } = await service.rpc("get_delivery_account_secret", {
    target_delivery_account_id: accountId,
  });
  if (error) throw error;
  if (!data) throw new Error("Delivery credentials are not configured");
  return decryptSecret(data);
};
