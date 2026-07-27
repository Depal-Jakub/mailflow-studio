import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import {
  getConnectorSecret,
  requireInternalSecret,
  response,
  safeInteger,
  serviceClient,
  sha256,
} from "./_shared/server.mjs";

const authorize = (event) => {
  if (event.next_run) return;
  requireInternalSecret(event);
};

const asHtml = (value) => {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return null;
};

const parsedMessage = (mail, externalId, threadId, receivedAt) => {
  const sender = mail.from?.value?.[0];
  return {
    externalId,
    threadId,
    senderEmail: sender?.address?.toLowerCase() ?? "unknown@example.invalid",
    senderName: sender?.name ?? null,
    recipients: (mail.to?.value ?? []).map((recipient) => ({
      email: recipient.address?.toLowerCase(),
      name: recipient.name || undefined,
    })),
    subject: mail.subject ?? "",
    preview: mail.text?.replace(/\s+/g, " ").trim().slice(0, 500) ?? "",
    bodyText: mail.text ?? null,
    bodyHtml: asHtml(mail.html),
    receivedAt:
      (mail.date instanceof Date ? mail.date : receivedAt)?.toISOString() ??
      new Date().toISOString(),
    headers: Object.fromEntries(
      [...(mail.headers?.entries?.() ?? [])]
        .slice(0, 100)
        .map(([key, value]) => [key, String(value).slice(0, 2000)]),
    ),
    attachments: (mail.attachments ?? []).slice(0, 100).map((attachment) => ({
      external_id: attachment.contentId || null,
      filename: attachment.filename || "zalacznik",
      content_type: attachment.contentType || null,
      size_bytes: attachment.size || attachment.content?.byteLength || 0,
      metadata: {
        checksum: attachment.checksum || null,
        content_disposition: attachment.contentDisposition || null,
      },
    })),
  };
};

const refreshGoogleToken = async (credentials) => {
  const body = new URLSearchParams({
    client_id: credentials.clientId ?? credentials.client_id ?? "",
    client_secret: credentials.clientSecret ?? credentials.client_secret ?? "",
    refresh_token: credentials.refreshToken ?? credentials.refresh_token ?? "",
    grant_type: "refresh_token",
  });
  const result = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await result.json();
  if (!result.ok || !payload.access_token) {
    throw new Error(`Google OAuth failed: ${payload.error_description ?? payload.error}`);
  }
  return payload.access_token;
};

const fetchGmail = async (connector, credentials, limit) => {
  const token = await refreshGoogleToken(credentials);
  const lookbackDays = safeInteger(
    connector.public_config?.initial_lookback_days,
    30,
    1,
    3650,
  );
  const since = connector.last_sync_at
    ? Math.floor((new Date(connector.last_sync_at).getTime() - 3_600_000) / 1000)
    : Math.floor((Date.now() - lookbackDays * 86_400_000) / 1000);
  const query = new URLSearchParams({
    maxResults: String(Math.min(limit, 100)),
    q: `after:${since}`,
  });
  const listResponse = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    },
  );
  const listPayload = await listResponse.json();
  if (!listResponse.ok) {
    throw new Error(`Gmail list failed: ${listPayload.error?.message ?? listResponse.status}`);
  }

  const results = [];
  for (const item of (listPayload.messages ?? []).slice(0, limit)) {
    const messageResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=raw`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    const messagePayload = await messageResponse.json();
    if (!messageResponse.ok || !messagePayload.raw) {
      throw new Error(
        `Gmail message ${item.id} failed: ${messagePayload.error?.message ?? messageResponse.status}`,
      );
    }
    const raw = Buffer.from(
      messagePayload.raw.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    );
    const mail = await simpleParser(raw, { skipImageLinks: true });
    results.push(
      parsedMessage(
        mail,
        item.id,
        messagePayload.threadId,
        new Date(Number(messagePayload.internalDate)),
      ),
    );
  }
  return results;
};

const fetchImap = async (connector, credentials, limit) => {
  const client = new ImapFlow({
    host: credentials.host,
    port: Number(credentials.port ?? 993),
    secure: credentials.secure !== false,
    auth: {
      user: credentials.username ?? credentials.user,
      pass: credentials.password,
      accessToken: credentials.accessToken,
    },
    tls: { rejectUnauthorized: credentials.rejectUnauthorized !== false },
    logger: false,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  const results = [];
  await client.connect();
  try {
    const folders =
      Array.isArray(connector.folders) && connector.folders.length > 0
        ? connector.folders
        : ["INBOX"];
    const lookbackDays = safeInteger(
      connector.public_config?.initial_lookback_days,
      30,
      1,
      3650,
    );
    const since = connector.last_sync_at
      ? new Date(new Date(connector.last_sync_at).getTime() - 3_600_000)
      : new Date(Date.now() - lookbackDays * 86_400_000);

    for (const folder of folders) {
      if (results.length >= limit) break;
      const lock = await client.getMailboxLock(folder);
      try {
        const uids = await client.search({ since }, { uid: true });
        const selected = uids.slice(-(limit - results.length));
        if (selected.length === 0) continue;
        for await (const message of client.fetch(
          selected.join(","),
          {
            uid: true,
            source: true,
            internalDate: true,
            envelope: true,
          },
          { uid: true },
        )) {
          const mail = await simpleParser(message.source, {
            skipImageLinks: true,
          });
          results.push(
            parsedMessage(
              mail,
              `${folder}:${message.uid}`,
              mail.messageId ?? `${folder}:${message.uid}`,
              message.internalDate,
            ),
          );
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return results;
};

const refreshMicrosoftToken = async (credentials) => {
  const tenant = credentials.tenantId ?? credentials.tenant_id ?? "common";
  const body = new URLSearchParams({
    client_id: credentials.clientId ?? credentials.client_id ?? "",
    client_secret: credentials.clientSecret ?? credentials.client_secret ?? "",
    refresh_token: credentials.refreshToken ?? credentials.refresh_token ?? "",
    grant_type: "refresh_token",
    scope:
      credentials.scope ??
      "offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send",
  });
  const result = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    },
  );
  const payload = await result.json();
  if (!result.ok || !payload.access_token) {
    throw new Error(
      `Microsoft OAuth failed: ${payload.error_description ?? payload.error}`,
    );
  }
  return payload.access_token;
};

const fetchOutlook = async (connector, credentials, limit) => {
  const token = await refreshMicrosoftToken(credentials);
  const lookbackDays = safeInteger(
    connector.public_config?.initial_lookback_days,
    30,
    1,
    3650,
  );
  const since = connector.last_sync_at
    ? new Date(new Date(connector.last_sync_at).getTime() - 3_600_000)
    : new Date(Date.now() - lookbackDays * 86_400_000);
  const query = new URLSearchParams({
    $top: String(Math.min(limit, 100)),
    $filter: `receivedDateTime ge ${since.toISOString()}`,
    $orderby: "receivedDateTime asc",
    $select:
      "id,conversationId,subject,body,bodyPreview,from,toRecipients,receivedDateTime,internetMessageHeaders,hasAttachments",
  });
  const result = await fetch(
    `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?${query}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        prefer: 'outlook.body-content-type="html"',
      },
      signal: AbortSignal.timeout(12_000),
    },
  );
  const payload = await result.json();
  if (!result.ok) {
    throw new Error(`Microsoft Graph failed: ${payload.error?.message ?? result.status}`);
  }
  return (payload.value ?? []).map((message) => ({
    externalId: message.id,
    threadId: message.conversationId,
    senderEmail:
      message.from?.emailAddress?.address?.toLowerCase() ??
      "unknown@example.invalid",
    senderName: message.from?.emailAddress?.name ?? null,
    recipients: (message.toRecipients ?? []).map((recipient) => ({
      email: recipient.emailAddress?.address?.toLowerCase(),
      name: recipient.emailAddress?.name || undefined,
    })),
    subject: message.subject ?? "",
    preview: message.bodyPreview ?? "",
    bodyText: null,
    bodyHtml: message.body?.content ?? null,
    receivedAt: message.receivedDateTime,
    headers: Object.fromEntries(
      (message.internetMessageHeaders ?? [])
        .slice(0, 100)
        .map((header) => [header.name, String(header.value).slice(0, 2000)]),
    ),
    attachments: [],
  }));
};

const insertMessage = async (service, connector, message) => {
  const dedupeHash = sha256(
    [
      connector.organization_id,
      connector.id,
      message.externalId,
      message.senderEmail,
      message.receivedAt,
      message.subject,
    ].join("\u001f"),
  );
  const { data, error } = await service
    .from("messages")
    .insert({
      organization_id: connector.organization_id,
      source_connector_id: connector.id,
      external_id: message.externalId,
      thread_id: message.threadId,
      direction: "incoming",
      sender_email: message.senderEmail,
      sender_name: message.senderName,
      recipients: message.recipients,
      subject: String(message.subject).slice(0, 2000),
      preview: String(message.preview).slice(0, 1000),
      body_text: message.bodyText?.slice(0, 2_000_000) ?? null,
      body_html: message.bodyHtml?.slice(0, 4_000_000) ?? null,
      headers: message.headers,
      received_at: new Date(message.receivedAt).toISOString(),
      status: "new",
      dedupe_hash: dedupeHash,
    })
    .select("id")
    .single();
  if (error?.code === "23505") return { duplicate: true };
  if (error) throw error;

  if (message.attachments.length > 0) {
    const { error: attachmentError } = await service
      .from("message_attachments")
      .insert(
        message.attachments.map((attachment) => ({
          ...attachment,
          organization_id: connector.organization_id,
          message_id: data.id,
        })),
      );
    if (attachmentError) throw attachmentError;
  }
  return { duplicate: false, id: data.id };
};

const syncConnector = async (service, connector) => {
  const { data: run, error: runError } = await service
    .from("connector_sync_runs")
    .insert({
      organization_id: connector.organization_id,
      source_connector_id: connector.id,
      cursor_before: connector.sync_cursor,
    })
    .select("id")
    .single();
  if (runError) throw runError;

  try {
    const credentials = await getConnectorSecret(service, connector.id);
    const limit = safeInteger(
      connector.public_config?.max_per_sync,
      25,
      1,
      100,
    );
    const fetched =
      connector.type === "gmail"
        ? await fetchGmail(connector, credentials, limit)
        : connector.type === "outlook"
          ? await fetchOutlook(connector, credentials, limit)
          : await fetchImap(connector, credentials, limit);
    let inserted = 0;
    let duplicates = 0;
    let errors = 0;
    for (const message of fetched) {
      try {
        const result = await insertMessage(service, connector, message);
        if (result.duplicate) duplicates += 1;
        else inserted += 1;
      } catch (error) {
        errors += 1;
        console.error("connector_message_insert_error", connector.id, error);
      }
    }

    const completedAt = new Date();
    const nextSyncAt = new Date(
      completedAt.getTime() + connector.sync_interval_minutes * 60_000,
    );
    await service
      .from("connector_sync_runs")
      .update({
        status: errors > 0 ? "partial" : "complete",
        completed_at: completedAt.toISOString(),
        discovered_count: fetched.length,
        inserted_count: inserted,
        duplicate_count: duplicates,
        error_count: errors,
      })
      .eq("id", run.id);
    await service
      .from("source_connectors")
      .update({
        status: errors > 0 ? "warning" : "active",
        last_sync_at: completedAt.toISOString(),
        next_sync_at: nextSyncAt.toISOString(),
        last_error: errors > 0 ? `${errors} messages could not be inserted` : null,
      })
      .eq("id", connector.id);
    return { connectorId: connector.id, inserted, duplicates, errors };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await service
      .from("connector_sync_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_count: 1,
        error_message: message,
      })
      .eq("id", run.id);
    await service
      .from("source_connectors")
      .update({
        status: "error",
        last_error: message,
        next_sync_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      })
      .eq("id", connector.id);
    return { connectorId: connector.id, error: message };
  }
};

export const handler = async (event) => {
  try {
    authorize(event);
    const service = serviceClient();
    const connectorLimit = safeInteger(
      process.env.CONNECTORS_PER_RUN,
      3,
      1,
      10,
    );
    const { data: connectors, error } = await service
      .from("source_connectors")
      .select("*")
      .in("type", ["gmail", "outlook", "imap"])
      .in("status", ["active", "warning"])
      .or(`next_sync_at.is.null,next_sync_at.lte.${new Date().toISOString()}`)
      .order("next_sync_at", { ascending: true, nullsFirst: true })
      .limit(connectorLimit);
    if (error) throw error;

    const results = [];
    for (const connector of connectors ?? []) {
      results.push(await syncConnector(service, connector));
    }
    return response(200, {
      ok: true,
      connectors: results.length,
      results,
    });
  } catch (error) {
    console.error("connector_worker_error", error);
    return response(error.statusCode ?? 500, {
      ok: false,
      error: error instanceof Error ? error.message : "Unexpected worker error",
    });
  }
};
