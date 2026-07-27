import crypto from "node:crypto";

export const API_KEY_PREFIX = "mfs_live_";

export const API_SCOPES = Object.freeze([
  "messages:read",
  "messages:write",
  "categories:read",
  "categories:write",
  "sources:read",
  "sources:sync",
  "templates:read",
  "outbound:read",
  "outbound:write",
  "audit:read",
]);

const scopeSet = new Set(API_SCOPES);

export const hashApiKey = (value) =>
  crypto.createHash("sha256").update(String(value), "utf8").digest("hex");

export const generateApiKey = () => {
  const secret = `${API_KEY_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
  return {
    secret,
    hash: hashApiKey(secret),
    prefix: secret.slice(0, API_KEY_PREFIX.length + 10),
  };
};

export const normalizeApiScopes = (scopes) => {
  if (!Array.isArray(scopes)) return [];
  if (scopes.includes("*")) return ["*"];
  return [...new Set(scopes.map(String).filter((scope) => scopeSet.has(scope)))];
};

export const extractApiKey = (headers = {}) => {
  const direct = headers["x-api-key"] ?? headers["X-API-Key"];
  if (direct) return String(direct).trim();
  const authorization =
    headers.authorization ?? headers.Authorization ?? "";
  const match = String(authorization).match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
};

export const clientIp = (headers = {}) => {
  const value =
    headers["x-nf-client-connection-ip"] ??
    headers["client-ip"] ??
    headers["x-forwarded-for"] ??
    "";
  return String(value).split(",")[0].trim() || null;
};

export const parseCursor = (value) => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(String(value), "base64url").toString("utf8"),
    );
    if (
      typeof parsed?.timestamp !== "string" ||
      Number.isNaN(Date.parse(parsed.timestamp))
    ) {
      return null;
    }
    const id =
      typeof parsed.id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        parsed.id,
      )
        ? parsed.id
        : null;
    return {
      timestamp: new Date(parsed.timestamp).toISOString(),
      id,
    };
  } catch {
    return null;
  }
};

export const encodeCursor = (timestamp, id = null) =>
  Buffer.from(JSON.stringify({ timestamp, id }), "utf8").toString("base64url");

export const validateAllowedIps = (values) => {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values) || values.length > 50) {
    throw new Error("allowed_ips musi być tablicą zawierającą maksymalnie 50 wpisów.");
  }
  return values.map((value) => {
    const normalized = String(value).trim();
    if (
      !normalized ||
      normalized.length > 64 ||
      !/^[0-9a-fA-F:.]+(?:\/\d{1,3})?$/.test(normalized)
    ) {
      throw new Error(`Nieprawidłowy adres IP lub CIDR: ${normalized || "(pusty)"}`);
    }
    return normalized;
  });
};

export const validateExpiry = (value, { requiredFuture = true } = {}) => {
  if (value === undefined || value === null || value === "") return null;
  const timestamp = Date.parse(String(value));
  if (!Number.isFinite(timestamp)) {
    throw new Error("expires_at musi być poprawną datą ISO 8601.");
  }
  if (requiredFuture && timestamp <= Date.now()) {
    throw new Error("Data wygaśnięcia klucza musi przypadać w przyszłości.");
  }
  return new Date(timestamp).toISOString();
};
