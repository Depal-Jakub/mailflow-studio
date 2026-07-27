import nodemailer from "nodemailer";
import {
  getDeliverySecret,
  requireInternalSecret,
  response,
  safeInteger,
  serviceClient,
} from "./_shared/server.mjs";

const authorize = (event) => {
  if (event.next_run) return;
  requireInternalSecret(event);
};

const htmlEscape = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const interpolate = (template, variables, escapeValues = false) =>
  String(template ?? "").replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key) => {
    const value = key.split(".").reduce((current, part) => current?.[part], variables);
    return escapeValues ? htmlEscape(value) : String(value ?? "");
  });

const smtpTransport = (account, credentials) => {
  if (account.provider === "gmail") {
    return nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user: credentials.username ?? account.from_email,
        clientId: credentials.clientId ?? credentials.client_id,
        clientSecret: credentials.clientSecret ?? credentials.client_secret,
        refreshToken: credentials.refreshToken ?? credentials.refresh_token,
      },
    });
  }
  if (account.provider === "outlook") {
    return nodemailer.createTransport({
      host: "smtp.office365.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: {
        type: "OAuth2",
        user: credentials.username ?? account.from_email,
        clientId: credentials.clientId ?? credentials.client_id,
        clientSecret: credentials.clientSecret ?? credentials.client_secret,
        refreshToken: credentials.refreshToken ?? credentials.refresh_token,
        accessUrl:
          credentials.accessUrl ??
          `https://login.microsoftonline.com/${credentials.tenantId ?? "common"}/oauth2/v2.0/token`,
      },
    });
  }
  return nodemailer.createTransport({
    host: credentials.host ?? account.public_config?.host,
    port: Number(credentials.port ?? account.public_config?.port ?? 587),
    secure:
      credentials.secure === true ||
      Number(credentials.port ?? account.public_config?.port) === 465,
    requireTLS: credentials.requireTLS !== false,
    auth: {
      user: credentials.username ?? credentials.user,
      pass: credentials.password,
    },
    tls: { rejectUnauthorized: credentials.rejectUnauthorized !== false },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
};

const sendWithHttpProvider = async (
  account,
  credentials,
  recipient,
  content,
) => {
  if (account.provider === "resend") {
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${credentials.apiKey ?? credentials.api_key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: `${account.from_name ?? account.name} <${account.from_email}>`,
        to: [recipient.email],
        reply_to: account.reply_to || undefined,
        subject: content.subject,
        text: content.text,
        html: content.html,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await result.json();
    if (!result.ok) throw new Error(payload.message ?? `Resend HTTP ${result.status}`);
    return { messageId: payload.id };
  }

  if (account.provider === "sendgrid") {
    const result = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        authorization: `Bearer ${credentials.apiKey ?? credentials.api_key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: recipient.email, name: recipient.name }] }],
        from: { email: account.from_email, name: account.from_name ?? account.name },
        reply_to: account.reply_to ? { email: account.reply_to } : undefined,
        subject: content.subject,
        content: [
          ...(content.text ? [{ type: "text/plain", value: content.text }] : []),
          ...(content.html ? [{ type: "text/html", value: content.html }] : []),
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!result.ok) {
      const payload = await result.text();
      throw new Error(`SendGrid HTTP ${result.status}: ${payload.slice(0, 500)}`);
    }
    return { messageId: result.headers.get("x-message-id") };
  }

  throw new Error(`HTTP provider ${account.provider} is not implemented`);
};

const loadRelations = async (service, recipients) => {
  const outboundIds = [...new Set(recipients.map((item) => item.outbound_message_id))];
  const { data: outbounds, error: outboundError } = await service
    .from("outbound_messages")
    .select("*")
    .in("id", outboundIds);
  if (outboundError) throw outboundError;

  const accountIds = [
    ...new Set(
      (outbounds ?? [])
        .map((item) => item.delivery_account_id)
        .filter(Boolean),
    ),
  ];
  const { data: accounts, error: accountError } = accountIds.length
    ? await service.from("delivery_accounts").select("*").in("id", accountIds)
    : { data: [], error: null };
  if (accountError) throw accountError;

  return {
    outboundById: new Map((outbounds ?? []).map((item) => [item.id, item])),
    accountById: new Map((accounts ?? []).map((item) => [item.id, item])),
  };
};

const sendRecipient = async (
  service,
  recipient,
  outbound,
  account,
  secretCache,
  transportCache,
) => {
  if (!outbound) throw new Error("Outbound message is unavailable");
  if (!account || account.status !== "active") {
    throw new Error("Delivery account is missing or inactive");
  }
  const sentToday =
    new Date(account.last_reset_at).toDateString() === new Date().toDateString()
      ? account.sent_today
      : 0;
  if (sentToday >= account.daily_limit) {
    throw new Error("Daily delivery limit has been reached");
  }

  let credentials = secretCache.get(account.id);
  if (!credentials) {
    credentials = await getDeliverySecret(service, account.id);
    secretCache.set(account.id, credentials);
  }
  const variables = {
    ...(recipient.variables ?? {}),
    recipient: {
      email: recipient.email,
      name: recipient.name ?? "",
    },
    email: recipient.email,
    name: recipient.name ?? "",
  };
  const content = {
    subject: interpolate(outbound.subject, variables),
    text: interpolate(outbound.text_body, variables),
    html: interpolate(outbound.html_body, variables, true),
  };

  if (["resend", "sendgrid"].includes(account.provider)) {
    return sendWithHttpProvider(account, credentials, recipient, content);
  }
  if (account.provider === "ses") {
    throw new Error("AWS SES requires a dedicated adapter configuration");
  }

  let transport = transportCache.get(account.id);
  if (!transport) {
    transport = smtpTransport(account, credentials);
    await transport.verify();
    transportCache.set(account.id, transport);
  }
  const result = await transport.sendMail({
    from: {
      name: account.from_name ?? account.name,
      address: account.from_email,
    },
    replyTo: account.reply_to || undefined,
    to: { name: recipient.name || "", address: recipient.email },
    subject: content.subject,
    text: content.text || undefined,
    html: content.html || undefined,
    headers: {
      "X-MailFlow-Outbound-ID": outbound.id,
      "X-MailFlow-Recipient-ID": recipient.id,
    },
  });
  return { messageId: result.messageId, response: result.response };
};

export const handler = async (event) => {
  try {
    authorize(event);
    const service = serviceClient();
    const batchSize = safeInteger(
      process.env.OUTBOUND_BATCH_SIZE,
      20,
      1,
      100,
    );
    const { data: recipients, error: claimError } = await service.rpc(
      "claim_outbound_recipients",
      {
        worker_name: `outbound-worker-${crypto.randomUUID()}`,
        batch_size: batchSize,
      },
    );
    if (claimError) throw claimError;
    if (!recipients?.length) {
      return response(200, { ok: true, claimed: 0, sent: 0, failed: 0 });
    }

    const { outboundById, accountById } = await loadRelations(service, recipients);
    const secretCache = new Map();
    const transportCache = new Map();
    const affectedOutboundIds = new Set();
    const results = [];

    for (const recipient of recipients) {
      const outbound = outboundById.get(recipient.outbound_message_id);
      const account = outbound
        ? accountById.get(outbound.delivery_account_id)
        : null;
      affectedOutboundIds.add(recipient.outbound_message_id);
      try {
        const result = await sendRecipient(
          service,
          recipient,
          outbound,
          account,
          secretCache,
          transportCache,
        );
        await service
          .from("outbound_recipients")
          .update({
            status: "sent",
            provider_message_id: result.messageId ?? null,
            sent_at: new Date().toISOString(),
            error_message: null,
          })
          .eq("id", recipient.id);
        if (account) {
          await service.rpc("increment_delivery_sent", {
            target_delivery_account_id: account.id,
            increment_by: 1,
          });
          account.sent_today += 1;
        }
        results.push({ id: recipient.id, status: "sent" });
      } catch (error) {
        const retry = recipient.attempt_count < 3;
        await service
          .from("outbound_recipients")
          .update({
            status: retry ? "pending" : "failed",
            failed_at: retry ? null : new Date().toISOString(),
            error_message:
              error instanceof Error ? error.message : "Unexpected send error",
          })
          .eq("id", recipient.id);
        results.push({
          id: recipient.id,
          status: retry ? "retry" : "failed",
          error: error instanceof Error ? error.message : "Unexpected send error",
        });
      }
    }

    for (const outboundId of affectedOutboundIds) {
      await service.rpc("recompute_outbound_counts", {
        target_outbound_message_id: outboundId,
      });
    }
    for (const transport of transportCache.values()) {
      transport.close?.();
    }

    return response(200, {
      ok: true,
      claimed: recipients.length,
      sent: results.filter((item) => item.status === "sent").length,
      failed: results.filter((item) => item.status === "failed").length,
      retrying: results.filter((item) => item.status === "retry").length,
      results,
    });
  } catch (error) {
    console.error("outbound_worker_error", error);
    return response(error.statusCode ?? 500, {
      ok: false,
      error: error instanceof Error ? error.message : "Unexpected worker error",
    });
  }
};
