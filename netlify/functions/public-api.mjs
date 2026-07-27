import crypto from "node:crypto";
import {
  clientIp,
  encodeCursor,
  extractApiKey,
  hashApiKey,
  parseCursor,
} from "./_shared/api-keys.mjs";
import { safeInteger, serviceClient } from "./_shared/server.mjs";

const allowedOrigins = (process.env.PUBLIC_API_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

class ApiHttpError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const writableMessageStatuses = new Set([
  "new",
  "classified",
  "review",
  "automated",
  "failed",
  "archived",
]);

const response = (statusCode, body, headers = {}) => ({
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
  const allowed =
    origin &&
    (allowedOrigins.includes(origin) ||
      (allowedOrigins.length === 0 &&
        /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)));
  return {
    ...(allowed ? { "access-control-allow-origin": origin } : {}),
    "access-control-allow-headers":
      "authorization, content-type, idempotency-key, x-api-key",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    vary: "Origin",
  };
};

const getRoute = (event) =>
  event.path
    .replace(/^\/\.netlify\/functions\/public-api/, "")
    .replace(/^\/v1/, "")
    .replace(/^\/+|\/+$/g, "");

const parseBody = (event) => {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  if (Buffer.byteLength(raw, "utf8") > 1_000_000) {
    throw new ApiHttpError(
      413,
      "payload_too_large",
      "Treść żądania może mieć maksymalnie 1 MB.",
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiHttpError(
      400,
      "invalid_json",
      "Treść żądania nie jest poprawnym JSON-em.",
    );
  }
};

const assertResult = ({ data, error }, message) => {
  if (error) {
    throw new ApiHttpError(400, "database_error", message, error.message);
  }
  return data;
};

const assertFound = ({ data, error }, message) => {
  if (error) {
    if (error.code === "PGRST116") {
      throw new ApiHttpError(404, "not_found", message);
    }
    throw new ApiHttpError(400, "database_error", message, error.message);
  }
  if (!data) throw new ApiHttpError(404, "not_found", message);
  return data;
};

const requiredScope = (method, route) => {
  if (route === "me") return "";
  if (route === "messages" && method === "GET") return "messages:read";
  if (route === "messages" && method === "POST") return "messages:write";
  if (/^messages\/[\w-]+$/.test(route)) {
    return method === "GET" ? "messages:read" : "messages:write";
  }
  if (route === "categories") {
    return method === "GET" ? "categories:read" : "categories:write";
  }
  if (/^categories\/[\w-]+$/.test(route)) {
    return method === "GET" ? "categories:read" : "categories:write";
  }
  if (route === "sources" && method === "GET") return "sources:read";
  if (/^sources\/[\w-]+\/sync$/.test(route)) return "sources:sync";
  if (route === "templates" && method === "GET") return "templates:read";
  if (route === "outbound-messages" && method === "GET") {
    return "outbound:read";
  }
  if (route === "outbound-messages" && method === "POST") {
    return "outbound:write";
  }
  if (/^outbound-messages\/[\w-]+$/.test(route) && method === "GET") {
    return "outbound:read";
  }
  if (route === "audit" && method === "GET") return "audit:read";
  return "";
};

const authorize = async (event, service, scope) => {
  const rawKey = extractApiKey(event.headers);
  if (!rawKey || !rawKey.startsWith("mfs_")) {
    throw new ApiHttpError(
      401,
      "invalid_api_key",
      "Podaj klucz w Authorization: Bearer lub X-API-Key.",
    );
  }
  const ip = clientIp(event.headers);
  const rows = assertResult(
    await service.rpc("authorize_api_key", {
      candidate_hash: hashApiKey(rawKey),
      requested_scope: scope,
      source_ip: ip,
    }),
    "Nie udało się zweryfikować klucza API.",
  );
  const authorization = rows?.[0];
  if (!authorization?.authorized) {
    const reason = authorization?.reason ?? "invalid_key";
    const errors = {
      invalid_key: [401, "invalid_api_key", "Klucz API jest nieprawidłowy lub unieważniony."],
      expired: [401, "expired_api_key", "Klucz API wygasł."],
      ip_not_allowed: [403, "ip_not_allowed", "Adres IP nie znajduje się na allowliście klucza."],
      scope_missing: [403, "scope_missing", `Klucz nie ma wymaganego zakresu ${scope}.`],
      rate_limit_exceeded: [429, "rate_limit_exceeded", "Przekroczono limit żądań klucza API."],
    };
    const [statusCode, code, message] = errors[reason] ?? errors.invalid_key;
    throw new ApiHttpError(statusCode, code, message);
  }
  return {
    id: authorization.api_key_id,
    organizationId: authorization.organization_id,
    name: authorization.api_key_name,
    scopes: authorization.api_key_scopes ?? [],
    remaining: authorization.remaining,
    resetAt: authorization.reset_at,
    ip,
  };
};

const listMessages = async (event, service, context) => {
  const params = event.queryStringParameters ?? {};
  const limit = safeInteger(params.limit, 50, 1, 100);
  const cursor = parseCursor(params.cursor);
  if (params.cursor && !cursor) {
    throw new ApiHttpError(400, "invalid_cursor", "Kursor paginacji jest nieprawidłowy.");
  }
  let query = service
    .from("messages")
    .select(
      "id,external_id,thread_id,direction,sender_email,sender_name,recipients,subject,preview,received_at,status,score,review_reason,tags,processed_at,created_at,category:categories(id,name,slug,color),source:source_connectors(id,name,type)",
    )
    .eq("organization_id", context.organizationId)
    .order("received_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (cursor?.id) {
    query = query.or(
      `received_at.lt.${cursor.timestamp},and(received_at.eq.${cursor.timestamp},id.lt.${cursor.id})`,
    );
  } else if (cursor) {
    query = query.lt("received_at", cursor.timestamp);
  }
  if (params.status) query = query.eq("status", params.status);
  if (params.direction) query = query.eq("direction", params.direction);
  if (params.category_id) query = query.eq("category_id", params.category_id);
  if (params.source_id) query = query.eq("source_connector_id", params.source_id);
  if (params.search) {
    query = query.textSearch("search_vector", params.search, {
      config: "simple",
      type: "websearch",
    });
  }
  const rows = assertResult(await query, "Nie udało się pobrać wiadomości.");
  const items = rows.slice(0, limit);
  return {
    items,
    next_cursor:
      rows.length > limit && items.length > 0
        ? encodeCursor(items.at(-1).received_at, items.at(-1).id)
        : null,
  };
};

const getMessage = async (messageId, service, context) => {
  const message = assertFound(
    await service
      .from("messages")
      .select(
        "*,category:categories(id,name,slug,color),source:source_connectors(id,name,type),attachments:message_attachments(id,filename,content_type,size_bytes,extraction_status,metadata),rule_matches:message_rule_matches(id,rule_id,rule_version,matched,score_delta,condition_results,actions_executed,evaluated_at)",
      )
      .eq("organization_id", context.organizationId)
      .eq("id", messageId)
      .single(),
    "Nie znaleziono wiadomości.",
  );
  return message;
};

const ingestMessage = async (event, body, service, context) => {
  const senderEmail = String(body.sender_email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
    throw new ApiHttpError(400, "invalid_sender", "Podaj poprawny sender_email.");
  }
  const externalId = String(
    body.external_id ?? event.headers?.["idempotency-key"] ?? "",
  ).trim();
  if (!externalId) {
    throw new ApiHttpError(
      400,
      "idempotency_required",
      "Podaj external_id lub nagłówek Idempotency-Key.",
    );
  }
  if (externalId.length > 500) {
    throw new ApiHttpError(400, "invalid_external_id", "external_id jest zbyt długi.");
  }
  const receivedAt = body.received_at
    ? new Date(body.received_at)
    : new Date();
  if (Number.isNaN(receivedAt.getTime())) {
    throw new ApiHttpError(400, "invalid_date", "received_at musi być datą ISO 8601.");
  }
  const recipients = Array.isArray(body.recipients) ? body.recipients : [];
  if (recipients.length > 100) {
    throw new ApiHttpError(400, "too_many_recipients", "Maksymalnie 100 odbiorców.");
  }
  if (body.source_id) {
    assertResult(
      await service
        .from("source_connectors")
        .select("id")
        .eq("organization_id", context.organizationId)
        .eq("id", body.source_id)
        .single(),
      "Nie znaleziono źródła w tej organizacji.",
    );
  }
  const dedupeHash = crypto
    .createHash("sha256")
    .update(`${context.organizationId}|public-api|${externalId}`)
    .digest("hex");
  const payload = {
    organization_id: context.organizationId,
    source_connector_id: body.source_id ?? null,
    external_id: externalId,
    thread_id: body.thread_id ?? null,
    direction: body.direction === "outgoing" ? "outgoing" : "incoming",
    sender_email: senderEmail,
    sender_name: body.sender_name ?? null,
    recipients,
    subject: String(body.subject ?? "").slice(0, 2000),
    preview: body.preview ?? String(body.body_text ?? "").slice(0, 500),
    body_text: body.body_text ?? null,
    body_html: body.body_html ?? null,
    headers:
      body.headers && typeof body.headers === "object" ? body.headers : {},
    received_at: receivedAt.toISOString(),
    status: "new",
    tags: Array.isArray(body.tags)
      ? body.tags.map(String).slice(0, 50)
      : [],
    dedupe_hash: dedupeHash,
  };
  const { data: inserted, error } = await service
    .from("messages")
    .insert(payload)
    .select(
      "id,external_id,direction,sender_email,subject,received_at,status,created_at",
    )
    .maybeSingle();
  if (error && error.code !== "23505") {
    throw new ApiHttpError(400, "database_error", "Nie udało się dodać wiadomości.", error.message);
  }
  if (inserted) return { created: true, message: inserted };
  const existing = assertResult(
    await service
      .from("messages")
      .select(
        "id,external_id,direction,sender_email,subject,received_at,status,created_at",
      )
      .eq("organization_id", context.organizationId)
      .eq("dedupe_hash", dedupeHash)
      .single(),
    "Wiadomość istnieje, ale nie udało się odczytać duplikatu.",
  );
  return { created: false, message: existing };
};

export const normalizeMessagePatch = (body) => {
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
    throw new ApiHttpError(400, "no_changes", "Brak dozwolonych pól do aktualizacji.");
  }

  if (
    Object.hasOwn(patch, "status") &&
    !writableMessageStatuses.has(patch.status)
  ) {
    throw new ApiHttpError(
      400,
      "invalid_status",
      "Status wiadomości jest nieprawidłowy.",
    );
  }
  if (
    Object.hasOwn(patch, "score") &&
    (!Number.isInteger(patch.score) || patch.score < 0 || patch.score > 100)
  ) {
    throw new ApiHttpError(
      400,
      "invalid_score",
      "Score wiadomości musi być liczbą całkowitą od 0 do 100.",
    );
  }
  for (const field of ["category_id", "review_assignee_id"]) {
    if (
      Object.hasOwn(patch, field) &&
      patch[field] !== null &&
      (typeof patch[field] !== "string" || !uuidPattern.test(patch[field]))
    ) {
      throw new ApiHttpError(
        400,
        "invalid_reference",
        `${field} musi być identyfikatorem UUID albo null.`,
      );
    }
  }
  if (
    Object.hasOwn(patch, "review_reason") &&
    patch.review_reason !== null &&
    (typeof patch.review_reason !== "string" ||
      patch.review_reason.length > 2000)
  ) {
    throw new ApiHttpError(
      400,
      "invalid_review_reason",
      "Powód weryfikacji może mieć maksymalnie 2000 znaków.",
    );
  }
  if (Object.hasOwn(patch, "tags")) {
    if (
      !Array.isArray(patch.tags) ||
      patch.tags.length > 50 ||
      patch.tags.some(
        (tag) => typeof tag !== "string" || tag.trim().length > 100,
      )
    ) {
      throw new ApiHttpError(
        400,
        "invalid_tags",
        "Tagi muszą być tablicą do 50 wartości, każda do 100 znaków.",
      );
    }
    patch.tags = [
      ...new Set(patch.tags.map((tag) => tag.trim()).filter(Boolean)),
    ];
  }
  return patch;
};

const updateMessage = async (messageId, body, service, context) => {
  const patch = normalizeMessagePatch(body);

  if (patch.category_id) {
    const category = await service
      .from("categories")
      .select("id")
      .eq("organization_id", context.organizationId)
      .eq("id", patch.category_id)
      .maybeSingle();
    if (category.error) {
      throw new ApiHttpError(
        400,
        "database_error",
        "Nie udało się zweryfikować kategorii.",
        category.error.message,
      );
    }
    if (!category.data) {
      throw new ApiHttpError(
        400,
        "invalid_category",
        "Kategoria nie istnieje w organizacji klucza.",
      );
    }
  }

  if (patch.review_assignee_id) {
    const membership = await service
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", context.organizationId)
      .eq("user_id", patch.review_assignee_id)
      .eq("status", "active")
      .maybeSingle();
    if (membership.error) {
      throw new ApiHttpError(
        400,
        "database_error",
        "Nie udało się zweryfikować osoby przypisanej.",
        membership.error.message,
      );
    }
    if (!membership.data) {
      throw new ApiHttpError(
        400,
        "invalid_assignee",
        "Osoba przypisana nie jest aktywnym członkiem tej organizacji.",
      );
    }
  }

  return assertFound(
    await service
      .from("messages")
      .update(patch)
      .eq("organization_id", context.organizationId)
      .eq("id", messageId)
      .select(
        "id,external_id,status,category_id,score,review_reason,tags,updated_at",
      )
      .single(),
    "Nie znaleziono wiadomości w organizacji klucza.",
  );
};

const listCategories = async (service, context) =>
  assertResult(
    await service
      .from("categories")
      .select("*")
      .eq("organization_id", context.organizationId)
      .order("name"),
    "Nie udało się pobrać kategorii.",
  );

const categoryPayload = (body) => {
  const name = body.name === undefined ? undefined : String(body.name).trim();
  const slugSource = body.slug ?? name;
  const slug =
    slugSource === undefined
      ? undefined
      : String(slugSource)
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
  return {
    ...(name !== undefined ? { name } : {}),
    ...(slug !== undefined ? { slug } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.color !== undefined ? { color: body.color } : {}),
    ...(body.icon !== undefined ? { icon: body.icon } : {}),
    ...(body.default_score !== undefined
      ? { default_score: Math.min(100, Math.max(-100, Number(body.default_score) || 0)) }
      : {}),
    ...(body.active !== undefined ? { active: Boolean(body.active) } : {}),
  };
};

const createCategory = async (body, service, context) => {
  const payload = categoryPayload(body);
  if (!payload.name || !payload.slug) {
    throw new ApiHttpError(400, "invalid_category", "Nazwa kategorii jest wymagana.");
  }
  return assertFound(
    await service
      .from("categories")
      .insert({
        organization_id: context.organizationId,
        color: "#64748b",
        active: true,
        ...payload,
      })
      .select()
      .single(),
    "Nie udało się utworzyć kategorii.",
  );
};

const updateCategory = async (categoryId, body, service, context) => {
  const payload = categoryPayload(body);
  if (Object.keys(payload).length === 0) {
    throw new ApiHttpError(400, "no_changes", "Brak zmian do zapisania.");
  }
  return assertResult(
    await service
      .from("categories")
      .update(payload)
      .eq("organization_id", context.organizationId)
      .eq("id", categoryId)
      .select()
      .single(),
    "Nie znaleziono kategorii w organizacji klucza.",
  );
};

const deleteCategory = async (categoryId, service, context) => {
  const row = assertFound(
    await service
      .from("categories")
      .delete()
      .eq("organization_id", context.organizationId)
      .eq("id", categoryId)
      .select("id")
      .single(),
    "Nie znaleziono kategorii w organizacji klucza.",
  );
  return { deleted: true, id: row.id };
};

const listSources = async (service, context) =>
  assertResult(
    await service
      .from("source_connectors")
      .select(
        "id,type,name,address,status,sync_interval_minutes,folders,public_config,last_sync_at,next_sync_at,last_error,created_at,updated_at",
      )
      .eq("organization_id", context.organizationId)
      .order("name"),
    "Nie udało się pobrać źródeł.",
  );

const syncSource = async (sourceId, service, context) =>
  assertFound(
    await service
      .from("source_connectors")
      .update({
        status: "active",
        next_sync_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("organization_id", context.organizationId)
      .eq("id", sourceId)
      .neq("type", "webhook")
      .select(
        "id,type,name,status,last_sync_at,next_sync_at,last_error",
      )
      .single(),
    "Nie znaleziono synchronizowalnego źródła w organizacji klucza.",
  );

const listTemplates = async (service, context) =>
  assertResult(
    await service
      .from("templates")
      .select(
        "id,name,description,kind,template_type,subject_template,text_template,html_template,variables,active,version,created_at,updated_at",
      )
      .eq("organization_id", context.organizationId)
      .eq("active", true)
      .order("updated_at", { ascending: false }),
    "Nie udało się pobrać szablonów.",
  );

const listOutbound = async (event, service, context) => {
  const limit = safeInteger(event.queryStringParameters?.limit, 50, 1, 100);
  return assertResult(
    await service
      .from("outbound_messages")
      .select(
        "id,subject,status,scheduled_at,started_at,completed_at,recipient_count,delivered_count,failed_count,created_at,account:delivery_accounts(id,name,from_email,provider),template:templates(id,name)",
      )
      .eq("organization_id", context.organizationId)
      .order("created_at", { ascending: false })
      .limit(limit),
    "Nie udało się pobrać wysyłek.",
  );
};

const getOutbound = async (outboundId, service, context) =>
  assertFound(
    await service
      .from("outbound_messages")
      .select(
        "*,account:delivery_accounts(id,name,from_email,provider),template:templates(id,name),recipients:outbound_recipients(id,email,name,status,provider_message_id,sent_at,delivered_at,opened_at,clicked_at,failed_at,error_message)",
      )
      .eq("organization_id", context.organizationId)
      .eq("id", outboundId)
      .single(),
    "Nie znaleziono wysyłki.",
  );

const createOutbound = async (body, service, context) => {
  const subject = String(body.subject ?? "").trim();
  if (!subject) {
    throw new ApiHttpError(400, "invalid_subject", "Temat wiadomości jest wymagany.");
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
      throw new ApiHttpError(
        400,
        "invalid_recipient",
        `Odbiorca na pozycji ${index + 1} ma nieprawidłowy adres e-mail.`,
      );
    }
    if (!recipientMap.has(normalized.email)) {
      recipientMap.set(normalized.email, normalized);
    }
  }
  const recipients = [...recipientMap.values()];
  if (recipients.length === 0 || recipients.length > 10_000) {
    throw new ApiHttpError(
      400,
      "invalid_recipients",
      "Podaj od 1 do 10 000 poprawnych odbiorców.",
    );
  }
  const requestedStatus = body.status ?? "draft";
  if (!["draft", "pending", "scheduled"].includes(requestedStatus)) {
    throw new ApiHttpError(
      400,
      "invalid_status",
      "Status wysyłki musi mieć wartość draft, pending albo scheduled.",
    );
  }
  const status = requestedStatus;
  let scheduledAt = null;
  if (status === "scheduled") {
    const timestamp = Date.parse(String(body.scheduled_at ?? ""));
    if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
      throw new ApiHttpError(
        400,
        "invalid_schedule",
        "Zaplanowana data musi przypadać w przyszłości.",
      );
    }
    scheduledAt = new Date(timestamp).toISOString();
  }
  if (status !== "draft" && !body.delivery_account_id) {
    throw new ApiHttpError(
      400,
      "delivery_account_required",
      "Wybierz delivery_account_id.",
    );
  }
  if (body.delivery_account_id) {
    assertResult(
      await service
        .from("delivery_accounts")
        .select("id")
        .eq("organization_id", context.organizationId)
        .eq("id", body.delivery_account_id)
        .single(),
      "Nie znaleziono konta wysyłkowego.",
    );
  }
  const outboundResult = assertResult(
    await service.rpc("create_outbound_with_recipients", {
      target_organization_id: context.organizationId,
      target_delivery_account_id: body.delivery_account_id ?? null,
      target_template_id: body.template_id ?? null,
      target_source_message_id: body.source_message_id ?? null,
      outbound_subject: subject,
      outbound_text_body: body.text_body ?? null,
      outbound_html_body: body.html_body ?? null,
      outbound_audience_definition: {
        type: "public_api",
        count: recipients.length,
      },
      outbound_status: status,
      outbound_scheduled_at: scheduledAt,
      target_created_by: null,
      recipient_payload: recipients,
    }),
    "Nie udało się utworzyć wysyłki.",
  );
  const outbound = Array.isArray(outboundResult)
    ? outboundResult[0]
    : outboundResult;
  if (!outbound?.id) {
    throw new ApiHttpError(
      500,
      "database_error",
      "Baza nie zwróciła utworzonej wysyłki.",
    );
  }
  return outbound;
};

const listAudit = async (event, service, context) => {
  const limit = safeInteger(event.queryStringParameters?.limit, 50, 1, 100);
  return assertResult(
    await service
      .from("audit_events")
      .select(
        "id,actor_type,action,target_type,target_id,target_label,severity,ip_address,metadata,created_at",
      )
      .eq("organization_id", context.organizationId)
      .order("created_at", { ascending: false })
      .limit(limit),
    "Nie udało się pobrać audytu.",
  );
};

const handleRoute = async (event, service, context) => {
  const method = event.httpMethod.toUpperCase();
  const route = getRoute(event);
  const body = ["POST", "PATCH", "PUT"].includes(method)
    ? parseBody(event)
    : {};

  if (route === "me" && method === "GET") {
    return {
      statusCode: 200,
      data: {
        organization_id: context.organizationId,
        api_key: {
          id: context.id,
          name: context.name,
          scopes: context.scopes,
        },
      },
    };
  }
  if (route === "messages" && method === "GET") {
    return { statusCode: 200, data: await listMessages(event, service, context) };
  }
  if (route === "messages" && method === "POST") {
    const result = await ingestMessage(event, body, service, context);
    return { statusCode: result.created ? 201 : 200, data: result };
  }
  if (/^messages\/[\w-]+$/.test(route) && method === "GET") {
    return {
      statusCode: 200,
      data: await getMessage(route.split("/")[1], service, context),
    };
  }
  if (/^messages\/[\w-]+$/.test(route) && method === "PATCH") {
    return {
      statusCode: 200,
      data: await updateMessage(route.split("/")[1], body, service, context),
    };
  }
  if (route === "categories" && method === "GET") {
    return { statusCode: 200, data: await listCategories(service, context) };
  }
  if (route === "categories" && method === "POST") {
    return {
      statusCode: 201,
      data: await createCategory(body, service, context),
    };
  }
  if (/^categories\/[\w-]+$/.test(route) && method === "PATCH") {
    return {
      statusCode: 200,
      data: await updateCategory(route.split("/")[1], body, service, context),
    };
  }
  if (/^categories\/[\w-]+$/.test(route) && method === "DELETE") {
    return {
      statusCode: 200,
      data: await deleteCategory(route.split("/")[1], service, context),
    };
  }
  if (route === "sources" && method === "GET") {
    return { statusCode: 200, data: await listSources(service, context) };
  }
  if (/^sources\/[\w-]+\/sync$/.test(route) && method === "POST") {
    return {
      statusCode: 202,
      data: await syncSource(route.split("/")[1], service, context),
    };
  }
  if (route === "templates" && method === "GET") {
    return { statusCode: 200, data: await listTemplates(service, context) };
  }
  if (route === "outbound-messages" && method === "GET") {
    return { statusCode: 200, data: await listOutbound(event, service, context) };
  }
  if (route === "outbound-messages" && method === "POST") {
    return {
      statusCode: 201,
      data: await createOutbound(body, service, context),
    };
  }
  if (/^outbound-messages\/[\w-]+$/.test(route) && method === "GET") {
    return {
      statusCode: 200,
      data: await getOutbound(route.split("/")[1], service, context),
    };
  }
  if (route === "audit" && method === "GET") {
    return { statusCode: 200, data: await listAudit(event, service, context) };
  }
  throw new ApiHttpError(404, "not_found", "Nie znaleziono endpointu API.");
};

const writeRequestLog = async (
  service,
  context,
  requestId,
  event,
  statusCode,
  durationMs,
) => {
  if (!context?.organizationId) return;
  const { error } = await service.from("api_request_logs").insert({
    organization_id: context.organizationId,
    api_key_id: context.id,
    request_id: requestId,
    method: event.httpMethod.toUpperCase(),
    path: getRoute(event),
    status_code: statusCode,
    duration_ms: durationMs,
    ip_address: context.ip,
    user_agent: String(event.headers?.["user-agent"] ?? "").slice(0, 500) || null,
  });
  if (error) {
    console.error("api_request_log_failed", {
      requestId,
      error: error.message,
    });
  }
};

const writeApiAudit = async (
  service,
  context,
  requestId,
  event,
  result,
) => {
  const method = event.httpMethod.toUpperCase();
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(method)) return;
  const route = getRoute(event);
  const targetType = route.split("/")[0] || "api";
  const possibleId =
    result?.id ??
    result?.message?.id ??
    result?.data?.id ??
    route.split("/")[1] ??
    null;
  const targetId =
    typeof possibleId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      possibleId,
    )
      ? possibleId
      : null;
  const { error } = await service.from("audit_events").insert({
    organization_id: context.organizationId,
    actor_type: "api",
    action: `api.${method.toLowerCase()}.${targetType.replaceAll("-", "_")}`,
    target_type: targetType,
    target_id: targetId,
    target_label: route,
    severity: "info",
    ip_address: context.ip,
    user_agent: String(event.headers?.["user-agent"] ?? "").slice(0, 500) || null,
    metadata: {
      api_key_id: context.id,
      api_key_name: context.name,
      request_id: requestId,
      method,
      route,
    },
  });
  if (error) {
    console.error("api_audit_write_failed", {
      requestId,
      error: error.message,
    });
  }
};

export const handler = async (event) => {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const cors = corsHeaders(event);
  const baseHeaders = {
    ...cors,
    "x-request-id": requestId,
  };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: baseHeaders, body: "" };
  }
  const route = getRoute(event);
  if (route === "health" && event.httpMethod === "GET") {
    return response(
      200,
      {
        ok: true,
        data: {
          service: "mailflow-public-api",
          version: "v1",
          timestamp: new Date().toISOString(),
        },
        request_id: requestId,
      },
      baseHeaders,
    );
  }

  let service;
  let context;
  let statusCode = 500;
  try {
    service = serviceClient();
    const scope = requiredScope(event.httpMethod.toUpperCase(), route);
    context = await authorize(event, service, scope);
    const result = await handleRoute(event, service, context);
    statusCode = result.statusCode;
    const headers = {
      ...baseHeaders,
      "x-ratelimit-remaining": String(context.remaining),
      "x-ratelimit-reset": String(
        Math.floor(new Date(context.resetAt).getTime() / 1000),
      ),
    };
    await writeApiAudit(service, context, requestId, event, result.data);
    await writeRequestLog(
      service,
      context,
      requestId,
      event,
      statusCode,
      Date.now() - startedAt,
    );
    return response(
      statusCode,
      { ok: true, data: result.data, request_id: requestId },
      headers,
    );
  } catch (error) {
    statusCode = error instanceof ApiHttpError ? error.statusCode : 500;
    if (service && context) {
      await writeRequestLog(
        service,
        context,
        requestId,
        event,
        statusCode,
        Date.now() - startedAt,
      );
    }
    if (statusCode >= 500) {
      console.error("public_api_error", {
        requestId,
        method: event.httpMethod,
        route,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return response(
      statusCode,
      {
        ok: false,
        error: {
          code:
            error instanceof ApiHttpError
              ? error.code
              : "internal_server_error",
          message:
            error instanceof ApiHttpError
              ? error.message
              : "Wystąpił nieoczekiwany błąd serwera.",
          ...(error instanceof ApiHttpError && error.details
            ? { details: error.details }
            : {}),
        },
        request_id: requestId,
      },
      baseHeaders,
    );
  }
};
