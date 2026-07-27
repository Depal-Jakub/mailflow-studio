import { useEffect, useState } from "react";
import {
  Bell,
  Braces,
  Building2,
  CheckCircle2,
  Database,
  KeyRound,
  Save,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/Button";
import { FormField } from "../components/ui/FormField";
import { PageHeader } from "../components/ui/PageHeader";
import { Toggle } from "../components/ui/Toggle";
import { useAppState } from "../lib/AppState";
import { cn } from "../lib/format";
import { api } from "../services/api";
import { demoMode } from "../services/supabase";

const sections = [
  { key: "organization", label: "Organizacja", icon: Building2 },
  { key: "processing", label: "Przetwarzanie", icon: SlidersHorizontal },
  { key: "security", label: "Bezpieczeństwo", icon: ShieldCheck },
  { key: "notifications", label: "Powiadomienia", icon: Bell },
  { key: "api", label: "API i webhooki", icon: Braces },
  { key: "retention", label: "Dane i retencja", icon: Database },
] as const;

type SectionKey = (typeof sections)[number]["key"];

const notificationEvents = [
  "Błąd synchronizacji skrzynki",
  "Automatyzacja zakończona błędem",
  "Wiadomość z wynikiem >= 90",
  "Nowe zadanie do weryfikacji",
  "Limit wysyłki przekroczony w 80%",
] as const;

type NotificationChannels = Record<
  string,
  { email: boolean; panel: boolean; webhook: boolean }
>;

interface SettingsState {
  organization: {
    name: string;
    slug: string;
    timezone: string;
    locale: string;
  };
  processing: {
    autoClassification: boolean;
    holdUncertainActions: boolean;
    analyzeAttachments: boolean;
    actionThreshold: number;
    maxAttempts: number;
    taskTimeoutSeconds: number;
    concurrencyLimit: number;
  };
  security: {
    requireAdminMfa: boolean;
    expireSessions: boolean;
    restrictInviteDomains: boolean;
    sessionDuration: string;
    secretRotationDays: string;
  };
  notifications: NotificationChannels;
  retention: {
    messageDays: string;
    attachmentDays: string;
    auditDays: string;
    analyticsDays: string;
  };
}

const defaultNotifications = (): NotificationChannels =>
  Object.fromEntries(
    notificationEvents.map((label, index) => [
      label,
      { email: true, panel: true, webhook: index < 2 },
    ]),
  );

const defaultSettings = (
  organization: ReturnType<typeof useAppState>["activeOrganization"],
): SettingsState => ({
  organization: {
    name: organization.name,
    slug: organization.slug,
    timezone: organization.timezone,
    locale: organization.locale,
  },
  processing: {
    autoClassification: true,
    holdUncertainActions: true,
    analyzeAttachments: true,
    actionThreshold: 80,
    maxAttempts: 3,
    taskTimeoutSeconds: 90,
    concurrencyLimit: 10,
  },
  security: {
    requireAdminMfa: true,
    expireSessions: true,
    restrictInviteDomains: false,
    sessionDuration: "8h",
    secretRotationDays: "90",
  },
  notifications: defaultNotifications(),
  retention: {
    messageDays: "365",
    attachmentDays: "180",
    auditDays: "365",
    analyticsDays: "730",
  },
});

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const booleanValue = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

const numberValue = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const demoSettingsStorageKey = (organizationId: string) =>
  `mailflow-studio:demo-settings:v1:${organizationId}`;

const mergeDemoSettings = (
  defaults: SettingsState,
  storedValue: unknown,
): SettingsState => {
  const stored = record(storedValue);
  const organization = record(stored.organization);
  const processing = record(stored.processing);
  const security = record(stored.security);
  const retention = record(stored.retention);
  const notifications = record(stored.notifications);

  return {
    organization: {
      name: String(organization.name ?? defaults.organization.name),
      slug: String(organization.slug ?? defaults.organization.slug),
      timezone: String(
        organization.timezone ?? defaults.organization.timezone,
      ),
      locale: String(organization.locale ?? defaults.organization.locale),
    },
    processing: {
      autoClassification: booleanValue(
        processing.autoClassification,
        defaults.processing.autoClassification,
      ),
      holdUncertainActions: booleanValue(
        processing.holdUncertainActions,
        defaults.processing.holdUncertainActions,
      ),
      analyzeAttachments: booleanValue(
        processing.analyzeAttachments,
        defaults.processing.analyzeAttachments,
      ),
      actionThreshold: numberValue(
        processing.actionThreshold,
        defaults.processing.actionThreshold,
      ),
      maxAttempts: numberValue(
        processing.maxAttempts,
        defaults.processing.maxAttempts,
      ),
      taskTimeoutSeconds: numberValue(
        processing.taskTimeoutSeconds,
        defaults.processing.taskTimeoutSeconds,
      ),
      concurrencyLimit: numberValue(
        processing.concurrencyLimit,
        defaults.processing.concurrencyLimit,
      ),
    },
    security: {
      requireAdminMfa: booleanValue(
        security.requireAdminMfa,
        defaults.security.requireAdminMfa,
      ),
      expireSessions: booleanValue(
        security.expireSessions,
        defaults.security.expireSessions,
      ),
      restrictInviteDomains: booleanValue(
        security.restrictInviteDomains,
        defaults.security.restrictInviteDomains,
      ),
      sessionDuration: String(
        security.sessionDuration ?? defaults.security.sessionDuration,
      ),
      secretRotationDays: String(
        security.secretRotationDays ?? defaults.security.secretRotationDays,
      ),
    },
    notifications: Object.fromEntries(
      notificationEvents.map((label) => {
        const item = record(notifications[label]);
        return [
          label,
          {
            email: booleanValue(item.email, defaults.notifications[label].email),
            panel: booleanValue(item.panel, defaults.notifications[label].panel),
            webhook: booleanValue(
              item.webhook,
              defaults.notifications[label].webhook,
            ),
          },
        ];
      }),
    ),
    retention: {
      messageDays: String(retention.messageDays ?? defaults.retention.messageDays),
      attachmentDays: String(
        retention.attachmentDays ?? defaults.retention.attachmentDays,
      ),
      auditDays: String(retention.auditDays ?? defaults.retention.auditDays),
      analyticsDays: String(
        retention.analyticsDays ?? defaults.retention.analyticsDays,
      ),
    },
  };
};

export function SettingsPage() {
  const {
    activeOrganization,
    activeOrganizationId,
    addToast,
    updateOrganization,
  } = useAppState();
  const navigate = useNavigate();
  const [section, setSection] = useState<SectionKey>("organization");
  const [settings, setSettings] = useState<SettingsState>(() =>
    defaultSettings(activeOrganization),
  );
  const [loading, setLoading] = useState(!demoMode);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const defaults = defaultSettings(activeOrganization);
    if (demoMode) {
      let nextSettings = defaults;
      try {
        const raw = window.localStorage.getItem(
          demoSettingsStorageKey(activeOrganizationId),
        );
        nextSettings = raw
          ? mergeDemoSettings(defaults, JSON.parse(raw))
          : defaults;
      } catch {
        nextSettings = defaults;
      }
      const timeoutId = window.setTimeout(() => {
        setSettings(nextSettings);
        setLoading(false);
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }

    let cancelled = false;
    void api
      .get<{
        organization: Record<string, unknown>;
        settings: Record<string, unknown>;
      }>("settings", activeOrganizationId)
      .then((payload) => {
        if (cancelled) return;
        const stored = payload.settings;
        const processing = record(stored.processing);
        const security = record(stored.security);
        const retention = record(stored.retention);
        const channels = record(stored.notification_channels);
        const notificationSettings = Object.fromEntries(
          notificationEvents.map((label) => {
            const item = record(channels[label]);
            return [
              label,
              {
                email: booleanValue(item.email, defaults.notifications[label].email),
                panel: booleanValue(item.panel, defaults.notifications[label].panel),
                webhook: booleanValue(
                  item.webhook,
                  defaults.notifications[label].webhook,
                ),
              },
            ];
          }),
        );
        setSettings({
          organization: {
            name: String(payload.organization.name ?? defaults.organization.name),
            slug: String(payload.organization.slug ?? defaults.organization.slug),
            timezone: String(
              payload.organization.timezone ?? defaults.organization.timezone,
            ),
            locale: String(
              payload.organization.locale ?? defaults.organization.locale,
            ),
          },
          processing: {
            autoClassification: booleanValue(
              processing.auto_classification,
              defaults.processing.autoClassification,
            ),
            holdUncertainActions: booleanValue(
              processing.hold_uncertain_actions,
              defaults.processing.holdUncertainActions,
            ),
            analyzeAttachments: booleanValue(
              processing.analyze_attachments,
              defaults.processing.analyzeAttachments,
            ),
            actionThreshold: numberValue(
              processing.action_threshold,
              defaults.processing.actionThreshold,
            ),
            maxAttempts: numberValue(
              processing.max_attempts,
              defaults.processing.maxAttempts,
            ),
            taskTimeoutSeconds: numberValue(
              processing.task_timeout_seconds,
              defaults.processing.taskTimeoutSeconds,
            ),
            concurrencyLimit: numberValue(
              processing.concurrency_limit,
              defaults.processing.concurrencyLimit,
            ),
          },
          security: {
            requireAdminMfa: booleanValue(
              security.require_admin_mfa,
              defaults.security.requireAdminMfa,
            ),
            expireSessions: booleanValue(
              security.expire_sessions,
              defaults.security.expireSessions,
            ),
            restrictInviteDomains: booleanValue(
              security.restrict_invite_domains,
              defaults.security.restrictInviteDomains,
            ),
            sessionDuration: String(
              security.session_duration ?? defaults.security.sessionDuration,
            ),
            secretRotationDays: String(
              security.secret_rotation_days ??
                defaults.security.secretRotationDays,
            ),
          },
          notifications: notificationSettings,
          retention: {
            messageDays: String(
              retention.message_days ?? defaults.retention.messageDays,
            ),
            attachmentDays: String(
              retention.attachment_days ?? defaults.retention.attachmentDays,
            ),
            auditDays: String(
              retention.audit_days ?? defaults.retention.auditDays,
            ),
            analyticsDays: String(
              retention.analytics_days ?? defaults.retention.analyticsDays,
            ),
          },
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        addToast({
          title: "Nie udało się pobrać ustawień",
          message: error instanceof Error ? error.message : "Spróbuj ponownie.",
          tone: "error",
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrganization, activeOrganizationId, addToast]);

  const save = async () => {
    if (!settings.organization.name.trim()) {
      addToast({
        title: "Nazwa organizacji jest wymagana",
        message: "Uzupełnij nazwę przed zapisaniem.",
        tone: "warning",
      });
      return;
    }
    setSaving(true);
    try {
      if (!demoMode) {
        await api.patch(
          "settings",
          {
            organization: {
              name: settings.organization.name,
              timezone: settings.organization.timezone,
              locale: settings.organization.locale,
            },
            settings: {
              processing: {
                auto_classification: settings.processing.autoClassification,
                hold_uncertain_actions:
                  settings.processing.holdUncertainActions,
                analyze_attachments: settings.processing.analyzeAttachments,
                action_threshold: settings.processing.actionThreshold,
                max_attempts: settings.processing.maxAttempts,
                task_timeout_seconds: settings.processing.taskTimeoutSeconds,
                concurrency_limit: settings.processing.concurrencyLimit,
              },
              security: {
                require_admin_mfa: settings.security.requireAdminMfa,
                expire_sessions: settings.security.expireSessions,
                restrict_invite_domains:
                  settings.security.restrictInviteDomains,
                session_duration: settings.security.sessionDuration,
                secret_rotation_days: settings.security.secretRotationDays,
              },
              notification_channels: settings.notifications,
              retention: {
                message_days: settings.retention.messageDays,
                attachment_days: settings.retention.attachmentDays,
                audit_days: settings.retention.auditDays,
                analytics_days: settings.retention.analyticsDays,
              },
            },
          },
          activeOrganizationId,
        );
      } else {
        window.localStorage.setItem(
          demoSettingsStorageKey(activeOrganizationId),
          JSON.stringify(settings),
        );
      }
      updateOrganization(activeOrganizationId, {
        name: settings.organization.name,
        timezone: settings.organization.timezone,
        locale: settings.organization.locale,
      });
      addToast({
        title: "Ustawienia zapisane",
        message: "Zmiany zostały zastosowane i dodane do dziennika audytu.",
        tone: "success",
      });
    } catch (error) {
      addToast({
        title: "Nie udało się zapisać ustawień",
        message: error instanceof Error ? error.message : "Spróbuj ponownie.",
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        actions={
          <Button
            disabled={loading}
            icon={Save}
            loading={saving}
            onClick={() => void save()}
            variant="primary"
          >
            Zapisz zmiany
          </Button>
        }
        description="Konfiguracja organizacji, bezpieczeństwa, retencji oraz API."
        title="Ustawienia"
      />

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Sekcje ustawień">
          {sections.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={cn(section === item.key && "is-active")}
                key={item.key}
                onClick={() => setSection(item.key)}
                type="button"
              >
                <Icon size={17} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <section className="workspace-panel settings-content">
          {section === "organization" ? (
            <>
              <div className="workspace-panel__header">
                <div>
                  <h2>Organizacja</h2>
                  <p>Nazwa, strefa czasowa i domyślne ustawienia przestrzeni.</p>
                </div>
              </div>
              <div className="settings-form">
                <div className="organization-logo">MF</div>
                <div className="form-grid form-grid--two">
                  <FormField label="Nazwa organizacji">
                    <input
                      disabled={loading}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          organization: {
                            ...current.organization,
                            name: event.target.value,
                          },
                        }))
                      }
                      value={settings.organization.name}
                    />
                  </FormField>
                  <FormField label="Identyfikator przestrzeni">
                    <input value={settings.organization.slug} disabled />
                  </FormField>
                  <FormField label="Strefa czasowa">
                    <select
                      disabled={loading}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          organization: {
                            ...current.organization,
                            timezone: event.target.value,
                          },
                        }))
                      }
                      value={settings.organization.timezone}
                    >
                      <option value="Europe/Warsaw">Europe/Warsaw (UTC+2)</option>
                      <option value="UTC">UTC</option>
                    </select>
                  </FormField>
                  <FormField label="Język">
                    <select
                      disabled={loading}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          organization: {
                            ...current.organization,
                            locale: event.target.value,
                          },
                        }))
                      }
                      value={settings.organization.locale}
                    >
                      <option value="pl">Polski</option>
                      <option value="en">English</option>
                    </select>
                  </FormField>
                </div>
              </div>
            </>
          ) : null}

          {section === "processing" ? (
            <>
              <div className="workspace-panel__header">
                <div>
                  <h2>Przetwarzanie wiadomości</h2>
                  <p>Domyślne progi, kolejki i zachowanie silnika reguł.</p>
                </div>
              </div>
              <div className="settings-list">
                <div>
                  <span>
                    <strong>Automatyczna klasyfikacja</strong>
                    <small>Uruchamiaj aktywne reguły po odebraniu wiadomości.</small>
                  </span>
                  <Toggle
                    checked={settings.processing.autoClassification}
                    label="Automatyczna klasyfikacja"
                    onChange={(autoClassification) =>
                      setSettings((current) => ({
                        ...current,
                        processing: {
                          ...current.processing,
                          autoClassification,
                        },
                      }))
                    }
                  />
                </div>
                <div>
                  <span>
                    <strong>Wstrzymaj akcje przy niepewnym wyniku</strong>
                    <small>Wynik niższy od progu trafia do ręcznej weryfikacji.</small>
                  </span>
                  <Toggle
                    checked={settings.processing.holdUncertainActions}
                    label="Wstrzymuj niepewne akcje"
                    onChange={(holdUncertainActions) =>
                      setSettings((current) => ({
                        ...current,
                        processing: {
                          ...current.processing,
                          holdUncertainActions,
                        },
                      }))
                    }
                  />
                </div>
                <div>
                  <span>
                    <strong>Analiza załączników</strong>
                    <small>Ekstrakcja PDF, DOCX, XLSX i OCR obrazów.</small>
                  </span>
                  <Toggle
                    checked={settings.processing.analyzeAttachments}
                    label="Analizuj załączniki"
                    onChange={(analyzeAttachments) =>
                      setSettings((current) => ({
                        ...current,
                        processing: {
                          ...current.processing,
                          analyzeAttachments,
                        },
                      }))
                    }
                  />
                </div>
              </div>
              <div className="form-grid form-grid--two settings-grid">
                <FormField label="Próg automatycznej akcji">
                  <input
                    max="100"
                    min="0"
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        processing: {
                          ...current.processing,
                          actionThreshold: Number(event.target.value),
                        },
                      }))
                    }
                    type="number"
                    value={settings.processing.actionThreshold}
                  />
                </FormField>
                <FormField label="Maksymalna liczba prób">
                  <input
                    max="10"
                    min="1"
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        processing: {
                          ...current.processing,
                          maxAttempts: Number(event.target.value),
                        },
                      }))
                    }
                    type="number"
                    value={settings.processing.maxAttempts}
                  />
                </FormField>
                <FormField label="Timeout pojedynczego zadania">
                  <select
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        processing: {
                          ...current.processing,
                          taskTimeoutSeconds: Number(event.target.value),
                        },
                      }))
                    }
                    value={settings.processing.taskTimeoutSeconds}
                  >
                    <option value="30">30 sekund</option>
                    <option value="60">60 sekund</option>
                    <option value="90">90 sekund</option>
                    <option value="180">180 sekund</option>
                  </select>
                </FormField>
                <FormField label="Limit równoległych procesów">
                  <input
                    max="100"
                    min="1"
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        processing: {
                          ...current.processing,
                          concurrencyLimit: Number(event.target.value),
                        },
                      }))
                    }
                    type="number"
                    value={settings.processing.concurrencyLimit}
                  />
                </FormField>
              </div>
            </>
          ) : null}

          {section === "security" ? (
            <>
              <div className="workspace-panel__header">
                <div>
                  <h2>Bezpieczeństwo</h2>
                  <p>Logowanie, sesje, MFA i szyfrowanie sekretów.</p>
                </div>
              </div>
              <div className="security-overview">
                <div>
                  <ShieldCheck size={22} />
                  <span>
                    <strong>Stan zabezpieczeń: wysoki</strong>
                    <small>Wszystkie krytyczne mechanizmy są aktywne.</small>
                  </span>
                  <CheckCircle2 size={18} />
                </div>
              </div>
              <div className="settings-list">
                <div>
                  <span>
                    <strong>Wymagaj 2FA od administratorów</strong>
                    <small>Brak 2FA zablokuje dostęp do ustawień i kont SMTP.</small>
                  </span>
                  <Toggle
                    checked={settings.security.requireAdminMfa}
                    label="Wymagaj 2FA"
                    onChange={(requireAdminMfa) =>
                      setSettings((current) => ({
                        ...current,
                        security: {
                          ...current.security,
                          requireAdminMfa,
                        },
                      }))
                    }
                  />
                </div>
                <div>
                  <span>
                    <strong>Automatyczne wygaszanie sesji</strong>
                    <small>Wyloguj po 8 godzinach lub 30 minutach bezczynności.</small>
                  </span>
                  <Toggle
                    checked={settings.security.expireSessions}
                    label="Wygaszanie sesji"
                    onChange={(expireSessions) =>
                      setSettings((current) => ({
                        ...current,
                        security: {
                          ...current.security,
                          expireSessions,
                        },
                      }))
                    }
                  />
                </div>
                <div>
                  <span>
                    <strong>Ograniczenie dozwolonych domen</strong>
                    <small>Zaproszenia tylko dla wskazanych domen firmowych.</small>
                  </span>
                  <Toggle
                    checked={settings.security.restrictInviteDomains}
                    label="Ogranicz domeny"
                    onChange={(restrictInviteDomains) =>
                      setSettings((current) => ({
                        ...current,
                        security: {
                          ...current.security,
                          restrictInviteDomains,
                        },
                      }))
                    }
                  />
                </div>
              </div>
              <div className="form-grid form-grid--two settings-grid">
                <FormField label="Czas sesji">
                  <select
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        security: {
                          ...current.security,
                          sessionDuration: event.target.value,
                        },
                      }))
                    }
                    value={settings.security.sessionDuration}
                  >
                    <option value="4h">4 godziny</option>
                    <option value="8h">8 godzin</option>
                    <option value="24h">24 godziny</option>
                  </select>
                </FormField>
                <FormField label="Rotacja kluczy sekretów">
                  <select
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        security: {
                          ...current.security,
                          secretRotationDays: event.target.value,
                        },
                      }))
                    }
                    value={settings.security.secretRotationDays}
                  >
                    <option value="30">Co 30 dni</option>
                    <option value="90">Co 90 dni</option>
                    <option value="manual">Ręcznie</option>
                  </select>
                </FormField>
              </div>
            </>
          ) : null}

          {section === "notifications" ? (
            <>
              <div className="workspace-panel__header">
                <div>
                  <h2>Powiadomienia</h2>
                  <p>Wybierz zdarzenia i kanały kontaktu z zespołem.</p>
                </div>
              </div>
              <div className="notification-table">
                <div className="notification-table__header">
                  <span>Zdarzenie</span>
                  <span>E-mail</span>
                  <span>Panel</span>
                  <span>Webhook</span>
                </div>
                {notificationEvents.map((label) => (
                  <div key={label}>
                    <strong>{label}</strong>
                    <Toggle
                      checked={settings.notifications[label].email}
                      label={`${label} e-mail`}
                      onChange={(email) =>
                        setSettings((current) => ({
                          ...current,
                          notifications: {
                            ...current.notifications,
                            [label]: {
                              ...current.notifications[label],
                              email,
                            },
                          },
                        }))
                      }
                    />
                    <Toggle
                      checked={settings.notifications[label].panel}
                      label={`${label} panel`}
                      onChange={(panel) =>
                        setSettings((current) => ({
                          ...current,
                          notifications: {
                            ...current.notifications,
                            [label]: {
                              ...current.notifications[label],
                              panel,
                            },
                          },
                        }))
                      }
                    />
                    <Toggle
                      checked={settings.notifications[label].webhook}
                      label={`${label} webhook`}
                      onChange={(webhook) =>
                        setSettings((current) => ({
                          ...current,
                          notifications: {
                            ...current.notifications,
                            [label]: {
                              ...current.notifications[label],
                              webhook,
                            },
                          },
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {section === "api" ? (
            <>
              <div className="workspace-panel__header">
                <div>
                  <h2>API i webhooki</h2>
                  <p>Klucze programistyczne, limity, zakresy i historia wywołań.</p>
                </div>
                <Button
                  icon={KeyRound}
                  onClick={() => navigate("/developers")}
                  variant="primary"
                >
                  Zarządzaj API
                </Button>
              </div>
              <div className="settings-api-callout">
                <KeyRound size={24} />
                <span>
                  <strong>Dedykowane centrum integracji</strong>
                  <small>
                    Generuj klucze wyświetlane tylko raz, nadawaj minimalne
                    zakresy, ustawiaj allowlistę IP i analizuj każde wywołanie.
                  </small>
                </span>
                <Button onClick={() => navigate("/developers")}>
                  Otwórz centrum API
                </Button>
              </div>
            </>
          ) : null}

          {section === "retention" ? (
            <>
              <div className="workspace-panel__header">
                <div>
                  <h2>Dane i retencja</h2>
                  <p>Okres przechowywania wiadomości i polityka usuwania danych.</p>
                </div>
              </div>
              <div className="form-grid form-grid--two settings-grid">
                <FormField label="Treść wiadomości">
                  <select
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        retention: {
                          ...current.retention,
                          messageDays: event.target.value,
                        },
                      }))
                    }
                    value={settings.retention.messageDays}
                  >
                    <option value="90">90 dni</option>
                    <option value="180">180 dni</option>
                    <option value="365">365 dni</option>
                    <option value="forever">Bezterminowo</option>
                  </select>
                </FormField>
                <FormField label="Załączniki">
                  <select
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        retention: {
                          ...current.retention,
                          attachmentDays: event.target.value,
                        },
                      }))
                    }
                    value={settings.retention.attachmentDays}
                  >
                    <option value="30">30 dni</option>
                    <option value="90">90 dni</option>
                    <option value="180">180 dni</option>
                  </select>
                </FormField>
                <FormField label="Dziennik audytu">
                  <select
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        retention: {
                          ...current.retention,
                          auditDays: event.target.value,
                        },
                      }))
                    }
                    value={settings.retention.auditDays}
                  >
                    <option value="365">365 dni</option>
                    <option value="730">730 dni</option>
                    <option value="forever">Bezterminowo</option>
                  </select>
                </FormField>
                <FormField label="Dane analityczne">
                  <select
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        retention: {
                          ...current.retention,
                          analyticsDays: event.target.value,
                        },
                      }))
                    }
                    value={settings.retention.analyticsDays}
                  >
                    <option value="365">365 dni</option>
                    <option value="730">730 dni</option>
                    <option value="forever">Bezterminowo</option>
                  </select>
                </FormField>
              </div>
              <div className="retention-note">
                <Database size={18} />
                <span>
                  <strong>Anonimizacja przed usunięciem</strong>
                  <small>
                    Agregaty raportowe zostaną zachowane bez danych osobowych i
                    treści wiadomości.
                  </small>
                </span>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </>
  );
}
