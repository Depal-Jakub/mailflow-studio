import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Globe2,
  Inbox,
  Info,
  KeyRound,
  Mail,
  Server,
  ShieldCheck,
  TestTube2,
  Webhook,
} from "lucide-react";
import { api } from "../../services/api";
import { demoMode } from "../../services/supabase";
import {
  draftToSource,
  emptySourceDraft,
  sourceGuides,
  sourcePayload,
  sourceToDraft,
  testSourceDraftLocally,
  validateSourceDraft,
  type SourceDraft,
  type SourceValidation,
} from "../../lib/connectors";
import type { SourceConnector, SourceType } from "../../types";
import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";
import { Modal } from "../ui/Modal";
import { Toggle } from "../ui/Toggle";

// Shared with the source list so labels and icons stay consistent.
// eslint-disable-next-line react-refresh/only-export-components
export const sourceTypeInfo: Record<
  SourceType,
  { label: string; description: string; icon: typeof Mail }
> = {
  gmail: {
    label: "Gmail API",
    description: "OAuth 2.0, etykiety i pełna synchronizacja wątków.",
    icon: Mail,
  },
  outlook: {
    label: "Microsoft 365",
    description: "Microsoft Graph, foldery i współdzielone skrzynki.",
    icon: Inbox,
  },
  imap: {
    label: "IMAP",
    description: "Dowolna skrzynka przez bezpieczne połączenie TLS.",
    icon: Server,
  },
  webhook: {
    label: "Webhook",
    description: "Własny punkt wejścia dla systemów zewnętrznych.",
    icon: Webhook,
  },
  scraper: {
    label: "Web scraper",
    description: "Monitorowanie stron, RSS, sitemap i zmian treści.",
    icon: Globe2,
  },
};

const errorText = (message?: string) =>
  message ? <span className="field-error">{message}</span> : null;

const intervalOptions = [
  [1, "Co minutę"],
  [5, "Co 5 minut"],
  [15, "Co 15 minut"],
  [30, "Co 30 minut"],
  [60, "Co godzinę"],
  [360, "Co 6 godzin"],
  [1440, "Raz dziennie"],
] as const;

export function SourceWizard({
  open,
  source,
  organizationId,
  onClose,
  onSaved,
  onUpdated,
  addToast,
}: {
  open: boolean;
  source: SourceConnector | null;
  organizationId: string;
  onClose: () => void;
  onSaved: (source: SourceConnector) => void;
  onUpdated: (id: string, patch: Partial<SourceConnector>) => void;
  addToast: (toast: {
    title: string;
    message: string;
    tone: "success" | "info" | "warning" | "error";
  }) => void;
}) {
  const [draft, setDraft] = useState<SourceDraft>(() =>
    source ? sourceToDraft(source) : emptySourceDraft("gmail"),
  );
  const [tab, setTab] = useState<"configuration" | "instructions">(
    "configuration",
  );
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<SourceValidation | null>(null);

  const guide = sourceGuides[draft.type];
  const webhookUrl = useMemo(
    () =>
      `${window.location.origin}/hooks/${source?.id ?? "SOURCE_ID_PO_ZAPISIE"}`,
    [source?.id],
  );

  const patchDraft = <K extends keyof SourceDraft>(
    key: K,
    value: SourceDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setTestResult(null);
  };

  const changeType = (type: SourceType) => {
    setDraft((current) => ({
      ...emptySourceDraft(type),
      name: current.name,
      type,
    }));
    setTestResult(null);
  };

  const runTest = async () => {
    setTesting(true);
    try {
      const validation = demoMode
        ? await testSourceDraftLocally(draft, Boolean(source))
        : await api.post<SourceValidation>(
            "sources/test",
            sourcePayload(draft),
            organizationId,
          );
      setTestResult(validation);
      addToast({
        title: validation.valid
          ? "Test połączenia zakończony"
          : "Konfiguracja wymaga poprawy",
        message: validation.valid
          ? demoMode
            ? "Tryb demo potwierdził kompletność konfiguracji. Test sieciowy uruchomi się po podłączeniu backendu."
            : "Dostawca odpowiedział prawidłowo i konto jest dostępne."
          : "Popraw pola oznaczone w formularzu i uruchom test ponownie.",
        tone: validation.valid ? "success" : "warning",
      });
      return validation;
    } catch (error) {
      const validation: SourceValidation = {
        valid: false,
        errors: {},
        checks: [
          {
            label: "Połączenie z dostawcą",
            ok: false,
            detail:
              error instanceof Error
                ? error.message
                : "Nie udało się wykonać testu.",
          },
        ],
      };
      setTestResult(validation);
      addToast({
        title: "Test połączenia nie powiódł się",
        message: validation.checks[0].detail,
        tone: "error",
      });
      return validation;
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    const localValidation = validateSourceDraft(draft, Boolean(source));
    if (!localValidation.valid) {
      setTestResult(localValidation);
      setTab("configuration");
      return;
    }
    setSaving(true);
    try {
      const validation = testResult?.valid ? testResult : await runTest();
      if (!validation.valid) return;

      if (demoMode) {
        const next = draftToSource(draft, organizationId);
        if (source) onUpdated(source.id, next);
        else onSaved(next);
      } else {
        const payload = sourcePayload(draft);
        const saved = source
          ? await api.patch<SourceConnector>(
              `sources/${source.id}`,
              payload,
              organizationId,
            )
          : await api.post<SourceConnector>(
              "sources",
              payload,
              organizationId,
            );
        if (source) onUpdated(source.id, saved);
        else onSaved(saved);
      }
      addToast({
        title: source ? "Źródło zaktualizowane" : "Źródło jest gotowe",
        message: `${draft.name} zapisano i aktywowano po poprawnym teście.`,
        tone: "success",
      });
      onClose();
    } catch (error) {
      addToast({
        title: "Nie udało się zapisać źródła",
        message:
          error instanceof Error ? error.message : "Wystąpił nieznany błąd.",
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const errors = testResult?.errors ?? {};

  return (
    <Modal
      description="Skonfiguruj pobieranie, przetestuj dostęp i zapisz szyfrowane poświadczenia."
      footer={
        <>
          <Button onClick={onClose}>Anuluj</Button>
          <Button
            icon={TestTube2}
            loading={testing}
            onClick={() => void runTest()}
          >
            Testuj połączenie
          </Button>
          <Button
            icon={CheckCircle2}
            loading={saving}
            onClick={() => void save()}
            variant="primary"
          >
            Zapisz i aktywuj
          </Button>
        </>
      }
      onClose={onClose}
      open={open}
      size="xl"
      title={source ? "Konfiguracja źródła" : "Nowe źródło danych"}
    >
      <div className="wizard-tabs">
        <button
          className={tab === "configuration" ? "is-active" : ""}
          onClick={() => setTab("configuration")}
          type="button"
        >
          Konfiguracja
        </button>
        <button
          className={tab === "instructions" ? "is-active" : ""}
          onClick={() => setTab("instructions")}
          type="button"
        >
          Instrukcja podłączenia
        </button>
      </div>

      {tab === "configuration" ? (
        <div className="source-wizard">
          <div className="source-type-grid">
            {(Object.entries(sourceTypeInfo) as Array<
              [SourceType, (typeof sourceTypeInfo)[SourceType]]
            >).map(([key, info]) => {
              const Icon = info.icon;
              return (
                <button
                  className={draft.type === key ? "is-selected" : ""}
                  key={key}
                  onClick={() => changeType(key)}
                  type="button"
                >
                  <Icon size={21} />
                  <strong>{info.label}</strong>
                  <span>{info.description}</span>
                </button>
              );
            })}
          </div>

          <section className="wizard-section">
            <header>
              <div>
                <h3>Podstawowe informacje</h3>
                <p>Nazwa, adres i zakres synchronizacji widoczny w panelu.</p>
              </div>
            </header>
            <div className="form-grid form-grid--two">
              <FormField label="Nazwa połączenia">
                <input
                  onChange={(event) => patchDraft("name", event.target.value)}
                  placeholder="np. Skrzynka działu sprzedaży"
                  value={draft.name}
                />
                {errorText(errors.name)}
              </FormField>
              {draft.type === "scraper" ? (
                <FormField label="Adres strony, feedu lub sitemap">
                  <input
                    onChange={(event) => patchDraft("url", event.target.value)}
                    placeholder="https://example.com/aktualnosci"
                    type="url"
                    value={draft.url}
                  />
                  {errorText(errors.url)}
                </FormField>
              ) : draft.type === "webhook" ? (
                <FormField
                  hint="Unikalny adres pojawi się po pierwszym zapisie."
                  label="Endpoint odbiorczy"
                >
                  <div className="copy-field">
                    <input readOnly value={webhookUrl} />
                    <button
                      aria-label="Skopiuj endpoint"
                      onClick={() => void navigator.clipboard.writeText(webhookUrl)}
                      type="button"
                    >
                      <Clipboard size={16} />
                    </button>
                  </div>
                </FormField>
              ) : (
                <FormField label="Adres e-mail">
                  <input
                    onChange={(event) =>
                      patchDraft("address", event.target.value)
                    }
                    placeholder="biuro@example.com"
                    type="email"
                    value={draft.address}
                  />
                  {errorText(errors.address)}
                </FormField>
              )}
              {draft.type !== "webhook" ? (
                <FormField label="Częstotliwość">
                  <select
                    onChange={(event) =>
                      patchDraft(
                        "syncIntervalMinutes",
                        Number(event.target.value),
                      )
                    }
                    value={draft.syncIntervalMinutes}
                  >
                    {intervalOptions.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {errorText(errors.syncIntervalMinutes)}
                </FormField>
              ) : null}
              {["gmail", "outlook", "imap"].includes(draft.type) ? (
                <>
                  <FormField
                    hint="Oddziel nazwy przecinkami."
                    label="Foldery lub etykiety"
                  >
                    <input
                      onChange={(event) =>
                        patchDraft("folders", event.target.value)
                      }
                      placeholder="INBOX, Sent, Archive"
                      value={draft.folders}
                    />
                  </FormField>
                  <FormField label="Pierwsza synchronizacja">
                    <select
                      onChange={(event) =>
                        patchDraft(
                          "initialLookbackDays",
                          Number(event.target.value),
                        )
                      }
                      value={draft.initialLookbackDays}
                    >
                      <option value="1">Ostatnie 24 godziny</option>
                      <option value="7">Ostatnie 7 dni</option>
                      <option value="30">Ostatnie 30 dni</option>
                      <option value="90">Ostatnie 90 dni</option>
                      <option value="365">Ostatni rok</option>
                      <option value="3650">Pełne archiwum</option>
                    </select>
                  </FormField>
                  <FormField label="Maksymalna partia">
                    <input
                      max="500"
                      min="1"
                      onChange={(event) =>
                        patchDraft("maxPerSync", Number(event.target.value))
                      }
                      type="number"
                      value={draft.maxPerSync}
                    />
                    {errorText(errors.maxPerSync)}
                  </FormField>
                </>
              ) : null}
            </div>
          </section>

          {draft.type === "gmail" ? (
            <section className="wizard-section wizard-section--secure">
              <header>
                <span>
                  <KeyRound size={18} />
                </span>
                <div>
                  <h3>OAuth 2.0 Google</h3>
                  <p>Poświadczenia zostaną zaszyfrowane poza schematem publicznym.</p>
                </div>
              </header>
              <div className="form-grid form-grid--two">
                <FormField label="OAuth Client ID">
                  <input
                    onChange={(event) =>
                      patchDraft("clientId", event.target.value)
                    }
                    placeholder="000000.apps.googleusercontent.com"
                    value={draft.clientId}
                  />
                  {errorText(errors.clientId)}
                </FormField>
                <FormField label="OAuth Client secret">
                  <input
                    onChange={(event) =>
                      patchDraft("clientSecret", event.target.value)
                    }
                    placeholder={source ? "Pozostaw puste, aby zachować" : "GOCSPX-..."}
                    type="password"
                    value={draft.clientSecret}
                  />
                  {errorText(errors.clientSecret)}
                </FormField>
                <FormField
                  hint="Wymagany access_type=offline i zakres gmail.readonly."
                  label="Refresh token"
                >
                  <input
                    onChange={(event) =>
                      patchDraft("refreshToken", event.target.value)
                    }
                    placeholder={source ? "Pozostaw puste, aby zachować" : "1//..."}
                    type="password"
                    value={draft.refreshToken}
                  />
                  {errorText(errors.refreshToken)}
                </FormField>
              </div>
            </section>
          ) : null}

          {draft.type === "outlook" ? (
            <section className="wizard-section wizard-section--secure">
              <header>
                <span>
                  <KeyRound size={18} />
                </span>
                <div>
                  <h3>Microsoft Entra ID</h3>
                  <p>Delegowany dostęp Graph API z odnawialnym tokenem.</p>
                </div>
              </header>
              <div className="form-grid form-grid--two">
                <FormField label="Tenant ID">
                  <input
                    onChange={(event) =>
                      patchDraft("tenantId", event.target.value)
                    }
                    placeholder="organizations lub UUID tenanta"
                    value={draft.tenantId}
                  />
                  {errorText(errors.tenantId)}
                </FormField>
                <FormField label="Client ID">
                  <input
                    onChange={(event) =>
                      patchDraft("clientId", event.target.value)
                    }
                    placeholder="Application (client) ID"
                    value={draft.clientId}
                  />
                  {errorText(errors.clientId)}
                </FormField>
                <FormField label="Client secret">
                  <input
                    onChange={(event) =>
                      patchDraft("clientSecret", event.target.value)
                    }
                    placeholder={source ? "Pozostaw puste, aby zachować" : "Sekret aplikacji"}
                    type="password"
                    value={draft.clientSecret}
                  />
                  {errorText(errors.clientSecret)}
                </FormField>
                <FormField label="Refresh token">
                  <input
                    onChange={(event) =>
                      patchDraft("refreshToken", event.target.value)
                    }
                    placeholder={source ? "Pozostaw puste, aby zachować" : "Refresh token"}
                    type="password"
                    value={draft.refreshToken}
                  />
                  {errorText(errors.refreshToken)}
                </FormField>
                <FormField
                  hint="Pozostaw puste dla skrzynki zalogowanego użytkownika."
                  label="Skrzynka współdzielona"
                >
                  <input
                    onChange={(event) =>
                      patchDraft("sharedMailbox", event.target.value)
                    }
                    placeholder="shared@example.com"
                    type="email"
                    value={draft.sharedMailbox}
                  />
                </FormField>
              </div>
            </section>
          ) : null}

          {draft.type === "imap" ? (
            <section className="wizard-section wizard-section--secure">
              <header>
                <span>
                  <ShieldCheck size={18} />
                </span>
                <div>
                  <h3>Połączenie IMAP</h3>
                  <p>Hasło jest używane wyłącznie przez worker serwerowy.</p>
                </div>
              </header>
              <div className="form-grid form-grid--two">
                <FormField label="Serwer IMAP">
                  <input
                    onChange={(event) => patchDraft("host", event.target.value)}
                    placeholder="imap.example.com"
                    value={draft.host}
                  />
                  {errorText(errors.host)}
                </FormField>
                <FormField label="Port i szyfrowanie">
                  <div className="field-row">
                    <input
                      max="65535"
                      min="1"
                      onChange={(event) =>
                        patchDraft("port", Number(event.target.value))
                      }
                      type="number"
                      value={draft.port}
                    />
                    <select
                      onChange={(event) =>
                        patchDraft(
                          "security",
                          event.target.value as SourceDraft["security"],
                        )
                      }
                      value={draft.security}
                    >
                      <option value="tls">TLS</option>
                      <option value="starttls">STARTTLS</option>
                    </select>
                  </div>
                  {errorText(errors.port)}
                </FormField>
                <FormField label="Nazwa użytkownika">
                  <input
                    onChange={(event) =>
                      patchDraft("username", event.target.value)
                    }
                    placeholder="biuro@example.com"
                    value={draft.username}
                  />
                  {errorText(errors.username)}
                </FormField>
                <FormField label="Hasło / hasło aplikacji">
                  <input
                    onChange={(event) =>
                      patchDraft("password", event.target.value)
                    }
                    placeholder={source ? "Pozostaw puste, aby zachować" : "••••••••••••••••"}
                    type="password"
                    value={draft.password}
                  />
                  {errorText(errors.password)}
                </FormField>
              </div>
              <Toggle
                checked={draft.rejectUnauthorized}
                label="Weryfikuj certyfikat TLS serwera"
                onChange={(checked) =>
                  patchDraft("rejectUnauthorized", checked)
                }
              />
            </section>
          ) : null}

          {draft.type === "webhook" ? (
            <section className="wizard-section wizard-section--secure">
              <header>
                <span>
                  <Webhook size={18} />
                </span>
                <div>
                  <h3>Podpis i mapowanie payloadu</h3>
                  <p>Każde źródło otrzymuje własny sekret i endpoint.</p>
                </div>
              </header>
              <div className="form-grid form-grid--two">
                <FormField label="Nagłówek podpisu">
                  <input
                    onChange={(event) =>
                      patchDraft("signatureHeader", event.target.value)
                    }
                    value={draft.signatureHeader}
                  />
                </FormField>
                <FormField label="Sekret HMAC SHA-256">
                  <div className="copy-field">
                    <input
                      onChange={(event) =>
                        patchDraft("webhookSecret", event.target.value)
                      }
                      type="password"
                      value={draft.webhookSecret}
                    />
                    <button
                      aria-label="Skopiuj sekret"
                      onClick={() =>
                        void navigator.clipboard.writeText(draft.webhookSecret)
                      }
                      type="button"
                    >
                      <Clipboard size={16} />
                    </button>
                  </div>
                  {errorText(errors.webhookSecret)}
                </FormField>
              </div>
              <FormField
                hint="Wartości są ścieżkami do pól w przychodzącym JSON-ie."
                label="Mapowanie pól JSON"
              >
                <textarea
                  className="code-textarea"
                  onChange={(event) =>
                    patchDraft("payloadMapping", event.target.value)
                  }
                  rows={11}
                  value={draft.payloadMapping}
                />
                {errorText(errors.payloadMapping)}
              </FormField>
            </section>
          ) : null}

          {draft.type === "scraper" ? (
            <section className="wizard-section">
              <header>
                <span>
                  <Globe2 size={18} />
                </span>
                <div>
                  <h3>Ekstrakcja i wykrywanie zmian</h3>
                  <p>Treść jest hashowana, więc brak zmiany nie tworzy wiadomości.</p>
                </div>
              </header>
              <div className="form-grid form-grid--two">
                <FormField label="Tryb ekstrakcji">
                  <select
                    onChange={(event) =>
                      patchDraft(
                        "extractionMode",
                        event.target.value as SourceDraft["extractionMode"],
                      )
                    }
                    value={draft.extractionMode}
                  >
                    <option value="content">Główna treść strony</option>
                    <option value="selector">Selektor CSS</option>
                    <option value="rss">Kanał RSS / Atom</option>
                    <option value="sitemap">Sitemap XML</option>
                  </select>
                </FormField>
                <FormField label="Selektor CSS">
                  <input
                    disabled={draft.extractionMode !== "selector"}
                    onChange={(event) =>
                      patchDraft("cssSelector", event.target.value)
                    }
                    placeholder="main .article-list"
                    value={draft.cssSelector}
                  />
                  {errorText(errors.cssSelector)}
                </FormField>
                <FormField label="Nagłówek User-Agent">
                  <input
                    onChange={(event) =>
                      patchDraft("userAgent", event.target.value)
                    }
                    value={draft.userAgent}
                  />
                </FormField>
                <FormField label="Próg zmiany treści">
                  <div className="range-field">
                    <input
                      max="25"
                      min="1"
                      onChange={(event) =>
                        patchDraft(
                          "changeThreshold",
                          Number(event.target.value),
                        )
                      }
                      type="range"
                      value={draft.changeThreshold}
                    />
                    <strong>{draft.changeThreshold}%</strong>
                  </div>
                </FormField>
              </div>
              <div className="toggle-stack">
                <Toggle
                  checked={draft.respectRobotsTxt}
                  label="Respektuj robots.txt i ograniczenia witryny"
                  onChange={(checked) =>
                    patchDraft("respectRobotsTxt", checked)
                  }
                />
                <Toggle
                  checked={draft.notifyOnInitial}
                  label="Utwórz wiadomość także przy pierwszym pobraniu"
                  onChange={(checked) =>
                    patchDraft("notifyOnInitial", checked)
                  }
                />
              </div>
            </section>
          ) : null}

          {testResult ? (
            <section
              className={`connection-test ${
                testResult.valid
                  ? "connection-test--success"
                  : "connection-test--error"
              }`}
            >
              <header>
                {testResult.valid ? (
                  <CheckCircle2 size={19} />
                ) : (
                  <AlertTriangle size={19} />
                )}
                <div>
                  <strong>
                    {testResult.valid
                      ? "Konfiguracja przeszła test"
                      : "Test wykrył problemy"}
                  </strong>
                  <span>
                    {demoMode
                      ? "Walidacja lokalna bez wysyłania sekretów."
                      : "Odpowiedź z bezpiecznego endpointu serwerowego."}
                  </span>
                </div>
              </header>
              <div>
                {testResult.checks.map((check) => (
                  <p key={check.label}>
                    {check.ok ? (
                      <CheckCircle2 size={15} />
                    ) : (
                      <AlertTriangle size={15} />
                    )}
                    <span>
                      <strong>{check.label}</strong>
                      <small>{check.detail}</small>
                    </span>
                  </p>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : (
        <div className="connector-guide">
          <header>
            <span>
              <Info size={22} />
            </span>
            <div>
              <h3>{guide.title}</h3>
              <p>{guide.summary}</p>
            </div>
          </header>

          <section>
            <h4>Przed rozpoczęciem</h4>
            <ul>
              {guide.prerequisites.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section>
            <h4>Konfiguracja krok po kroku</h4>
            <ol>
              {guide.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>

          {draft.type === "gmail" || draft.type === "outlook" ? (
            <section className="oauth-scope-box">
              <ShieldCheck size={18} />
              <div>
                <strong>Adres callback dla aplikacji webowej</strong>
                <code>
                  {window.location.origin}/.netlify/functions/oauth-connect/
                  {draft.type === "gmail" ? "google" : "microsoft"}/callback
                </code>
                <small>
                  Produkcyjnie zastąp localhost publicznym adresem aplikacji.
                </small>
              </div>
            </section>
          ) : null}

          {draft.type === "webhook" ? (
            <section className="webhook-example">
              <h4>Minimalny payload</h4>
              <pre>{`{
  "event": { "id": "evt_123" },
  "sender": { "email": "system@example.com" },
  "recipients": [{ "email": "inbox@firma.pl" }],
  "subject": "Nowe zdarzenie",
  "body": { "text": "Treść wiadomości" },
  "created_at": "${new Date().toISOString()}"
}`}</pre>
            </section>
          ) : null}

          {guide.environment.length > 0 ? (
            <section>
              <h4>Zmienne środowiskowe produkcji</h4>
              <div className="env-chip-list">
                {guide.environment.map((variable) => (
                  <code key={variable}>{variable}</code>
                ))}
              </div>
            </section>
          ) : null}

          <div className="guide-note">
            <ShieldCheck size={18} />
            <p>
              Sekrety są przesyłane wyłącznie do backendu przez HTTPS,
              szyfrowane AES-256-GCM i zapisywane w prywatnym schemacie
              Supabase. Przeglądarka później otrzymuje tylko maskowane
              metadane.
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}
