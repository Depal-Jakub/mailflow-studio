import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  API_SCOPES,
  generateApiKey,
  normalizeApiScopes,
  validateAllowedIps,
  validateExpiry,
} from "./_shared/api-keys.mjs";
import {
  testDeliveryConnection,
  testSourceConnection,
} from "./_shared/connectors.mjs";
import {
  getConnectorSecret,
  getDeliverySecret,
} from "./_shared/server.mjs";

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
    .select(
      "organization_id, role, role_id, status, role_definition:organization_roles(key,name,permissions)",
    )
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
    role: membership.role_definition?.key ?? membership.role,
    roleName: membership.role_definition?.name ?? membership.role,
    permissions: membership.role_definition?.permissions ?? [],
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

const requirePermission = (context, permission, fallbackRole = "viewer") => {
  if (context.permissions?.includes(permission)) return;
  requireRole(context, fallbackRole);
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
  requirePermission(context, "messages.classify", "reviewer");
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
  requirePermission(context, "categories.manage", "operator");
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

const updateCategory = async (categoryId, body, context) => {
  requirePermission(context, "categories.manage", "operator");
  const allowed = new Set([
    "name",
    "slug",
    "description",
    "color",
    "icon",
    "default_score",
    "active",
  ]);
  const patch = Object.fromEntries(
    Object.entries(body).filter(([key]) => allowed.has(key)),
  );
  if (patch.name !== undefined) {
    patch.name = String(patch.name).trim();
    if (!patch.name) throw new HttpError(400, "Nazwa kategorii jest wymagana.");
  }
  if (patch.slug !== undefined) {
    patch.slug = String(patch.slug)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!patch.slug) throw new HttpError(400, "Nieprawidłowy slug kategorii.");
  }
  if (patch.default_score !== undefined) {
    patch.default_score = safeInteger(patch.default_score, 0, -100, 100);
  }
  if (Object.keys(patch).length === 0) {
    throw new HttpError(400, "Brak dozwolonych pól do aktualizacji.");
  }
  const category = assertResult(
    await service
      .from("categories")
      .update(patch)
      .eq("organization_id", context.organizationId)
      .eq("id", categoryId)
      .select()
      .single(),
    "Nie udało się zaktualizować kategorii.",
  );
  await writeAudit(
    context,
    "category.updated",
    "category",
    category.id,
    category.name,
    { fields: Object.keys(patch) },
  );
  return category;
};

const deleteCategory = async (categoryId, context) => {
  requirePermission(context, "categories.manage", "operator");
  const category = assertResult(
    await service
      .from("categories")
      .delete()
      .eq("organization_id", context.organizationId)
      .eq("id", categoryId)
      .select("id,name")
      .single(),
    "Nie udało się usunąć kategorii.",
  );
  await writeAudit(
    context,
    "category.deleted",
    "category",
    category.id,
    category.name,
  );
  return { deleted: true, id: category.id };
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
  requirePermission(context, "rules.manage", "operator");
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

const deleteRule = async (ruleId, context) => {
  requirePermission(context, "rules.manage", "operator");
  const rule = assertResult(
    await service
      .from("rules")
      .delete()
      .eq("organization_id", context.organizationId)
      .eq("id", ruleId)
      .select("id,name")
      .single(),
    "Nie udało się usunąć reguły.",
  );
  await writeAudit(
    context,
    "rule.deleted",
    "rule",
    rule.id,
    rule.name,
  );
  return { deleted: true, id: rule.id };
};

const listAutomations = async (context) =>
  assertResult(
    await service
      .from("automations")
      .select(
        "*, recent_runs:automation_runs(id,status,created_at,completed_at,error_message)",
      )
      .eq("organization_id", context.organizationId)
      .order("updated_at", { ascending: false }),
    "Nie udało się pobrać automatyzacji.",
  );

const saveAutomation = async (automationId, body, context) => {
  requirePermission(context, "automations.manage", "operator");
  const isCreate = !automationId;
  const triggerType = String(body.trigger_type ?? "message_classified");
  if (
    ![
      "message_ingested",
      "message_classified",
      "schedule",
      "webhook",
      "manual",
    ].includes(triggerType)
  ) {
    throw new HttpError(400, "Nieobsługiwany typ wyzwalacza.");
  }
  const name = String(body.name ?? "").trim();
  if (!name) throw new HttpError(400, "Nazwa automatyzacji jest wymagana.");
  if (!Array.isArray(body.steps)) {
    throw new HttpError(400, "Kroki automatyzacji muszą być tablicą.");
  }
  if (body.steps.length > 100) {
    throw new HttpError(400, "Automatyzacja może mieć maksymalnie 100 kroków.");
  }
  const payload = {
    organization_id: context.organizationId,
    name,
    description: body.description ?? null,
    trigger_type: triggerType,
    trigger_config:
      body.trigger_config &&
      typeof body.trigger_config === "object" &&
      !Array.isArray(body.trigger_config)
        ? body.trigger_config
        : {},
    steps: body.steps,
    active: Boolean(body.active),
    next_run_at:
      triggerType === "schedule" && body.next_run_at
        ? validateExpiry(body.next_run_at)
        : null,
    updated_by: context.user.id,
  };
  let automation;
  if (isCreate) {
    automation = assertResult(
      await service
        .from("automations")
        .insert({ ...payload, created_by: context.user.id })
        .select()
        .single(),
      "Nie udało się utworzyć automatyzacji.",
    );
  } else {
    const existing = assertResult(
      await service
        .from("automations")
        .select("id,version")
        .eq("organization_id", context.organizationId)
        .eq("id", automationId)
        .single(),
      "Nie znaleziono automatyzacji.",
    );
    automation = assertResult(
      await service
        .from("automations")
        .update({ ...payload, version: existing.version + 1 })
        .eq("organization_id", context.organizationId)
        .eq("id", automationId)
        .select()
        .single(),
      "Nie udało się zaktualizować automatyzacji.",
    );
  }
  await writeAudit(
    context,
    isCreate ? "automation.created" : "automation.updated",
    "automation",
    automation.id,
    automation.name,
    { version: automation.version, active: automation.active },
  );
  return automation;
};

const runAutomation = async (automationId, body, context) => {
  requirePermission(context, "automations.manage", "operator");
  const automation = assertResult(
    await service
      .from("automations")
      .select("id,name,active,trigger_type")
      .eq("organization_id", context.organizationId)
      .eq("id", automationId)
      .single(),
    "Nie znaleziono automatyzacji.",
  );
  const run = assertResult(
    await service
      .from("automation_runs")
      .insert({
        organization_id: context.organizationId,
        automation_id: automation.id,
        message_id: body.message_id ?? null,
        status: "pending",
        input:
          body.input && typeof body.input === "object" ? body.input : {},
      })
      .select()
      .single(),
    "Nie udało się uruchomić automatyzacji.",
  );
  await writeAudit(
    context,
    "automation.queued",
    "automation",
    automation.id,
    automation.name,
    { run_id: run.id },
  );
  return run;
};

const deleteAutomation = async (automationId, context) => {
  requirePermission(context, "automations.manage", "operator");
  const automation = assertResult(
    await service
      .from("automations")
      .delete()
      .eq("organization_id", context.organizationId)
      .eq("id", automationId)
      .select("id,name")
      .single(),
    "Nie udało się usunąć automatyzacji.",
  );
  await writeAudit(
    context,
    "automation.deleted",
    "automation",
    automation.id,
    automation.name,
  );
  return { deleted: true, id: automation.id };
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
  requirePermission(context, "sources.manage", "admin");
  const type = String(body.type ?? "");
  if (!["gmail", "outlook", "imap", "webhook", "scraper"].includes(type)) {
    throw new HttpError(400, "Nieobsługiwany typ źródła.");
  }
  const payload = {
    organization_id: context.organizationId,
    type,
    name: String(body.name ?? "").trim(),
    address: body.address ?? null,
    status: "active",
    sync_interval_minutes: safeInteger(body.sync_interval_minutes, 5, 1, 10080),
    folders: Array.isArray(body.folders) ? body.folders : [],
    public_config: body.public_config ?? {},
    next_sync_at: type === "webhook" ? null : new Date().toISOString(),
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

const connectionValidation = async (kind, body, credentials) => {
  try {
    const result =
      kind === "source"
        ? await testSourceConnection({
            type: body.type,
            publicConfig: body.public_config ?? {},
            credentials,
          })
        : await testDeliveryConnection({
            provider: body.provider,
            publicConfig: body.public_config ?? {},
            credentials,
          });
    return {
      valid: true,
      errors: {},
      checks: result.checks ?? [],
      identity: result.identity ?? null,
    };
  } catch (error) {
    return {
      valid: false,
      errors: {
        connection:
          error instanceof Error ? error.message : "Test połączenia nie powiódł się.",
      },
      checks: [
        {
          label: "połączenie z dostawcą",
          ok: false,
          detail:
            error instanceof Error ? error.message : "Nieznany błąd połączenia.",
        },
      ],
    };
  }
};

const testSourceDraft = async (body, context) => {
  requirePermission(context, "sources.test", "admin");
  return connectionValidation("source", body, body.credentials ?? {});
};

const updateSource = async (sourceId, body, context) => {
  requirePermission(context, "sources.manage", "admin");
  const existing = assertResult(
    await service
      .from("source_connectors")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("id", sourceId)
      .single(),
    "Nie znaleziono źródła.",
  );
  const allowed = new Set([
    "type",
    "name",
    "address",
    "status",
    "sync_interval_minutes",
    "folders",
    "public_config",
  ]);
  const patch = Object.fromEntries(
    Object.entries(body).filter(([key]) => allowed.has(key)),
  );
  if (patch.sync_interval_minutes !== undefined) {
    patch.sync_interval_minutes = safeInteger(
      patch.sync_interval_minutes,
      existing.sync_interval_minutes,
      1,
      10080,
    );
  }
  if (
    patch.status !== undefined &&
    !["active", "warning", "error", "paused"].includes(patch.status)
  ) {
    throw new HttpError(400, "Nieprawidłowy status źródła.");
  }
  if (patch.type === "webhook") patch.next_sync_at = null;
  if (patch.status === "active" && existing.status === "paused") {
    patch.next_sync_at = new Date().toISOString();
  }

  const source = assertResult(
    await service
      .from("source_connectors")
      .update(patch)
      .eq("organization_id", context.organizationId)
      .eq("id", sourceId)
      .select()
      .single(),
    "Nie udało się zaktualizować źródła.",
  );
  if (body.credentials && Object.keys(body.credentials).length > 0) {
    const secretVersion = Number(existing.credentials_version ?? 1) + 1;
    assertResult(
      await service.rpc("store_connector_secret", {
        target_connector_id: sourceId,
        target_organization_id: context.organizationId,
        encrypted_secret: encryptSecret(body.credentials),
        secret_version: secretVersion,
      }),
      "Konfigurację zapisano, ale nie udało się obrócić sekretu.",
    );
    await service
      .from("source_connectors")
      .update({ credentials_version: secretVersion })
      .eq("id", sourceId);
  }
  await writeAudit(
    context,
    "source.updated",
    "source_connector",
    source.id,
    source.name,
    { fields: Object.keys(patch) },
  );
  return source;
};

const testStoredSource = async (sourceId, context) => {
  requirePermission(context, "sources.test", "admin");
  const source = assertResult(
    await service
      .from("source_connectors")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("id", sourceId)
      .single(),
    "Nie znaleziono źródła.",
  );
  const credentials =
    source.type === "scraper" ? {} : await getConnectorSecret(service, sourceId);
  const result = await connectionValidation("source", source, credentials);
  await service
    .from("source_connectors")
    .update({
      status: result.valid ? "active" : "error",
      last_error: result.valid ? null : result.errors.connection,
    })
    .eq("id", sourceId);
  await writeAudit(
    context,
    result.valid ? "source.test_succeeded" : "source.test_failed",
    "source_connector",
    source.id,
    source.name,
    { checks: result.checks },
  );
  return result;
};

const syncSource = async (sourceId, context) => {
  requirePermission(context, "sources.test", "operator");
  const source = assertResult(
    await service
      .from("source_connectors")
      .update({
        status: "active",
        next_sync_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("organization_id", context.organizationId)
      .eq("id", sourceId)
      .select("id,name,type")
      .single(),
    "Nie udało się ustawić synchronizacji.",
  );
  await writeAudit(
    context,
    "source.sync_requested",
    "source_connector",
    source.id,
    source.name,
  );
  return {
    ...source,
    queued: source.type !== "webhook",
    message:
      source.type === "webhook"
        ? "Webhook odbiera dane zdarzeniowo i nie wymaga synchronizacji."
        : "Źródło zostanie podjęte przez najbliższy przebieg workera.",
  };
};

const deleteSource = async (sourceId, context) => {
  requirePermission(context, "sources.manage", "admin");
  const source = assertResult(
    await service
      .from("source_connectors")
      .delete()
      .eq("organization_id", context.organizationId)
      .eq("id", sourceId)
      .select("id,name")
      .single(),
    "Nie udało się usunąć źródła.",
  );
  await writeAudit(
    context,
    "source.deleted",
    "source_connector",
    source.id,
    source.name,
  );
  return { deleted: true, id: source.id };
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
  requirePermission(context, "accounts.manage", "admin");
  const payload = {
    organization_id: context.organizationId,
    source_connector_id: body.source_connector_id ?? null,
    provider: body.provider,
    name: String(body.name ?? "").trim(),
    from_email: String(body.from_email ?? "").trim().toLowerCase(),
    from_name: body.from_name ?? null,
    reply_to: body.reply_to ?? null,
    status: "active",
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

const testDeliveryDraft = async (body, context) => {
  requirePermission(context, "accounts.manage", "admin");
  return connectionValidation("delivery", body, body.credentials ?? {});
};

const updateDeliveryAccount = async (accountId, body, context) => {
  requirePermission(context, "accounts.manage", "admin");
  const existing = assertResult(
    await service
      .from("delivery_accounts")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("id", accountId)
      .single(),
    "Nie znaleziono konta wysyłkowego.",
  );
  const allowed = new Set([
    "source_connector_id",
    "provider",
    "name",
    "from_email",
    "from_name",
    "reply_to",
    "status",
    "daily_limit",
    "hourly_limit",
    "public_config",
  ]);
  const patch = Object.fromEntries(
    Object.entries(body).filter(([key]) => allowed.has(key)),
  );
  if (patch.daily_limit !== undefined) {
    patch.daily_limit = safeInteger(
      patch.daily_limit,
      existing.daily_limit,
      1,
      1_000_000,
    );
  }
  if (patch.hourly_limit !== undefined) {
    patch.hourly_limit = safeInteger(
      patch.hourly_limit,
      existing.hourly_limit,
      1,
      100_000,
    );
  }
  const account = assertResult(
    await service
      .from("delivery_accounts")
      .update(patch)
      .eq("organization_id", context.organizationId)
      .eq("id", accountId)
      .select()
      .single(),
    "Nie udało się zaktualizować konta wysyłkowego.",
  );
  if (body.credentials && Object.keys(body.credentials).length > 0) {
    const secretVersion = Number(existing.credentials_version ?? 1) + 1;
    assertResult(
      await service.rpc("store_delivery_account_secret", {
        target_delivery_account_id: accountId,
        target_organization_id: context.organizationId,
        encrypted_secret: encryptSecret(body.credentials),
        secret_version: secretVersion,
      }),
      "Konfigurację zapisano, ale nie udało się obrócić sekretu.",
    );
    await service
      .from("delivery_accounts")
      .update({ credentials_version: secretVersion })
      .eq("id", accountId);
  }
  await writeAudit(
    context,
    "delivery_account.updated",
    "delivery_account",
    account.id,
    account.name,
  );
  return account;
};

const testStoredDeliveryAccount = async (accountId, context) => {
  requirePermission(context, "accounts.manage", "admin");
  const account = assertResult(
    await service
      .from("delivery_accounts")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("id", accountId)
      .single(),
    "Nie znaleziono konta wysyłkowego.",
  );
  const credentials = await getDeliverySecret(service, accountId);
  const result = await connectionValidation("delivery", account, credentials);
  await service
    .from("delivery_accounts")
    .update({
      status: result.valid ? "active" : "error",
      last_test_at: new Date().toISOString(),
      last_error: result.valid ? null : result.errors.connection,
    })
    .eq("id", accountId);
  return result;
};

const deleteDeliveryAccount = async (accountId, context) => {
  requirePermission(context, "accounts.manage", "admin");
  const account = assertResult(
    await service
      .from("delivery_accounts")
      .delete()
      .eq("organization_id", context.organizationId)
      .eq("id", accountId)
      .select("id,name")
      .single(),
    "Nie udało się usunąć konta wysyłkowego.",
  );
  await writeAudit(
    context,
    "delivery_account.deleted",
    "delivery_account",
    account.id,
    account.name,
  );
  return { deleted: true, id: account.id };
};

const listTemplates = async (context) =>
  assertResult(
    await service
      .from("templates")
      .select("*")
      .eq("organization_id", context.organizationId)
      .order("updated_at", { ascending: false }),
    "Nie udało się pobrać szablonów.",
  );

const saveTemplate = async (templateId, body, context) => {
  requirePermission(context, "templates.manage", "operator");
  const isCreate = !templateId;
  const name = String(body.name ?? "").trim();
  if (!name) throw new HttpError(400, "Nazwa szablonu jest wymagana.");
  const payload = {
    organization_id: context.organizationId,
    name,
    description: body.description ?? null,
    kind: "email",
    template_type: body.template_type ?? body.kind ?? "notification",
    subject_template: body.subject ?? body.subject_template ?? "",
    text_template: body.text_body ?? body.text_template ?? "",
    html_template: body.html_body ?? body.html_template ?? "",
    variables: Array.isArray(body.variables) ? body.variables : [],
    active: body.active !== false,
    updated_by: context.user.id,
  };

  let template;
  if (isCreate) {
    template = assertResult(
      await service
        .from("templates")
        .insert({ ...payload, created_by: context.user.id })
        .select()
        .single(),
      "Nie udało się utworzyć szablonu.",
    );
  } else {
    const existing = assertResult(
      await service
        .from("templates")
        .select("id,version")
        .eq("organization_id", context.organizationId)
        .eq("id", templateId)
        .single(),
      "Nie znaleziono szablonu.",
    );
    template = assertResult(
      await service
        .from("templates")
        .update({ ...payload, version: existing.version + 1 })
        .eq("organization_id", context.organizationId)
        .eq("id", templateId)
        .select()
        .single(),
      "Nie udało się zaktualizować szablonu.",
    );
  }

  assertResult(
    await service.from("template_versions").insert({
      organization_id: context.organizationId,
      template_id: template.id,
      version: template.version,
      subject_template: template.subject_template,
      text_template: template.text_template,
      html_template: template.html_template,
      variables: template.variables,
      created_by: context.user.id,
    }),
    "Szablon zapisano, ale nie udało się utworzyć wersji.",
  );
  await writeAudit(
    context,
    isCreate ? "template.created" : "template.updated",
    "template",
    template.id,
    template.name,
    { version: template.version },
  );
  return template;
};

const deleteTemplate = async (templateId, context) => {
  requirePermission(context, "templates.manage", "operator");
  const template = assertResult(
    await service
      .from("templates")
      .delete()
      .eq("organization_id", context.organizationId)
      .eq("id", templateId)
      .select("id,name")
      .single(),
    "Nie udało się usunąć szablonu.",
  );
  await writeAudit(
    context,
    "template.deleted",
    "template",
    template.id,
    template.name,
  );
  return { deleted: true, id: template.id };
};

const listOutboundMessages = async (event, context) => {
  const limit = safeInteger(
    event.queryStringParameters?.limit,
    50,
    1,
    100,
  );
  return assertResult(
    await service
      .from("outbound_messages")
      .select(
        "*, account:delivery_accounts(id,name,from_email,provider), template:templates(id,name)",
      )
      .eq("organization_id", context.organizationId)
      .order("created_at", { ascending: false })
      .limit(limit),
    "Nie udało się pobrać wysyłek.",
  );
};

const createOutboundMessage = async (body, context) => {
  requirePermission(context, "send.compose", "operator");
  const status = ["draft", "scheduled", "pending"].includes(body.status)
    ? body.status
    : "draft";
  if (!String(body.subject ?? "").trim()) {
    throw new HttpError(400, "Temat wiadomości jest wymagany.");
  }
  if (status !== "draft" && !body.delivery_account_id) {
    throw new HttpError(400, "Wybierz konto wysyłkowe.");
  }
  const recipientMap = new Map();
  for (const [index, recipient] of (
    Array.isArray(body.recipients) ? body.recipients : []
  ).entries()) {
    const normalized =
      typeof recipient === "string"
        ? { email: recipient.trim().toLowerCase(), name: null, variables: {} }
        : {
            email: String(recipient?.email ?? "").trim().toLowerCase(),
            name: recipient?.name ?? null,
            variables:
              recipient?.variables &&
              typeof recipient.variables === "object" &&
              !Array.isArray(recipient.variables)
                ? recipient.variables
                : {},
          };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) {
      throw new HttpError(
        400,
        `Odbiorca na pozycji ${index + 1} ma nieprawidłowy adres e-mail.`,
      );
    }
    if (!recipientMap.has(normalized.email)) {
      recipientMap.set(normalized.email, normalized);
    }
  }
  const recipients = [...recipientMap.values()];
  if (recipients.length > 50_000) {
    throw new HttpError(400, "Jedna wysyłka może zawierać maksymalnie 50 000 odbiorców.");
  }
  let scheduledAt = null;
  if (status === "scheduled") {
    const scheduledTimestamp = Date.parse(String(body.scheduled_at ?? ""));
    if (!Number.isFinite(scheduledTimestamp)) {
      throw new HttpError(400, "Podaj poprawny termin zaplanowanej wysyłki.");
    }
    if (scheduledTimestamp <= Date.now()) {
      throw new HttpError(400, "Termin wysyłki musi przypadać w przyszłości.");
    }
    scheduledAt = new Date(scheduledTimestamp).toISOString();
  }

  const outboundResult = assertResult(
    await service.rpc("create_outbound_with_recipients", {
      target_organization_id: context.organizationId,
      target_delivery_account_id: body.delivery_account_id ?? null,
      target_template_id: body.template_id ?? null,
      target_source_message_id: body.source_message_id ?? null,
      outbound_subject: String(body.subject).trim(),
      outbound_text_body: body.text_body ?? null,
      outbound_html_body: body.html_body ?? null,
      outbound_audience_definition: body.audience_definition ?? {
        type: "explicit",
        count: recipients.length,
      },
      outbound_status: status,
      outbound_scheduled_at: scheduledAt,
      target_created_by: context.user.id,
      recipient_payload: recipients,
    }),
    "Nie udało się utworzyć wysyłki.",
  );
  const outbound = Array.isArray(outboundResult)
    ? outboundResult[0]
    : outboundResult;
  if (!outbound?.id) {
    throw new HttpError(500, "Baza nie zwróciła utworzonej wysyłki.");
  }
  await writeAudit(
    context,
    status === "draft" ? "outbound.drafted" : "outbound.queued",
    "outbound_message",
    outbound.id,
    outbound.subject,
    { status, recipient_count: recipients.length },
  );
  return outbound;
};

const listOrganizations = async (context) => {
  const memberships = assertResult(
    await service
      .from("organization_members")
      .select(
        "organization_id,status,role_id,organization:organizations(*),role_definition:organization_roles(id,key,name,color,permissions)",
      )
      .eq("user_id", context.user.id)
      .eq("status", "active"),
    "Nie udało się pobrać organizacji.",
  );
  return memberships.map((membership) => ({
    ...membership.organization,
    membership: {
      status: membership.status,
      role_id: membership.role_id,
      role: membership.role_definition,
    },
  }));
};

const listRoles = async (context) =>
  assertResult(
    await service
      .from("organization_roles")
      .select(
        "*, members:organization_members(count)",
      )
      .eq("organization_id", context.organizationId)
      .order("built_in", { ascending: false })
      .order("name"),
    "Nie udało się pobrać ról.",
  );

const saveRole = async (roleId, body, context) => {
  requirePermission(context, "roles.manage", "admin");
  const isCreate = !roleId;
  const name = String(body.name ?? "").trim();
  const key = String(body.key ?? name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!name || !key) throw new HttpError(400, "Nazwa roli jest wymagana.");
  const payload = {
    organization_id: context.organizationId,
    key,
    name,
    description: body.description ?? null,
    color: body.color ?? "#64748b",
    permissions: Array.isArray(body.permissions) ? body.permissions : [],
  };
  if (isCreate) {
    return assertResult(
      await service
        .from("organization_roles")
        .insert({ ...payload, built_in: false, created_by: context.user.id })
        .select()
        .single(),
      "Nie udało się utworzyć roli.",
    );
  }
  const existing = assertResult(
    await service
      .from("organization_roles")
      .select("id,built_in,key")
      .eq("organization_id", context.organizationId)
      .eq("id", roleId)
      .single(),
    "Nie znaleziono roli.",
  );
  return assertResult(
    await service
      .from("organization_roles")
      .update({
        name: payload.name,
        description: payload.description,
        color: payload.color,
        permissions: payload.permissions,
        ...(existing.built_in ? {} : { key: payload.key }),
      })
      .eq("organization_id", context.organizationId)
      .eq("id", roleId)
      .select()
      .single(),
    "Nie udało się zaktualizować roli.",
  );
};

const deleteRole = async (roleId, context) => {
  requirePermission(context, "roles.manage", "admin");
  const role = assertResult(
    await service
      .from("organization_roles")
      .select("id,name,built_in")
      .eq("organization_id", context.organizationId)
      .eq("id", roleId)
      .single(),
    "Nie znaleziono roli.",
  );
  if (role.built_in) {
    throw new HttpError(400, "Wbudowanej roli nie można usunąć.");
  }
  const { count } = await service
    .from("organization_members")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", context.organizationId)
    .eq("role_id", roleId);
  if ((count ?? 0) > 0) {
    throw new HttpError(409, "Najpierw przypisz członkom inną rolę.");
  }
  assertResult(
    await service
      .from("organization_roles")
      .delete()
      .eq("organization_id", context.organizationId)
      .eq("id", roleId),
    "Nie udało się usunąć roli.",
  );
  return { deleted: true, id: roleId };
};

const listUsers = async (context) => {
  const memberships = assertResult(
    await service
      .from("organization_members")
      .select(
        "organization_id,user_id,role,role_id,status,invited_at,joined_at,created_at,profile:profiles(id,full_name,avatar_url,last_seen_at),role_definition:organization_roles(id,key,name,color,permissions,built_in)",
      )
      .eq("organization_id", context.organizationId)
      .order("created_at"),
    "Nie udało się pobrać użytkowników.",
  );
  const usersById = new Map();
  for (let index = 0; index < memberships.length; index += 10) {
    const batch = memberships.slice(index, index + 10);
    const authUsers = await Promise.all(
      batch.map(async (membership) => {
        const { data, error } = await service.auth.admin.getUserById(
          membership.user_id,
        );
        return {
          id: membership.user_id,
          email: error ? null : data.user?.email ?? null,
        };
      }),
    );
    authUsers.forEach((user) => usersById.set(user.id, user.email));
  }
  return memberships.map((membership) => ({
    ...membership,
    email: usersById.get(membership.user_id) ?? null,
  }));
};

const inviteUser = async (body, context) => {
  requirePermission(context, "users.invite", "admin");
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email.includes("@")) throw new HttpError(400, "Podaj poprawny adres e-mail.");
  const roleQuery = service
    .from("organization_roles")
    .select("id,key")
    .eq("organization_id", context.organizationId);
  const roleDefinition = assertResult(
    body.role_id
      ? await roleQuery.eq("id", body.role_id).single()
      : await roleQuery.eq("key", body.role ?? "viewer").single(),
    "Nie znaleziono wybranej roli.",
  );

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
          role: roleDefinition.key,
          role_id: roleDefinition.id,
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
    { role: roleDefinition.key, role_id: roleDefinition.id },
  );
  return membership;
};

const updateMembership = async (userId, body, context) => {
  requirePermission(context, "users.manage", "admin");
  const patch = {};
  if (body.status !== undefined) {
    if (!["active", "invited", "suspended"].includes(body.status)) {
      throw new HttpError(400, "Nieprawidłowy status członkostwa.");
    }
    patch.status = body.status;
  }
  if (body.role_id !== undefined) {
    const role = assertResult(
      await service
        .from("organization_roles")
        .select("id,key")
        .eq("organization_id", context.organizationId)
        .eq("id", body.role_id)
        .single(),
      "Nie znaleziono wybranej roli.",
    );
    patch.role_id = role.id;
    patch.role = role.key;
  }
  if (Object.keys(patch).length === 0) {
    throw new HttpError(400, "Brak zmian do zapisania.");
  }
  const membership = assertResult(
    await service
      .from("organization_members")
      .update(patch)
      .eq("organization_id", context.organizationId)
      .eq("user_id", userId)
      .select(
        "organization_id,user_id,role,role_id,status,joined_at,invited_at",
      )
      .single(),
    "Nie udało się zaktualizować członkostwa.",
  );
  await writeAudit(
    context,
    "membership.updated",
    "organization_member",
    userId,
    userId,
    { after: patch },
  );
  return membership;
};

const deleteMembership = async (userId, context) => {
  requirePermission(context, "users.manage", "admin");
  if (userId === context.user.id) {
    throw new HttpError(400, "Nie możesz usunąć własnego aktywnego członkostwa.");
  }
  const membership = assertResult(
    await service
      .from("organization_members")
      .delete()
      .eq("organization_id", context.organizationId)
      .eq("user_id", userId)
      .select("user_id,role")
      .single(),
    "Nie udało się usunąć użytkownika z organizacji.",
  );
  return { deleted: true, user_id: membership.user_id };
};

const listSettings = async (context) => {
  requirePermission(context, "settings.view", "viewer");
  const [organization, settings] = await Promise.all([
    service
      .from("organizations")
      .select("id,name,slug,timezone,locale,settings,created_at,updated_at")
      .eq("id", context.organizationId)
      .single(),
    service
      .from("organization_settings")
      .select("key,value,updated_at")
      .eq("organization_id", context.organizationId)
      .eq("is_secret", false)
      .order("key"),
  ]);
  return {
    organization: assertResult(organization, "Nie udało się pobrać organizacji."),
    settings: Object.fromEntries(
      assertResult(settings, "Nie udało się pobrać ustawień.").map((item) => [
        item.key,
        item.value,
      ]),
    ),
  };
};

const updateSettings = async (body, context) => {
  requirePermission(context, "settings.manage", "admin");
  const organizationPatch = {};
  if (body.organization?.name !== undefined) {
    organizationPatch.name = String(body.organization.name).trim();
    if (!organizationPatch.name) {
      throw new HttpError(400, "Nazwa organizacji jest wymagana.");
    }
  }
  if (body.organization?.timezone !== undefined) {
    organizationPatch.timezone = String(body.organization.timezone).trim();
  }
  if (body.organization?.locale !== undefined) {
    organizationPatch.locale = String(body.organization.locale).trim();
  }
  if (Object.keys(organizationPatch).length > 0) {
    assertResult(
      await service
        .from("organizations")
        .update(organizationPatch)
        .eq("id", context.organizationId),
      "Nie udało się zaktualizować organizacji.",
    );
  }

  const settings =
    body.settings &&
    typeof body.settings === "object" &&
    !Array.isArray(body.settings)
      ? body.settings
      : {};
  const rows = Object.entries(settings).map(([key, value]) => {
    if (!/^[a-z0-9_.-]{2,100}$/.test(key)) {
      throw new HttpError(400, `Nieprawidłowy klucz ustawienia: ${key}`);
    }
    return {
      organization_id: context.organizationId,
      key,
      value,
      is_secret: false,
      updated_by: context.user.id,
      updated_at: new Date().toISOString(),
    };
  });
  if (rows.length > 100) {
    throw new HttpError(400, "Jednorazowo można zapisać maksymalnie 100 ustawień.");
  }
  if (rows.length > 0) {
    assertResult(
      await service
        .from("organization_settings")
        .upsert(rows, { onConflict: "organization_id,key" }),
      "Nie udało się zapisać ustawień.",
    );
  }
  await writeAudit(
    context,
    "settings.updated",
    "organization",
    context.organizationId,
    organizationPatch.name ?? context.organizationId,
    {
      organization_fields: Object.keys(organizationPatch),
      setting_keys: rows.map((row) => row.key),
    },
  );
  return listSettings(context);
};

const reportsResponse = async (event, context) => {
  requirePermission(context, "reports.view", "viewer");
  const days = safeInteger(event.queryStringParameters?.days, 14, 1, 365);
  return assertResult(
    await service.rpc("get_organization_report", {
      target_organization_id: context.organizationId,
      range_days: days,
    }),
    "Nie udało się obliczyć raportu.",
  );
};

const publicApiKey = (row) => ({
  id: row.id,
  name: row.name,
  prefix: row.key_prefix,
  scopes: row.scopes,
  status: row.status,
  rate_limit_per_minute: row.rate_limit_per_minute,
  allowed_ips: row.allowed_ips ?? [],
  expires_at: row.expires_at,
  last_used_at: row.last_used_at,
  last_used_ip: row.last_used_ip,
  usage_count: Number(row.usage_count ?? 0),
  created_by: row.created_by,
  created_at: row.created_at,
  updated_at: row.updated_at,
  revoked_at: row.revoked_at,
});

const listApiKeys = async (context) => {
  requirePermission(context, "api_keys.view", "admin");
  const rows = assertResult(
    await service
      .from("api_keys")
      .select(
        "id,name,key_prefix,scopes,status,rate_limit_per_minute,allowed_ips,expires_at,last_used_at,last_used_ip,usage_count,created_by,created_at,updated_at,revoked_at",
      )
      .eq("organization_id", context.organizationId)
      .order("created_at", { ascending: false }),
    "Nie udało się pobrać kluczy API.",
  );
  return {
    scopes: API_SCOPES,
    keys: rows.map(publicApiKey),
  };
};

const createApiKey = async (body, context) => {
  requirePermission(context, "api_keys.manage", "admin");
  const name = String(body.name ?? "").trim();
  if (!name) throw new HttpError(400, "Nazwa klucza API jest wymagana.");
  if (name.length > 120) {
    throw new HttpError(400, "Nazwa klucza API może mieć maksymalnie 120 znaków.");
  }
  const scopes = normalizeApiScopes(body.scopes);
  if (scopes.length === 0) {
    throw new HttpError(400, "Wybierz co najmniej jeden zakres API.");
  }
  let allowedIps;
  let expiresAt;
  try {
    allowedIps = validateAllowedIps(body.allowed_ips);
    expiresAt = validateExpiry(body.expires_at);
  } catch (error) {
    throw new HttpError(400, error.message);
  }
  const generated = generateApiKey();
  const keyRow = assertResult(
    await service
      .from("api_keys")
      .insert({
        organization_id: context.organizationId,
        name,
        key_prefix: generated.prefix,
        key_hash: generated.hash,
        scopes,
        status: "active",
        rate_limit_per_minute: safeInteger(
          body.rate_limit_per_minute,
          120,
          1,
          5000,
        ),
        allowed_ips: allowedIps,
        expires_at: expiresAt,
        created_by: context.user.id,
      })
      .select()
      .single(),
    "Nie udało się utworzyć klucza API.",
  );
  await writeAudit(
    context,
    "api_key.created",
    "api_key",
    keyRow.id,
    keyRow.name,
    { scopes, prefix: generated.prefix },
  );
  return {
    key: publicApiKey(keyRow),
    secret: generated.secret,
    warning:
      "Pełna wartość klucza jest wyświetlana tylko raz. Zapisz ją w menedżerze sekretów.",
  };
};

const updateApiKey = async (apiKeyId, body, context) => {
  requirePermission(context, "api_keys.manage", "admin");
  const patch = {};
  if (body.name !== undefined) {
    patch.name = String(body.name).trim();
    if (!patch.name) throw new HttpError(400, "Nazwa klucza jest wymagana.");
  }
  if (body.scopes !== undefined) {
    patch.scopes = normalizeApiScopes(body.scopes);
    if (patch.scopes.length === 0) {
      throw new HttpError(400, "Wybierz co najmniej jeden zakres API.");
    }
  }
  if (body.rate_limit_per_minute !== undefined) {
    patch.rate_limit_per_minute = safeInteger(
      body.rate_limit_per_minute,
      120,
      1,
      5000,
    );
  }
  try {
    if (body.allowed_ips !== undefined) {
      patch.allowed_ips = validateAllowedIps(body.allowed_ips);
    }
    if (body.expires_at !== undefined) {
      patch.expires_at = validateExpiry(body.expires_at);
    }
  } catch (error) {
    throw new HttpError(400, error.message);
  }
  if (Object.keys(patch).length === 0) {
    throw new HttpError(400, "Brak zmian do zapisania.");
  }
  const keyRow = assertResult(
    await service
      .from("api_keys")
      .update(patch)
      .eq("organization_id", context.organizationId)
      .eq("id", apiKeyId)
      .eq("status", "active")
      .select()
      .single(),
    "Nie udało się zaktualizować aktywnego klucza API.",
  );
  await writeAudit(
    context,
    "api_key.updated",
    "api_key",
    keyRow.id,
    keyRow.name,
    { fields: Object.keys(patch) },
  );
  return publicApiKey(keyRow);
};

const rotateApiKey = async (apiKeyId, context) => {
  requirePermission(context, "api_keys.manage", "admin");
  const existing = assertResult(
    await service
      .from("api_keys")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("id", apiKeyId)
      .eq("status", "active")
      .single(),
    "Nie znaleziono aktywnego klucza API.",
  );
  const generated = generateApiKey();
  const replacement = assertResult(
    await service
      .from("api_keys")
      .insert({
        organization_id: context.organizationId,
        name: existing.name,
        key_prefix: generated.prefix,
        key_hash: generated.hash,
        scopes: existing.scopes,
        status: "active",
        rate_limit_per_minute: existing.rate_limit_per_minute,
        allowed_ips: existing.allowed_ips,
        expires_at: existing.expires_at,
        created_by: context.user.id,
      })
      .select()
      .single(),
    "Nie udało się utworzyć klucza zastępczego.",
  );
  const revokedAt = new Date().toISOString();
  const { error: revokeError } = await service
    .from("api_keys")
    .update({ status: "revoked", revoked_at: revokedAt })
    .eq("organization_id", context.organizationId)
    .eq("id", existing.id)
    .eq("status", "active");
  if (revokeError) {
    await service.from("api_keys").delete().eq("id", replacement.id);
    throw new HttpError(
      400,
      "Nie udało się zakończyć rotacji klucza.",
      revokeError.message,
    );
  }
  await writeAudit(
    context,
    "api_key.rotated",
    "api_key",
    replacement.id,
    replacement.name,
    { previous_key_id: existing.id, prefix: generated.prefix },
  );
  return {
    key: publicApiKey(replacement),
    secret: generated.secret,
    warning:
      "Poprzedni klucz został natychmiast unieważniony. Nowy sekret jest widoczny tylko raz.",
  };
};

const revokeApiKey = async (apiKeyId, context) => {
  requirePermission(context, "api_keys.manage", "admin");
  const revokedAt = new Date().toISOString();
  const keyRow = assertResult(
    await service
      .from("api_keys")
      .update({ status: "revoked", revoked_at: revokedAt })
      .eq("organization_id", context.organizationId)
      .eq("id", apiKeyId)
      .eq("status", "active")
      .select()
      .single(),
    "Nie udało się unieważnić aktywnego klucza API.",
  );
  await writeAudit(
    context,
    "api_key.revoked",
    "api_key",
    keyRow.id,
    keyRow.name,
    { prefix: keyRow.key_prefix },
  );
  return publicApiKey(keyRow);
};

const listApiUsage = async (event, apiKeyId, context) => {
  requirePermission(context, "api_keys.view", "admin");
  const limit = safeInteger(event.queryStringParameters?.limit, 50, 1, 100);
  const keyRow = assertResult(
    await service
      .from("api_keys")
      .select("id,name,key_prefix")
      .eq("organization_id", context.organizationId)
      .eq("id", apiKeyId)
      .single(),
    "Nie znaleziono klucza API.",
  );
  const logs = assertResult(
    await service
      .from("api_request_logs")
      .select(
        "id,request_id,method,path,status_code,duration_ms,ip_address,user_agent,metadata,created_at",
      )
      .eq("organization_id", context.organizationId)
      .eq("api_key_id", apiKeyId)
      .order("created_at", { ascending: false })
      .limit(limit),
    "Nie udało się pobrać użycia klucza.",
  );
  return { key: keyRow, logs };
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
  if (/^categories\/[\w-]+$/.test(route) && method === "PATCH")
    return updateCategory(route.split("/")[1], body, context);
  if (/^categories\/[\w-]+$/.test(route) && method === "DELETE")
    return deleteCategory(route.split("/")[1], context);
  if (route === "rules" && method === "GET") return listRules(context);
  if (route === "rules" && method === "POST")
    return saveRule(null, body, context);
  if (/^rules\/[\w-]+$/.test(route) && method === "PATCH")
    return saveRule(route.split("/")[1], body, context);
  if (/^rules\/[\w-]+$/.test(route) && method === "DELETE")
    return deleteRule(route.split("/")[1], context);
  if (route === "automations" && method === "GET")
    return listAutomations(context);
  if (route === "automations" && method === "POST")
    return saveAutomation(null, body, context);
  if (/^automations\/[\w-]+$/.test(route) && method === "PATCH")
    return saveAutomation(route.split("/")[1], body, context);
  if (/^automations\/[\w-]+$/.test(route) && method === "DELETE")
    return deleteAutomation(route.split("/")[1], context);
  if (/^automations\/[\w-]+\/run$/.test(route) && method === "POST")
    return runAutomation(route.split("/")[1], body, context);
  if (route === "sources" && method === "GET") return listSources(context);
  if (route === "sources" && method === "POST")
    return createSource(body, context);
  if (route === "sources/test" && method === "POST")
    return testSourceDraft(body, context);
  if (/^sources\/[\w-]+$/.test(route) && method === "PATCH")
    return updateSource(route.split("/")[1], body, context);
  if (/^sources\/[\w-]+$/.test(route) && method === "DELETE")
    return deleteSource(route.split("/")[1], context);
  if (/^sources\/[\w-]+\/test$/.test(route) && method === "POST")
    return testStoredSource(route.split("/")[1], context);
  if (/^sources\/[\w-]+\/sync$/.test(route) && method === "POST")
    return syncSource(route.split("/")[1], context);
  if (route === "delivery-accounts" && method === "GET")
    return listDeliveryAccounts(context);
  if (route === "delivery-accounts" && method === "POST")
    return createDeliveryAccount(body, context);
  if (route === "delivery-accounts/test" && method === "POST")
    return testDeliveryDraft(body, context);
  if (/^delivery-accounts\/[\w-]+$/.test(route) && method === "PATCH")
    return updateDeliveryAccount(route.split("/")[1], body, context);
  if (/^delivery-accounts\/[\w-]+$/.test(route) && method === "DELETE")
    return deleteDeliveryAccount(route.split("/")[1], context);
  if (/^delivery-accounts\/[\w-]+\/test$/.test(route) && method === "POST")
    return testStoredDeliveryAccount(route.split("/")[1], context);
  if (route === "templates" && method === "GET")
    return listTemplates(context);
  if (route === "templates" && method === "POST")
    return saveTemplate(null, body, context);
  if (/^templates\/[\w-]+$/.test(route) && method === "PATCH")
    return saveTemplate(route.split("/")[1], body, context);
  if (/^templates\/[\w-]+$/.test(route) && method === "DELETE")
    return deleteTemplate(route.split("/")[1], context);
  if (route === "outbound-messages" && method === "GET")
    return listOutboundMessages(event, context);
  if (route === "outbound-messages" && method === "POST")
    return createOutboundMessage(body, context);
  if (route === "organizations" && method === "GET")
    return listOrganizations(context);
  if (route === "roles" && method === "GET") return listRoles(context);
  if (route === "roles" && method === "POST")
    return saveRole(null, body, context);
  if (/^roles\/[\w-]+$/.test(route) && method === "PATCH")
    return saveRole(route.split("/")[1], body, context);
  if (/^roles\/[\w-]+$/.test(route) && method === "DELETE")
    return deleteRole(route.split("/")[1], context);
  if (route === "users" && method === "GET") return listUsers(context);
  if (route === "users/invite" && method === "POST")
    return inviteUser(body, context);
  if (/^users\/[\w-]+\/membership$/.test(route) && method === "PATCH")
    return updateMembership(route.split("/")[1], body, context);
  if (/^users\/[\w-]+\/membership$/.test(route) && method === "DELETE")
    return deleteMembership(route.split("/")[1], context);
  if (route === "settings" && method === "GET")
    return listSettings(context);
  if (route === "settings" && method === "PATCH")
    return updateSettings(body, context);
  if (route === "reports" && method === "GET")
    return reportsResponse(event, context);
  if (route === "api-keys" && method === "GET")
    return listApiKeys(context);
  if (route === "api-keys" && method === "POST")
    return createApiKey(body, context);
  if (/^api-keys\/[\w-]+$/.test(route) && method === "PATCH")
    return updateApiKey(route.split("/")[1], body, context);
  if (/^api-keys\/[\w-]+$/.test(route) && method === "DELETE")
    return revokeApiKey(route.split("/")[1], context);
  if (/^api-keys\/[\w-]+\/rotate$/.test(route) && method === "POST")
    return rotateApiKey(route.split("/")[1], context);
  if (/^api-keys\/[\w-]+\/usage$/.test(route) && method === "GET")
    return listApiUsage(event, route.split("/")[1], context);
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
