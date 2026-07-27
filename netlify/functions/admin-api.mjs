import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY;
const ALLOWED_ORIGINS = (process.env.ADMIN_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const service =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

const roleWeight = {
  viewer: 1,
  reviewer: 2,
  operator: 3,
  admin: 4,
  owner: 5,
};

const json = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  },
  body: JSON.stringify(body),
});

const corsHeaders = (event) => {
  const origin = event.headers?.origin;
  const allowedOrigin =
    origin && isAllowedOrigin(origin) ? origin : "";

  return {
    ...(allowedOrigin ? { "access-control-allow-origin": allowedOrigin } : {}),
    "access-control-allow-headers":
      "authorization, content-type, x-organization-id",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    vary: "Origin",
  };
};

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (ALLOWED_ORIGINS.length > 0) return false;
  return /^http:\/\/(localhost|127\.0\.0\.1):(4173|8888)$/.test(origin);
};

const assertServerConfiguration = () => {
  if (!service) {
    throw new HttpError(
      503,
      "Backend nie ma skonfigurowanych zmiennych Supabase.",
    );
  }
};

class HttpError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

const parseBody = (event) => {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    throw new HttpError(400, "Treść żądania nie jest poprawnym JSON-em.");
  }
};

const getRoute = (event) => {
  const rawPath = event.path
    .replace(/^\/\.netlify\/functions\/admin-api/, "")
    .replace(/^\/api/, "");
  return rawPath.replace(/^\/+|\/+$/g, "");
};

const getBearerToken = (event) => {
  const authorization =
    event.headers?.authorization ?? event.headers?.Authorization ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new HttpError(401, "Brak ważnej sesji użytkownika.");
  }
  return match[1];
};

const getRequestContext = async (event, body = {}) => {
  assertServerConfiguration();
  const token = getBearerToken(event);
  const { data: userData, error: userError } = await service.auth.getUser(token);
  if (userError || !userData.user) {
    throw new HttpError(401, "Sesja wygasła lub jest nieprawidłowa.");
  }

  let organizationId =
    event.headers?.["x-organization-id"] ??
    event.queryStringParameters?.organization_id ??
    body.organization_id;

  let membershipQuery = service
    .from("organization_members")
    .select("organization_id, role, status")
    .eq("user_id", userData.user.id)
    .eq("status", "active");

  if (organizationId) {
    membershipQuery = membershipQuery.eq("organization_id", organizationId);
  }

  const { data: memberships, error: membershipError } =
    await membershipQuery.limit(1);
  if (membershipError) {
    throw new HttpError(500, "Nie udało się sprawdzić członkostwa.");
  }
  const membership = memberships?.[0];
  if (!membership) {
    throw new HttpError(403, "Brak dostępu do tej organizacji.");
  }

  organizationId = membership.organization_id;
  return {
    token,
    user: userData.user,
    organizationId,
    role: membership.role,
  };
};

const requireRole = (context, minimumRole) => {
  if ((roleWeight[context.role] ?? 0) < roleWeight[minimumRole]) {
    throw new HttpError(
      403,
      `Ta operacja wymaga roli ${minimumRole} lub wyższej.`,
    );
  }
};

const assertResult = ({ data, error }, fallbackMessage) => {
  if (error) {
    throw new HttpError(400, fallbackMessage, error.message);
  }
  return data;
};

const encryptionKey = () => {
  if (!APP_ENCRYPTION_KEY) {
    throw new HttpError(
      503,
      "Brak APP_ENCRYPTION_KEY. Nie można bezpiecznie zapisać sekretu.",
    );
  }
  const key = Buffer.from(APP_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new HttpError(
      503,
      "APP_ENCRYPTION_KEY musi być 32-bajtowym kluczem Base64.",
    );
  }
  return key;
};

const encryptSecret = (payload) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
};

const safeInteger = (value, fallback, min = 1, max = 100) => {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const dashboardResponse = async (context) => {
  const organizationId = context.organizationId;
  const [
    messagesCount,
    reviewCount,
    failedCount,
    sourcesResult,
    latestMessages,
    latestRuns,
  ] = await Promise.all([
    service
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId),
    service
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "review"),
    service
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "failed"),
    service
      .from("source_connectors")
      .select(
        "id, type, name, address, status, last_sync_at, next_sync_at, last_error",
      )
      .eq("organization_id", organizationId)
      .order("name"),
    service
      .from("messages")
      .select(
        "id, sender_email, sender_name, subject, status, score, received_at, category:categories(id,name,color), source:source_connectors(id,name,type)",
      )
      .eq("organization_id", organizationId)
      .order("received_at", { ascending: false })
      .limit(10),
    service
      .from("automation_runs")
      .select("id, status, created_at, completed_at, automation:automations(id,name)")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const firstError = [
    messagesCount.error,
    reviewCount.error,
    failedCount.error,
    sourcesResult.error,
    latestMessages.error,
    latestRuns.error,
  ].find(Boolean);
  if (firstError) {
    throw new HttpError(400, "Nie udało się pobrać pulpitu.", firstError.message);
  }

  return {
    metrics: {
      messages: messagesCount.count ?? 0,
      review: reviewCount.count ?? 0,
      failed: failedCount.count ?? 0,
    },
    sources: sourcesResult.data ?? [],
    messages: latestMessages.data ?? [],
    automation_runs: latestRuns.data ?? [],
  };
};

const listMessages = async (event, context) => {
  const params = event.queryStringParameters ?? {};
  const limit = safeInteger(params.limit, 50, 1, 100);
  let query = service
    .from("messages")
    .select(
      "id, external_id, direction, sender_email, sender_name, recipients, subject, preview, received_at, status, score, review_reason, tags, processed_at, category:categories(id,name,color), source:source_connectors(id,name,type)",
    )
    .eq("organization_id", context.organizationId)
    .order("received_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (params.before) query = query.lt("received_at", params.before);
  if (params.status) query = query.eq("status", params.status);
  if (params.direction) query = query.eq("direction", params.direction);
  if (params.category_id) query = query.eq("category_id", params.category_id);
  if (params.source_id)
    query = query.eq("source_connector_id", params.source_id);
  if (params.search) {
    query = query.textSearch("search_vector", params.search, {
      config: "simple",
      type: "websearch",
    });
  }

  const rows = assertResult(
    await query,
    "Nie udało się pobrać wiadomości.",
  );
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);

  return {
    data,
    next_cursor: hasMore ? data.at(-1)?.received_at ?? null : null,
  };
};

const updateMessage = async (messageId, body, context) => {
  requireRole(context, "reviewer");
  const allowed = new Set([
    "status",
    "category_id",
    "score",
    "review_reason",
    "review_assignee_id",
    "tags",
  ]);
  const patch = Object.fromEntries(
    Object.entries(body).filter(([key]) => allowed.has(key)),
  );
  if (Object.keys(patch).length === 0) {
    throw new HttpError(400, "Brak dozwolonych pól do aktualizacji.");
  }

  const data = assertResult(
    await service
      .from("messages")
      .update(patch)
      .eq("organization_id", context.organizationId)
      .eq("id", messageId)
      .select()
      .single(),
    "Nie udało się zaktualizować wiadomości.",
  );

  await writeAudit(context, "message.updated", "message", messageId, data.subject, {
    after: patch,
  });
  return data;
};

const listCategories = async (context) =>
  assertResult(
    await service
      .from("categories")
      .select("*")
      .eq("organization_id", context.organizationId)
      .order("name"),
    "Nie udało się pobrać kategorii.",
  );

const createCategory = async (body, context) => {
  requireRole(context, "operator");
  const name = String(body.name ?? "").trim();
  const slug = String(body.slug ?? name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!name || !slug) throw new HttpError(400, "Nazwa kategorii jest wymagana.");

  const data = assertResult(
    await service
      .from("categories")
      .insert({
        organization_id: context.organizationId,
        name,
        slug,
        description: body.description ?? null,
        color: body.color ?? "#64748b",
        icon: body.icon ?? "folder",
        default_score: safeInteger(body.default_score, 0, -100, 100),
        active: body.active !== false,
        created_by: context.user.id,
      })
      .select()
      .single(),
    "Nie udało się utworzyć kategorii.",
  );

  await writeAudit(
    context,
    "category.created",
    "category",
    data.id,
    data.name,
  );
  return data;
};

const listRules = async (context) =>
  assertResult(
    await service
      .from("rules")
      .select(
        "*, category:categories(id,name,color), versions:rule_versions(id,version,match_mode,conditions,actions,notes,created_at,created_by)",
      )
      .eq("organization_id", context.organizationId)
      .order("priority", { ascending: false }),
    "Nie udało się pobrać reguł.",
  );

const saveRule = async (ruleId, body, context) => {
  requireRole(context, "operator");
  const isCreate = !ruleId;
  const rulePayload = {
    organization_id: context.organizationId,
    name: String(body.name ?? "").trim(),
    description: body.description ?? null,
    category_id: body.category_id ?? null,
    priority: safeInteger(body.priority, 50, 0, 1000),
    active: Boolean(body.active),
    updated_by: context.user.id,
  };
  if (!rulePayload.name) throw new HttpError(400, "Nazwa reguły jest wymagana.");

  let rule;
  if (isCreate) {
    rule = assertResult(
      await service
        .from("rules")
        .insert({ ...rulePayload, created_by: context.user.id })
        .select()
        .single(),
      "Nie udało się utworzyć reguły.",
    );
  } else {
    const existing = assertResult(
      await service
        .from("rules")
        .select("id,current_version")
        .eq("organization_id", context.organizationId)
        .eq("id", ruleId)
        .single(),
      "Nie znaleziono reguły.",
    );
    rule = assertResult(
      await service
        .from("rules")
        .update({
          ...rulePayload,
          current_version: existing.current_version + 1,
        })
        .eq("organization_id", context.organizationId)
        .eq("id", ruleId)
        .select()
        .single(),
      "Nie udało się zaktualizować reguły.",
    );
  }

  const version = assertResult(
    await service
      .from("rule_versions")
      .insert({
        organization_id: context.organizationId,
        rule_id: rule.id,
        version: rule.current_version,
        match_mode: body.match_mode === "any" ? "any" : "all",
        conditions: Array.isArray(body.conditions) ? body.conditions : [],
        actions: Array.isArray(body.actions) ? body.actions : [],
        notes: body.notes ?? null,
        created_by: context.user.id,
      })
      .select()
      .single(),
    "Nie udało się zapisać wersji reguły.",
  );

  await writeAudit(
    context,
    isCreate ? "rule.created" : "rule.updated",
    "rule",
    rule.id,
    rule.name,
    { version: version.version },
  );
  return { ...rule, version };
};

const listSources = async (context) =>
  assertResult(
    await service
      .from("source_connectors")
      .select(
        "id,type,name,address,status,sync_interval_minutes,folders,public_config,credentials_version,last_sync_at,next_sync_at,last_error,created_at,updated_at",
      )
      .eq("organization_id", context.organizationId)
      .order("name"),
    "Nie udało się pobrać źródeł.",
  );

const createSource = async (body, context) => {
  requireRole(context, "admin");
  const payload = {
    organization_id: context.organizationId,
    type: body.type,
    name: String(body.name ?? "").trim(),
    address: body.address ?? null,
    status: "paused",
    sync_interval_minutes: safeInteger(body.sync_interval_minutes, 5, 1, 10080),
    folders: Array.isArray(body.folders) ? body.folders : [],
    public_config: body.public_config ?? {},
    created_by: context.user.id,
  };
  if (!payload.name) throw new HttpError(400, "Nazwa źródła jest wymagana.");

  const source = assertResult(
    await service.from("source_connectors").insert(payload).select().single(),
    "Nie udało się utworzyć źródła.",
  );

  if (body.credentials && Object.keys(body.credentials).length > 0) {
    assertResult(
      await service.rpc("store_connector_secret", {
        target_connector_id: source.id,
        target_organization_id: context.organizationId,
        encrypted_secret: encryptSecret(body.credentials),
        secret_version: 1,
      }),
      "Źródło utworzono, ale nie udało się zapisać sekretu.",
    );
  }

  await writeAudit(
    context,
    "source.created",
    "source_connector",
    source.id,
    source.name,
  );
  delete source.credentials_encrypted;
  return source;
};

const listDeliveryAccounts = async (context) =>
  assertResult(
    await service
      .from("delivery_accounts")
      .select(
        "id,source_connector_id,provider,name,from_email,from_name,reply_to,status,daily_limit,hourly_limit,public_config,credentials_version,sent_today,last_reset_at,last_test_at,last_error,created_at,updated_at",
      )
      .eq("organization_id", context.organizationId)
      .order("name"),
    "Nie udało się pobrać kont wysyłkowych.",
  );

const createDeliveryAccount = async (body, context) => {
  requireRole(context, "admin");
  const payload = {
    organization_id: context.organizationId,
    source_connector_id: body.source_connector_id ?? null,
    provider: body.provider,
    name: String(body.name ?? "").trim(),
    from_email: String(body.from_email ?? "").trim().toLowerCase(),
    from_name: body.from_name ?? null,
    reply_to: body.reply_to ?? null,
    status: "paused",
    daily_limit: safeInteger(body.daily_limit, 1000, 1, 1_000_000),
    hourly_limit: safeInteger(body.hourly_limit, 200, 1, 100_000),
    public_config: body.public_config ?? {},
    created_by: context.user.id,
  };
  if (!payload.name || !payload.from_email.includes("@")) {
    throw new HttpError(400, "Nazwa i poprawny adres nadawcy są wymagane.");
  }

  const account = assertResult(
    await service.from("delivery_accounts").insert(payload).select().single(),
    "Nie udało się utworzyć konta wysyłkowego.",
  );

  if (body.credentials && Object.keys(body.credentials).length > 0) {
    assertResult(
      await service.rpc("store_delivery_account_secret", {
        target_delivery_account_id: account.id,
        target_organization_id: context.organizationId,
        encrypted_secret: encryptSecret(body.credentials),
        secret_version: 1,
      }),
      "Konto utworzono, ale nie udało się zapisać sekretu.",
    );
  }

  await writeAudit(
    context,
    "delivery_account.created",
    "delivery_account",
    account.id,
    account.name,
  );
  return account;
};

const listUsers = async (context) =>
  assertResult(
    await service
      .from("organization_members")
      .select(
        "organization_id,user_id,role,status,invited_at,joined_at,created_at,profile:profiles(id,full_name,avatar_url,last_seen_at)",
      )
      .eq("organization_id", context.organizationId)
      .order("created_at"),
    "Nie udało się pobrać użytkowników.",
  );

const inviteUser = async (body, context) => {
  requireRole(context, "admin");
  const email = String(body.email ?? "").trim().toLowerCase();
  const role = ["admin", "operator", "reviewer", "viewer"].includes(body.role)
    ? body.role
    : "viewer";
  if (!email.includes("@")) throw new HttpError(400, "Podaj poprawny adres e-mail.");

  const { data: invitation, error: invitationError } =
    await service.auth.admin.inviteUserByEmail(email, {
      data: { full_name: body.full_name ?? email.split("@")[0] },
    });
  if (invitationError || !invitation.user) {
    throw new HttpError(
      400,
      "Nie udało się wysłać zaproszenia.",
      invitationError?.message,
    );
  }

  const membership = assertResult(
    await service
      .from("organization_members")
      .upsert(
        {
          organization_id: context.organizationId,
          user_id: invitation.user.id,
          role,
          status: "invited",
          invited_by: context.user.id,
          invited_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,user_id" },
      )
      .select()
      .single(),
    "Zaproszenie wysłano, ale nie udało się przypisać roli.",
  );

  await writeAudit(
    context,
    "user.invited",
    "organization_member",
    invitation.user.id,
    email,
    { role },
  );
  return membership;
};

const listAudit = async (event, context) => {
  const params = event.queryStringParameters ?? {};
  const limit = safeInteger(params.limit, 50, 1, 100);
  let query = service
    .from("audit_events")
    .select(
      "id,actor_user_id,actor_type,action,target_type,target_id,target_label,severity,ip_address,metadata,created_at,actor:profiles(id,full_name,avatar_url)",
    )
    .eq("organization_id", context.organizationId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (params.before) query = query.lt("created_at", params.before);
  if (params.severity) query = query.eq("severity", params.severity);

  const rows = assertResult(await query, "Nie udało się pobrać audytu.");
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  return {
    data,
    next_cursor: hasMore ? data.at(-1)?.created_at ?? null : null,
  };
};

async function writeAudit(
  context,
  action,
  targetType,
  targetId,
  targetLabel,
  metadata = {},
) {
  const { error } = await service.from("audit_events").insert({
    organization_id: context.organizationId,
    actor_user_id: context.user.id,
    actor_type: "user",
    action,
    target_type: targetType,
    target_id: targetId,
    target_label: targetLabel,
    severity: "info",
    metadata,
  });
  if (error) {
    console.error("audit_write_failed", {
      action,
      targetType,
      error: error.message,
    });
  }
}

const handleRequest = async (event) => {
  const method = event.httpMethod.toUpperCase();
  const route = getRoute(event);

  if (route === "health" && method === "GET") {
    return {
      ok: Boolean(service),
      service: "mailflow-admin-api",
      timestamp: new Date().toISOString(),
    };
  }

  const body = method === "GET" ? {} : parseBody(event);
  const context = await getRequestContext(event, body);

  if (route === "dashboard" && method === "GET")
    return dashboardResponse(context);
  if (route === "messages" && method === "GET")
    return listMessages(event, context);
  if (/^messages\/[\w-]+$/.test(route) && method === "PATCH")
    return updateMessage(route.split("/")[1], body, context);
  if (route === "categories" && method === "GET")
    return listCategories(context);
  if (route === "categories" && method === "POST")
    return createCategory(body, context);
  if (route === "rules" && method === "GET") return listRules(context);
  if (route === "rules" && method === "POST")
    return saveRule(null, body, context);
  if (/^rules\/[\w-]+$/.test(route) && method === "PATCH")
    return saveRule(route.split("/")[1], body, context);
  if (route === "sources" && method === "GET") return listSources(context);
  if (route === "sources" && method === "POST")
    return createSource(body, context);
  if (route === "delivery-accounts" && method === "GET")
    return listDeliveryAccounts(context);
  if (route === "delivery-accounts" && method === "POST")
    return createDeliveryAccount(body, context);
  if (route === "users" && method === "GET") return listUsers(context);
  if (route === "users/invite" && method === "POST")
    return inviteUser(body, context);
  if (route === "audit" && method === "GET") return listAudit(event, context);

  throw new HttpError(404, "Nie znaleziono endpointu API.");
};

export const handler = async (event) => {
  const origin = event.headers?.origin;
  if (origin && !isAllowedOrigin(origin)) {
    return json(403, {
      ok: false,
      error: "Domena wywołująca API nie jest dozwolona.",
    });
  }
  const cors = corsHeaders(event);
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }

  try {
    const data = await handleRequest(event);
    return json(200, { ok: true, data }, cors);
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    const message =
      error instanceof HttpError
        ? error.message
        : "Wystąpił nieoczekiwany błąd serwera.";

    if (statusCode >= 500) {
      console.error("admin_api_error", {
        path: event.path,
        method: event.httpMethod,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    return json(
      statusCode,
      {
        ok: false,
        error: message,
        ...(error instanceof HttpError && error.details
          ? { details: error.details }
          : {}),
      },
      cors,
    );
  }
};
