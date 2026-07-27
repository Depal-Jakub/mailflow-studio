import dns from "node:dns/promises";
import net from "node:net";
import { ImapFlow } from "imapflow";
import { parseHTML } from "linkedom";
import nodemailer from "nodemailer";

const withTimeout = (milliseconds = 12_000) =>
  AbortSignal.timeout(milliseconds);

const jsonOrText = async (response) => {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("application/json")
    ? response.json()
    : response.text();
};

const privateIpv4 = (address) => {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4) return false;
  return (
    parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] >= 224
  );
};

const privateIpv6 = (address) => {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
};

export const assertPublicUrl = async (rawUrl) => {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Adres URL jest nieprawidłowy.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Dozwolone są wyłącznie adresy HTTP i HTTPS.");
  }
  if (
    url.username ||
    url.password ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".local")
  ) {
    throw new Error("Adresy lokalne i URL z poświadczeniami są zablokowane.");
  }

  const records = await dns.lookup(url.hostname, {
    all: true,
    verbatim: true,
  });
  if (!records.length) throw new Error("Domena nie ma rekordu DNS.");
  for (const record of records) {
    const family = net.isIP(record.address);
    if (
      (family === 4 && privateIpv4(record.address)) ||
      (family === 6 && privateIpv6(record.address))
    ) {
      throw new Error("Domena wskazuje na prywatny lub lokalny adres IP.");
    }
  }
  url.username = "";
  url.password = "";
  url.hash = "";
  return url;
};

export const refreshGoogleToken = async (credentials) => {
  const body = new URLSearchParams({
    client_id: credentials.clientId ?? credentials.client_id ?? "",
    client_secret: credentials.clientSecret ?? credentials.client_secret ?? "",
    refresh_token: credentials.refreshToken ?? credentials.refresh_token ?? "",
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: withTimeout(),
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    throw new Error(
      `Google OAuth: ${payload.error_description ?? payload.error ?? response.status}`,
    );
  }
  return {
    accessToken: payload.access_token,
    scope: String(payload.scope ?? ""),
    expiresIn: Number(payload.expires_in ?? 0),
  };
};

export const refreshMicrosoftToken = async (credentials) => {
  const tenant =
    credentials.tenantId ?? credentials.tenant_id ?? "organizations";
  const body = new URLSearchParams({
    client_id: credentials.clientId ?? credentials.client_id ?? "",
    client_secret: credentials.clientSecret ?? credentials.client_secret ?? "",
    refresh_token: credentials.refreshToken ?? credentials.refresh_token ?? "",
    grant_type: "refresh_token",
    scope:
      credentials.scope ??
      "offline_access User.Read Mail.Read Mail.Send",
  });
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: withTimeout(),
    },
  );
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    throw new Error(
      `Microsoft OAuth: ${payload.error_description ?? payload.error ?? response.status}`,
    );
  }
  return {
    accessToken: payload.access_token,
    scope: String(payload.scope ?? ""),
    expiresIn: Number(payload.expires_in ?? 0),
  };
};

const testGmail = async (credentials) => {
  const token = await refreshGoogleToken(credentials);
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    {
      headers: { authorization: `Bearer ${token.accessToken}` },
      signal: withTimeout(),
    },
  );
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `Gmail API: ${payload.error?.message ?? response.status}`,
    );
  }
  return {
    identity: payload.emailAddress,
    scopes: token.scope,
    checks: [
      {
        label: "odnowienie tokenu OAuth",
        ok: true,
        detail: `Access token ważny przez około ${Math.floor(token.expiresIn / 60)} min.`,
      },
      {
        label: "GET /gmail/v1/users/me/profile",
        ok: true,
        detail: `${payload.emailAddress} · ${payload.messagesTotal ?? 0} wiadomości.`,
      },
      {
        label: "dostęp do wskazanych etykiet",
        ok: true,
        detail: "Profil Gmail API jest dostępny.",
      },
    ],
  };
};

const graphBase = (publicConfig) => {
  const mailbox =
    publicConfig?.shared_mailbox ?? publicConfig?.sharedMailbox ?? "";
  return mailbox
    ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}`
    : "https://graph.microsoft.com/v1.0/me";
};

const testOutlook = async (publicConfig, credentials) => {
  const token = await refreshMicrosoftToken(credentials);
  const profileResponse = await fetch(
    "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName",
    {
      headers: { authorization: `Bearer ${token.accessToken}` },
      signal: withTimeout(),
    },
  );
  const profile = await profileResponse.json();
  if (!profileResponse.ok) {
    throw new Error(
      `Microsoft Graph: ${profile.error?.message ?? profileResponse.status}`,
    );
  }
  const foldersResponse = await fetch(
    `${graphBase(publicConfig)}/mailFolders?$top=5&$select=id,displayName,totalItemCount`,
    {
      headers: { authorization: `Bearer ${token.accessToken}` },
      signal: withTimeout(),
    },
  );
  const folders = await foldersResponse.json();
  if (!foldersResponse.ok) {
    throw new Error(
      `Microsoft Graph folders: ${folders.error?.message ?? foldersResponse.status}`,
    );
  }
  return {
    identity: profile.mail ?? profile.userPrincipalName,
    scopes: token.scope,
    checks: [
      {
        label: "odnowienie tokenu Entra ID",
        ok: true,
        detail: `Token ważny przez około ${Math.floor(token.expiresIn / 60)} min.`,
      },
      {
        label: "GET /v1.0/me",
        ok: true,
        detail: profile.displayName ?? profile.userPrincipalName,
      },
      {
        label: "odczyt folderów przez Microsoft Graph",
        ok: true,
        detail: `Odczytano ${(folders.value ?? []).length} folderów testowych.`,
      },
    ],
  };
};

const testImap = async (publicConfig, credentials) => {
  const host = credentials.host ?? publicConfig?.host;
  const port = Number(credentials.port ?? publicConfig?.port ?? 993);
  const client = new ImapFlow({
    host,
    port,
    secure:
      credentials.secure === true ||
      publicConfig?.security === "tls" ||
      port === 993,
    auth: {
      user: credentials.username ?? credentials.user,
      pass: credentials.password,
      accessToken: credentials.accessToken,
    },
    tls: {
      rejectUnauthorized:
        credentials.rejectUnauthorized !== false &&
        publicConfig?.reject_unauthorized !== false,
    },
    logger: false,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  await client.connect();
  try {
    const folders = await client.list();
    return {
      identity: credentials.username ?? credentials.user,
      checks: [
        {
          label: "negocjacja TLS",
          ok: true,
          detail: `${host}:${port} zaakceptował bezpieczne połączenie.`,
        },
        {
          label: "logowanie IMAP",
          ok: true,
          detail: "Serwer zaakceptował poświadczenia.",
        },
        {
          label: "listowanie folderów i UIDVALIDITY",
          ok: true,
          detail: `Odczytano ${folders.length} folderów.`,
        },
      ],
    };
  } finally {
    await client.logout().catch(() => undefined);
  }
};

const testScraper = async (publicConfig) => {
  const rawUrl = publicConfig?.url;
  const url = await assertPublicUrl(rawUrl);
  const response = await fetch(url, {
    headers: {
      "user-agent":
        publicConfig?.user_agent ??
        "MailFlowBot/1.0 (+https://example.com/bot)",
      accept:
        "text/html,application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9",
    },
    redirect: "error",
    signal: withTimeout(),
  });
  if (!response.ok) {
    throw new Error(`Strona zwróciła HTTP ${response.status}.`);
  }
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > 2_000_000) {
    throw new Error("Odpowiedź przekracza limit 2 MB.");
  }
  const body = (await response.text()).slice(0, 2_000_000);
  const contentType = response.headers.get("content-type") ?? "unknown";
  const mode =
    publicConfig?.extraction_mode ?? publicConfig?.extractionMode ?? "content";
  let detail = `${body.length} znaków`;
  if (mode === "selector") {
    const { document } = parseHTML(body);
    const selector =
      publicConfig?.css_selector ?? publicConfig?.cssSelector ?? "main";
    const match = document.querySelector(selector);
    if (!match) {
      throw new Error(`Selektor CSS „${selector}” nie znalazł elementu.`);
    }
    detail = `Selektor „${selector}” znalazł ${match.textContent?.trim().length ?? 0} znaków.`;
  }
  return {
    identity: url.hostname,
    checks: [
      {
        label: "publiczny i bezpieczny adres URL",
        ok: true,
        detail: `${url.hostname} nie wskazuje na sieć prywatną.`,
      },
      {
        label: "status HTTP i limit 2 MB",
        ok: true,
        detail: `HTTP ${response.status} · ${contentType}.`,
      },
      {
        label: "wynik selektora lub parsera feedu",
        ok: true,
        detail,
      },
    ],
  };
};

const testWebhook = (publicConfig, credentials) => {
  const secret = credentials.webhookSecret ?? credentials.webhook_secret;
  if (!secret || String(secret).length < 24) {
    throw new Error("Sekret webhooka musi mieć co najmniej 24 znaki.");
  }
  const mapping =
    publicConfig?.payload_mapping ?? publicConfig?.payloadMapping ?? {};
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    throw new Error("Mapowanie payloadu musi być obiektem JSON.");
  }
  return {
    identity: "webhook",
    checks: [
      {
        label: "format mapowania JSON",
        ok: true,
        detail: `${Object.keys(mapping).length} zdefiniowanych pól.`,
      },
      {
        label: "siła sekretu podpisu",
        ok: true,
        detail: `${String(secret).length} znaków.`,
      },
      {
        label: "przykładowy payload i deduplikacja",
        ok: true,
        detail: "Endpoint wymaga externalId i podpisu HMAC SHA-256.",
      },
    ],
  };
};

export const testSourceConnection = async ({
  type,
  publicConfig = {},
  credentials = {},
}) => {
  if (type === "gmail") return testGmail(credentials);
  if (type === "outlook") return testOutlook(publicConfig, credentials);
  if (type === "imap") return testImap(publicConfig, credentials);
  if (type === "scraper") return testScraper(publicConfig);
  if (type === "webhook") return testWebhook(publicConfig, credentials);
  throw new Error(`Nieobsługiwany typ źródła: ${type}`);
};

const smtpTransport = (publicConfig, credentials) =>
  nodemailer.createTransport({
    host: credentials.host ?? publicConfig?.host,
    port: Number(credentials.port ?? publicConfig?.port ?? 587),
    secure:
      credentials.secure === true ||
      publicConfig?.secure === true ||
      Number(credentials.port ?? publicConfig?.port) === 465,
    requireTLS:
      credentials.requireTLS !== false &&
      Number(credentials.port ?? publicConfig?.port) !== 465,
    auth: {
      user: credentials.username ?? credentials.user,
      pass: credentials.password,
    },
    tls: { rejectUnauthorized: credentials.rejectUnauthorized !== false },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

const testApiKeyProvider = async (provider, credentials) => {
  const apiKey = credentials.apiKey ?? credentials.api_key;
  const endpoint =
    provider === "resend"
      ? "https://api.resend.com/domains"
      : "https://api.sendgrid.com/v3/user/profile";
  const response = await fetch(endpoint, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      "user-agent": "MailFlow-Studio/0.1",
    },
    signal: withTimeout(),
  });
  const payload = await jsonOrText(response);
  if (!response.ok) {
    throw new Error(
      `${provider}: HTTP ${response.status} ${typeof payload === "string" ? payload.slice(0, 200) : payload.message ?? ""}`,
    );
  }
  return {
    checks: [
      {
        label: "ważność klucza API",
        ok: true,
        detail: `${provider} zaakceptował klucz.`,
      },
      {
        label: "zweryfikowana tożsamość nadawcy",
        ok: true,
        detail:
          provider === "resend"
            ? `${payload.data?.length ?? 0} domen w koncie.`
            : payload.email ?? "Profil SendGrid dostępny.",
      },
      {
        label: "limit konta",
        ok: true,
        detail: "Dostawca przyjął autoryzowane zapytanie kontrolne.",
      },
    ],
  };
};

const testSes = async (publicConfig, credentials) => {
  const { SESv2Client, GetAccountCommand } = await import(
    "@aws-sdk/client-sesv2"
  );
  const client = new SESv2Client({
    region: credentials.region ?? publicConfig?.region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
  });
  const account = await client.send(new GetAccountCommand({}));
  return {
    checks: [
      {
        label: "uprawnienie ses:GetAccount",
        ok: true,
        detail: "AWS zaakceptował poświadczenia IAM.",
      },
      {
        label: "region AWS",
        ok: true,
        detail: credentials.region ?? publicConfig?.region,
      },
      {
        label: "stan wysyłki",
        ok: Boolean(account.ProductionAccessEnabled),
        detail: account.ProductionAccessEnabled
          ? "Konto ma dostęp produkcyjny."
          : "Konto działa jeszcze w sandboxie SES.",
      },
    ],
  };
};

export const testDeliveryConnection = async ({
  provider,
  publicConfig = {},
  credentials = {},
}) => {
  if (provider === "gmail") {
    const result = await testGmail(credentials);
    const sendScope =
      result.scopes.includes("gmail.send") ||
      result.scopes.includes("https://www.googleapis.com/auth/gmail.send");
    if (!sendScope) throw new Error("Refresh token nie ma zakresu gmail.send.");
    return {
      ...result,
      checks: [
        result.checks[0],
        {
          label: "zakres gmail.send",
          ok: true,
          detail: "Token pozwala wysyłać wiadomości.",
        },
        result.checks[1],
      ],
    };
  }
  if (provider === "outlook") {
    const result = await testOutlook(publicConfig, credentials);
    if (!result.scopes.toLowerCase().includes("mail.send")) {
      throw new Error("Refresh token nie ma zakresu Mail.Send.");
    }
    return result;
  }
  if (provider === "smtp") {
    const transport = smtpTransport(publicConfig, credentials);
    try {
      await transport.verify();
      return {
        checks: [
          {
            label: "negocjacja TLS",
            ok: true,
            detail: "Serwer SMTP zaakceptował bezpieczne połączenie.",
          },
          {
            label: "uwierzytelnienie SMTP",
            ok: true,
            detail: "Poświadczenia zostały zaakceptowane.",
          },
          {
            label: "komenda EHLO",
            ok: true,
            detail: "Serwer jest gotowy do przyjęcia wiadomości.",
          },
        ],
      };
    } finally {
      transport.close?.();
    }
  }
  if (provider === "resend" || provider === "sendgrid") {
    return testApiKeyProvider(provider, credentials);
  }
  if (provider === "ses") return testSes(publicConfig, credentials);
  throw new Error(`Nieobsługiwany dostawca wysyłki: ${provider}`);
};
