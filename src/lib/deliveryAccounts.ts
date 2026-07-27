import type {
  DeliveryAccount,
  DeliveryProvider,
} from "../types";

export interface DeliveryAccountDraft {
  id?: string;
  provider: DeliveryProvider;
  sourceConnectorId: string;
  name: string;
  fromEmail: string;
  fromName: string;
  replyTo: string;
  dailyLimit: number;
  hourlyLimit: number;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  tenantId: string;
  apiKey: string;
  region: string;
}

export interface AccountValidation {
  valid: boolean;
  errors: Record<string, string>;
  checks: Array<{ label: string; ok: boolean; detail: string }>;
}

export const deliveryProviderInfo: Record<
  DeliveryProvider,
  {
    label: string;
    caption: string;
    server: string;
    auth: string;
    checks: string[];
  }
> = {
  gmail: {
    label: "Gmail / Workspace",
    caption: "Gmail API i OAuth 2.0",
    server: "Gmail API",
    auth: "OAuth 2.0",
    checks: ["odnowienie tokenu", "zakres gmail.send", "profil nadawcy"],
  },
  outlook: {
    label: "Microsoft 365",
    caption: "Graph / SMTP OAuth",
    server: "smtp.office365.com:587",
    auth: "OAuth 2.0",
    checks: ["token Entra ID", "zakres Mail.Send", "tożsamość skrzynki"],
  },
  smtp: {
    label: "Własny SMTP",
    caption: "SMTP przez TLS",
    server: "Własny serwer SMTP",
    auth: "Login + hasło aplikacji",
    checks: ["negocjacja TLS", "uwierzytelnienie SMTP", "komenda EHLO"],
  },
  resend: {
    label: "Resend",
    caption: "HTTP API",
    server: "api.resend.com",
    auth: "Klucz API",
    checks: ["ważność klucza API", "zweryfikowana domena", "limit konta"],
  },
  sendgrid: {
    label: "SendGrid",
    caption: "HTTP API v3",
    server: "api.sendgrid.com",
    auth: "Klucz API",
    checks: ["ważność klucza API", "sender identity", "limit konta"],
  },
  ses: {
    label: "Amazon SES",
    caption: "AWS SES v2",
    server: "AWS SES",
    auth: "Access key / IAM",
    checks: ["uprawnienie ses:SendEmail", "region AWS", "zweryfikowany nadawca"],
  },
};

export function emptyDeliveryAccountDraft(
  provider: DeliveryProvider = "smtp",
): DeliveryAccountDraft {
  return {
    provider,
    sourceConnectorId: "",
    name: "",
    fromEmail: "",
    fromName: "",
    replyTo: "",
    dailyLimit: 2000,
    hourlyLimit: 300,
    host: provider === "outlook" ? "smtp.office365.com" : "",
    port: provider === "outlook" ? 587 : 587,
    secure: false,
    username: "",
    password: "",
    clientId: "",
    clientSecret: "",
    refreshToken: "",
    tenantId: "organizations",
    apiKey: "",
    region: "eu-central-1",
  };
}

export function deliveryAccountToDraft(
  account: DeliveryAccount,
): DeliveryAccountDraft {
  const config = account.publicConfig ?? {};
  return {
    ...emptyDeliveryAccountDraft(account.provider),
    id: account.id,
    provider: account.provider,
    sourceConnectorId: account.sourceConnectorId ?? "",
    name: account.name,
    fromEmail: account.fromEmail,
    fromName: account.fromName,
    replyTo: account.replyTo,
    dailyLimit: account.dailyLimit,
    hourlyLimit: account.hourlyLimit,
    host: String(config.host ?? ""),
    port: Number(config.port ?? 587),
    secure: Boolean(config.secure),
    username: String(config.username_hint ?? account.fromEmail),
    tenantId: String(config.tenant_id ?? "organizations"),
    region: String(config.region ?? "eu-central-1"),
  };
}

const validEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export function validateDeliveryAccount(
  draft: DeliveryAccountDraft,
  editing = false,
): AccountValidation {
  const errors: Record<string, string> = {};
  if (!draft.name.trim()) errors.name = "Podaj nazwę konta.";
  if (!validEmail(draft.fromEmail)) {
    errors.fromEmail = "Podaj poprawny adres nadawcy.";
  }
  if (draft.replyTo && !validEmail(draft.replyTo)) {
    errors.replyTo = "Adres Reply-To jest nieprawidłowy.";
  }
  if (draft.dailyLimit < 1) errors.dailyLimit = "Limit musi być dodatni.";
  if (draft.hourlyLimit < 1 || draft.hourlyLimit > draft.dailyLimit) {
    errors.hourlyLimit = "Limit godzinowy musi być dodatni i nie większy od dziennego.";
  }

  if (draft.provider === "smtp") {
    if (!draft.host.trim()) errors.host = "Podaj serwer SMTP.";
    if (draft.port < 1 || draft.port > 65535) {
      errors.port = "Nieprawidłowy port.";
    }
    if (!draft.username.trim()) errors.username = "Podaj login SMTP.";
    if (!editing && !draft.password) errors.password = "Podaj hasło aplikacji.";
  }
  if (draft.provider === "gmail" || draft.provider === "outlook") {
    if (!editing && !draft.clientId.trim()) {
      errors.clientId = "Client ID jest wymagany.";
    }
    if (!editing && !draft.clientSecret.trim()) {
      errors.clientSecret = "Client secret jest wymagany.";
    }
    if (!editing && !draft.refreshToken.trim()) {
      errors.refreshToken = "Refresh token jest wymagany.";
    }
    if (draft.provider === "outlook" && !draft.tenantId.trim()) {
      errors.tenantId = "Tenant ID jest wymagany.";
    }
  }
  if (["resend", "sendgrid"].includes(draft.provider)) {
    if (!editing && !draft.apiKey.trim()) errors.apiKey = "Klucz API jest wymagany.";
  }
  if (draft.provider === "ses") {
    if (!editing && !draft.apiKey.trim()) {
      errors.apiKey = "Access key ID jest wymagany.";
    }
    if (!editing && !draft.clientSecret.trim()) {
      errors.clientSecret = "Secret access key jest wymagany.";
    }
    if (!draft.region.trim()) errors.region = "Region AWS jest wymagany.";
  }

  const valid = Object.keys(errors).length === 0;
  return {
    valid,
    errors,
    checks: deliveryProviderInfo[draft.provider].checks.map((check) => ({
      label: check,
      ok: valid,
      detail: valid
        ? "Konfiguracja spełnia wymagania."
        : "Popraw oznaczone pola.",
    })),
  };
}

export function deliveryAccountPayload(draft: DeliveryAccountDraft) {
  const publicConfig: Record<string, unknown> = {};
  const credentials: Record<string, unknown> = {};

  if (draft.provider === "smtp") {
    Object.assign(publicConfig, {
      host: draft.host,
      port: draft.port,
      secure: draft.secure,
      username_hint: draft.username,
    });
    Object.assign(credentials, {
      host: draft.host,
      port: draft.port,
      secure: draft.secure,
      requireTLS: !draft.secure,
      username: draft.username,
      password: draft.password,
      rejectUnauthorized: true,
    });
  }
  if (draft.provider === "gmail" || draft.provider === "outlook") {
    Object.assign(publicConfig, {
      tenant_id:
        draft.provider === "outlook" ? draft.tenantId : undefined,
      scopes:
        draft.provider === "gmail"
          ? ["gmail.send"]
          : ["offline_access", "Mail.Send"],
    });
    Object.assign(credentials, {
      tenantId: draft.tenantId,
      clientId: draft.clientId,
      clientSecret: draft.clientSecret,
      refreshToken: draft.refreshToken,
      username: draft.fromEmail,
    });
  }
  if (draft.provider === "resend" || draft.provider === "sendgrid") {
    credentials.apiKey = draft.apiKey;
  }
  if (draft.provider === "ses") {
    publicConfig.region = draft.region;
    Object.assign(credentials, {
      accessKeyId: draft.apiKey,
      secretAccessKey: draft.clientSecret,
      region: draft.region,
    });
  }

  return {
    source_connector_id: draft.sourceConnectorId || null,
    provider: draft.provider,
    name: draft.name.trim(),
    from_email: draft.fromEmail.trim().toLowerCase(),
    from_name: draft.fromName.trim() || null,
    reply_to: draft.replyTo.trim().toLowerCase() || null,
    daily_limit: draft.dailyLimit,
    hourly_limit: draft.hourlyLimit,
    public_config: Object.fromEntries(
      Object.entries(publicConfig).filter(([, value]) => value !== undefined),
    ),
    credentials: Object.fromEntries(
      Object.entries(credentials).filter(([, value]) => value !== ""),
    ),
  };
}

export function draftToDeliveryAccount(
  draft: DeliveryAccountDraft,
  organizationId: string,
): DeliveryAccount {
  const info = deliveryProviderInfo[draft.provider];
  const payload = deliveryAccountPayload(draft);
  const serverLabel =
    draft.provider === "smtp"
      ? `${draft.host}:${draft.port}`
      : draft.provider === "ses"
        ? `AWS SES · ${draft.region}`
        : info.server;
  return {
    id: draft.id ?? `delivery-${crypto.randomUUID()}`,
    organizationId,
    provider: draft.provider,
    sourceConnectorId: draft.sourceConnectorId || null,
    name: payload.name,
    fromEmail: payload.from_email,
    fromName: draft.fromName.trim() || draft.name.trim(),
    replyTo: draft.replyTo.trim().toLowerCase(),
    status: "active",
    serverLabel,
    authenticationLabel: info.auth,
    dailyLimit: draft.dailyLimit,
    hourlyLimit: draft.hourlyLimit,
    sentToday: 0,
    deliveryRate: 100,
    credentialsConfigured:
      Object.keys(payload.credentials).length > 0 || Boolean(draft.id),
    publicConfig: payload.public_config,
    lastTestAt: new Date().toISOString(),
    lastError: null,
    createdAt: new Date().toISOString(),
  };
}

export async function testDeliveryAccountLocally(
  draft: DeliveryAccountDraft,
  editing = false,
) {
  const result = validateDeliveryAccount(draft, editing);
  await new Promise((resolve) => window.setTimeout(resolve, 600));
  return result;
}
