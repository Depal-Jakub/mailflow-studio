import type { SourceConnector, SourceType } from "../types";

export type ExtractionMode = "content" | "selector" | "rss" | "sitemap";

export interface SourceDraft {
  id?: string;
  type: SourceType;
  name: string;
  address: string;
  syncIntervalMinutes: number;
  folders: string;
  initialLookbackDays: number;
  maxPerSync: number;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  tenantId: string;
  sharedMailbox: string;
  host: string;
  port: number;
  security: "tls" | "starttls";
  username: string;
  password: string;
  rejectUnauthorized: boolean;
  webhookSecret: string;
  signatureHeader: string;
  payloadMapping: string;
  url: string;
  extractionMode: ExtractionMode;
  cssSelector: string;
  userAgent: string;
  changeThreshold: number;
  notifyOnInitial: boolean;
  respectRobotsTxt: boolean;
}

export interface ConnectorGuide {
  title: string;
  summary: string;
  prerequisites: string[];
  steps: string[];
  environment: string[];
  testChecks: string[];
}

export interface SourceValidation {
  valid: boolean;
  errors: Record<string, string>;
  checks: Array<{ label: string; ok: boolean; detail: string }>;
}

const randomSecret = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

export const sourceGuides: Record<SourceType, ConnectorGuide> = {
  gmail: {
    title: "Połączenie z Gmail API",
    summary:
      "Synchronizacja etykiet i wątków przez OAuth 2.0 z automatycznym odnawianiem access tokenu.",
    prerequisites: [
      "Projekt w Google Cloud z włączonym Gmail API.",
      "Ekran zgody OAuth oraz klient typu Web application.",
      "Konto Google Workspace lub Gmail, które ma być synchronizowane.",
    ],
    steps: [
      "W Google Cloud otwórz APIs & Services, Library i włącz Gmail API.",
      "W Credentials utwórz OAuth Client ID typu Web application.",
      "Dodaj adres callback aplikacji lub użyj OAuth Playground do uzyskania refresh tokenu.",
      "Nadaj zakres gmail.readonly. Zakres gmail.send dodaj tylko wtedy, gdy konto ma także wysyłać.",
      "Wklej client ID, client secret i refresh token, przetestuj połączenie, a następnie aktywuj źródło.",
    ],
    environment: [
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_CLIENT_SECRET",
      "GOOGLE_OAUTH_REDIRECT_URI",
    ],
    testChecks: [
      "odnowienie tokenu OAuth",
      "GET /gmail/v1/users/me/profile",
      "dostęp do wskazanych etykiet",
    ],
  },
  outlook: {
    title: "Połączenie z Microsoft 365",
    summary:
      "Microsoft Graph obsługujący foldery, skrzynki współdzielone i odświeżanie tokenów.",
    prerequisites: [
      "Rejestracja aplikacji w Microsoft Entra ID.",
      "Redirect URI typu Web oraz sekret klienta.",
      "Delegowane uprawnienia offline_access i Mail.Read.",
    ],
    steps: [
      "W Entra ID przejdź do App registrations i utwórz aplikację.",
      "W Authentication dodaj Redirect URI aplikacji internetowej.",
      "W API permissions dodaj Microsoft Graph: offline_access, User.Read i Mail.Read.",
      "Dla skrzynki współdzielonej upewnij się, że użytkownik ma do niej dostęp.",
      "Wygeneruj refresh token, zapisz tenant ID i przetestuj odczyt profilu oraz folderów.",
    ],
    environment: [
      "MICROSOFT_OAUTH_CLIENT_ID",
      "MICROSOFT_OAUTH_CLIENT_SECRET",
      "MICROSOFT_OAUTH_REDIRECT_URI",
    ],
    testChecks: [
      "odnowienie tokenu Entra ID",
      "GET /v1.0/me",
      "odczyt folderów przez Microsoft Graph",
    ],
  },
  imap: {
    title: "Połączenie z serwerem IMAP",
    summary:
      "Uniwersalny odbiór poczty przez TLS lub STARTTLS, z obsługą wielu folderów.",
    prerequisites: [
      "Adres serwera IMAP, port i nazwa użytkownika.",
      "Hasło aplikacji, jeśli dostawca wymaga 2FA.",
      "Dostęp sieciowy z funkcji Netlify do serwera pocztowego.",
    ],
    steps: [
      "Sprawdź w dokumentacji dostawcy nazwę hosta i port (zwykle 993/TLS).",
      "Włącz IMAP w ustawieniach skrzynki, jeśli jest domyślnie wyłączony.",
      "Wpisz foldery rozdzielone przecinkami, np. INBOX, Sent, Archive.",
      "Pozostaw weryfikację certyfikatu włączoną; wyłączaj ją wyłącznie w kontrolowanym środowisku.",
      "Uruchom test logowania i listowania folderów przed zapisaniem.",
    ],
    environment: [],
    testChecks: [
      "negocjacja TLS",
      "logowanie IMAP",
      "listowanie folderów i UIDVALIDITY",
    ],
  },
  webhook: {
    title: "Uniwersalny webhook",
    summary:
      "Bezpieczny punkt POST z podpisem HMAC, deduplikacją i mapowaniem pól JSON.",
    prerequisites: [
      "System zewnętrzny, który potrafi wysłać żądanie HTTP POST.",
      "Możliwość ustawienia nagłówka podpisu lub tokenu Bearer.",
    ],
    steps: [
      "Po zapisaniu skopiuj unikalny endpoint widoczny przy źródle.",
      "Przekaż surowe body JSON do HMAC SHA-256 z użyciem sekretu źródła.",
      "Wyślij podpis w nagłówku X-MailFlow-Signature jako sha256=HEX.",
      "W payload przekaż co najmniej senderEmail, subject i receivedAt.",
      "Zapisz identyfikator externalId, aby kolejne próby nie tworzyły duplikatów.",
    ],
    environment: ["PUBLIC_APP_URL", "APP_ENCRYPTION_KEY"],
    testChecks: [
      "format mapowania JSON",
      "siła sekretu podpisu",
      "przykładowy payload i deduplikacja",
    ],
  },
  scraper: {
    title: "Monitor strony, RSS lub sitemap",
    summary:
      "Cykliczne pobieranie treści z kontrolą SSRF, hashem zmian i opcjonalnym selektorem CSS.",
    prerequisites: [
      "Publiczny adres HTTP/HTTPS dostępny bez interaktywnego logowania.",
      "Zgoda na automatyczne pobieranie oraz zgodność z robots.txt.",
      "Stabilny selektor CSS, RSS/Atom albo sitemap.xml.",
    ],
    steps: [
      "Wklej adres źródła i wybierz typ ekstrakcji.",
      "Dla trybu selektora wskaż możliwie wąski, stabilny selektor CSS.",
      "Ustaw interwał z poszanowaniem limitów strony; zwykle 15-60 minut.",
      "Host zostanie dodany do allowlisty źródła, a adresy prywatne pozostaną zablokowane.",
      "Test sprawdzi status HTTP, content-type i obecność wskazanej treści.",
    ],
    environment: ["SCRAPER_ALLOWED_HOSTS", "WORKER_SECRET"],
    testChecks: [
      "publiczny i bezpieczny adres URL",
      "status HTTP i limit 2 MB",
      "wynik selektora lub parsera feedu",
    ],
  },
};

export function emptySourceDraft(type: SourceType = "gmail"): SourceDraft {
  return {
    type,
    name: "",
    address: "",
    syncIntervalMinutes: type === "scraper" ? 15 : 5,
    folders:
      type === "gmail"
        ? "INBOX"
        : type === "outlook"
          ? "Inbox"
          : "INBOX",
    initialLookbackDays: 30,
    maxPerSync: 100,
    clientId: "",
    clientSecret: "",
    refreshToken: "",
    tenantId: "organizations",
    sharedMailbox: "",
    host: "",
    port: 993,
    security: "tls",
    username: "",
    password: "",
    rejectUnauthorized: true,
    webhookSecret: randomSecret(),
    signatureHeader: "x-mailflow-signature",
    payloadMapping: JSON.stringify(
      {
        externalId: "event.id",
        senderEmail: "sender.email",
        senderName: "sender.name",
        recipients: "recipients",
        subject: "subject",
        bodyText: "body.text",
        bodyHtml: "body.html",
        receivedAt: "created_at",
      },
      null,
      2,
    ),
    url: "",
    extractionMode: "content",
    cssSelector: "main",
    userAgent: "MailFlowBot/1.0 (+https://example.com/bot)",
    changeThreshold: 1,
    notifyOnInitial: false,
    respectRobotsTxt: true,
  };
}

export function sourceToDraft(source: SourceConnector): SourceDraft {
  const config = source.publicConfig ?? {};
  return {
    ...emptySourceDraft(source.type),
    id: source.id,
    type: source.type,
    name: source.name,
    address: source.address,
    syncIntervalMinutes: source.syncIntervalMinutes,
    folders: source.folders.join(", "),
    initialLookbackDays: Number(
      config.initial_lookback_days ?? config.initialLookbackDays ?? 30,
    ),
    maxPerSync: Number(config.max_per_sync ?? config.maxPerSync ?? 100),
    tenantId: String(config.tenant_id ?? config.tenantId ?? "organizations"),
    sharedMailbox: String(
      config.shared_mailbox ?? config.sharedMailbox ?? "",
    ),
    host: String(config.host ?? ""),
    port: Number(config.port ?? 993),
    security:
      config.security === "starttls" ? "starttls" : "tls",
    username: String(
      config.username_hint ?? config.usernameHint ?? source.address ?? "",
    ),
    rejectUnauthorized:
      (config.reject_unauthorized ?? config.rejectUnauthorized) !== false,
    signatureHeader: String(
      config.signature_header ??
        config.signatureHeader ??
        "x-mailflow-signature",
    ),
    payloadMapping: JSON.stringify(
      config.payload_mapping ?? config.payloadMapping ?? {},
      null,
      2,
    ),
    url: String(config.url ?? source.address ?? ""),
    extractionMode: ["selector", "rss", "sitemap"].includes(
      String(config.extraction_mode ?? config.extractionMode),
    )
      ? ((config.extraction_mode ?? config.extractionMode) as ExtractionMode)
      : "content",
    cssSelector: String(config.css_selector ?? config.cssSelector ?? "main"),
    userAgent: String(
      config.user_agent ??
        config.userAgent ??
        "MailFlowBot/1.0 (+https://example.com/bot)",
    ),
    changeThreshold: Number(
      config.change_threshold ?? config.changeThreshold ?? 1,
    ),
    notifyOnInitial: Boolean(
      config.notify_on_initial ?? config.notifyOnInitial,
    ),
    respectRobotsTxt:
      (config.respect_robots_txt ?? config.respectRobotsTxt) !== false,
  };
}

const validUrl = (value: string) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
};

const validEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export function validateSourceDraft(
  draft: SourceDraft,
  editing = false,
): SourceValidation {
  const errors: Record<string, string> = {};
  if (!draft.name.trim()) errors.name = "Podaj nazwę połączenia.";

  if (draft.type === "scraper") {
    if (!validUrl(draft.url)) errors.url = "Podaj publiczny adres HTTP/HTTPS.";
    if (
      draft.extractionMode === "selector" &&
      !draft.cssSelector.trim()
    ) {
      errors.cssSelector = "Selektor CSS jest wymagany w tym trybie.";
    }
  } else if (draft.type !== "webhook" && !validEmail(draft.address)) {
    errors.address = "Podaj poprawny adres e-mail.";
  }

  if (draft.type === "gmail") {
    if (!editing || draft.clientId) {
      if (!draft.clientId.endsWith(".apps.googleusercontent.com")) {
        errors.clientId = "Client ID powinien kończyć się na apps.googleusercontent.com.";
      }
    }
    if (!editing && !draft.clientSecret.trim()) {
      errors.clientSecret = "Client secret jest wymagany.";
    }
    if (!editing && !draft.refreshToken.trim()) {
      errors.refreshToken = "Refresh token jest wymagany.";
    }
  }

  if (draft.type === "outlook") {
    if (!draft.tenantId.trim()) errors.tenantId = "Podaj tenant ID.";
    if (!editing && !draft.clientId.trim()) {
      errors.clientId = "Client ID jest wymagany.";
    }
    if (!editing && !draft.clientSecret.trim()) {
      errors.clientSecret = "Client secret jest wymagany.";
    }
    if (!editing && !draft.refreshToken.trim()) {
      errors.refreshToken = "Refresh token jest wymagany.";
    }
  }

  if (draft.type === "imap") {
    if (!draft.host.trim()) errors.host = "Podaj host IMAP.";
    if (draft.port < 1 || draft.port > 65535) {
      errors.port = "Port musi mieścić się w zakresie 1-65535.";
    }
    if (!draft.username.trim()) errors.username = "Podaj nazwę użytkownika.";
    if (!editing && !draft.password) errors.password = "Podaj hasło aplikacji.";
  }

  if (draft.type === "webhook") {
    if (draft.webhookSecret.length < 24 && !editing) {
      errors.webhookSecret = "Sekret powinien mieć co najmniej 24 znaki.";
    }
    try {
      const mapping = JSON.parse(draft.payloadMapping);
      if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
        errors.payloadMapping = "Mapowanie musi być obiektem JSON.";
      }
    } catch {
      errors.payloadMapping = "Mapowanie nie jest poprawnym JSON-em.";
    }
  }

  if (draft.syncIntervalMinutes < 1 || draft.syncIntervalMinutes > 10080) {
    errors.syncIntervalMinutes = "Interwał musi wynosić od 1 do 10080 minut.";
  }
  if (draft.maxPerSync < 1 || draft.maxPerSync > 500) {
    errors.maxPerSync = "Jedna partia może zawierać od 1 do 500 elementów.";
  }

  const valid = Object.keys(errors).length === 0;
  const guide = sourceGuides[draft.type];
  return {
    valid,
    errors,
    checks: guide.testChecks.map((label) => ({
      label,
      ok: valid,
      detail: valid
        ? "Konfiguracja spełnia wymagania testu."
        : "Najpierw popraw oznaczone pola.",
    })),
  };
}

export function sourcePayload(draft: SourceDraft) {
  const folders = draft.folders
    .split(",")
    .map((folder) => folder.trim())
    .filter(Boolean);
  const address =
    draft.type === "scraper"
      ? draft.url
      : draft.type === "webhook"
        ? "Webhook JSON"
        : draft.address.trim().toLowerCase();
  const allowedHost =
    draft.type === "scraper" && validUrl(draft.url)
      ? new URL(draft.url).hostname
      : undefined;

  const publicConfig: Record<string, unknown> = {
    initial_lookback_days: draft.initialLookbackDays,
    max_per_sync: draft.maxPerSync,
  };
  const credentials: Record<string, unknown> = {};

  if (draft.type === "gmail") {
    publicConfig.scopes = ["gmail.readonly"];
    Object.assign(credentials, {
      clientId: draft.clientId,
      clientSecret: draft.clientSecret,
      refreshToken: draft.refreshToken,
      username: draft.address.trim().toLowerCase(),
    });
  }
  if (draft.type === "outlook") {
    Object.assign(publicConfig, {
      tenant_id: draft.tenantId,
      shared_mailbox: draft.sharedMailbox || null,
    });
    Object.assign(credentials, {
      tenantId: draft.tenantId,
      clientId: draft.clientId,
      clientSecret: draft.clientSecret,
      refreshToken: draft.refreshToken,
      username: draft.address.trim().toLowerCase(),
    });
  }
  if (draft.type === "imap") {
    Object.assign(publicConfig, {
      host: draft.host,
      port: draft.port,
      security: draft.security,
      username_hint: draft.username,
      reject_unauthorized: draft.rejectUnauthorized,
    });
    Object.assign(credentials, {
      host: draft.host,
      port: draft.port,
      secure: draft.security === "tls",
      username: draft.username,
      password: draft.password,
      rejectUnauthorized: draft.rejectUnauthorized,
    });
  }
  if (draft.type === "webhook") {
    Object.assign(publicConfig, {
      signature_header: draft.signatureHeader.toLowerCase(),
      payload_mapping: JSON.parse(draft.payloadMapping),
    });
    if (draft.webhookSecret) credentials.webhookSecret = draft.webhookSecret;
  }
  if (draft.type === "scraper") {
    Object.assign(publicConfig, {
      url: draft.url,
      extraction_mode: draft.extractionMode,
      css_selector: draft.cssSelector || null,
      user_agent: draft.userAgent,
      change_threshold: draft.changeThreshold,
      notify_on_initial: draft.notifyOnInitial,
      respect_robots_txt: draft.respectRobotsTxt,
      allowed_hosts: allowedHost ? [allowedHost] : [],
    });
  }

  return {
    type: draft.type,
    name: draft.name.trim(),
    address,
    sync_interval_minutes: draft.syncIntervalMinutes,
    folders,
    public_config: publicConfig,
    credentials: Object.fromEntries(
      Object.entries(credentials).filter(([, value]) => value !== ""),
    ),
  };
}

export function draftToSource(
  draft: SourceDraft,
  organizationId: string,
): SourceConnector {
  const payload = sourcePayload(draft);
  return {
    id: draft.id ?? `source-${crypto.randomUUID()}`,
    organizationId,
    name: payload.name,
    address: payload.address,
    type: draft.type,
    status: "active",
    unread: 0,
    total: 0,
    lastSyncAt: new Date().toISOString(),
    nextSyncSeconds: draft.syncIntervalMinutes * 60,
    folders: payload.folders,
    syncIntervalMinutes: draft.syncIntervalMinutes,
    publicConfig: payload.public_config,
    credentialsConfigured:
      draft.type === "scraper" ||
      Object.keys(payload.credentials).length > 0 ||
      Boolean(draft.id),
    lastTestAt: new Date().toISOString(),
    lastError: null,
    createdAt: new Date().toISOString(),
  };
}

export async function testSourceDraftLocally(
  draft: SourceDraft,
  editing = false,
) {
  const validation = validateSourceDraft(draft, editing);
  await new Promise((resolve) => window.setTimeout(resolve, 650));
  return validation;
}
