import { useMemo, useState } from "react";
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Code2,
  FileSearch,
  Globe2,
  Inbox,
  KeyRound,
  Mail,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Webhook,
} from "lucide-react";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { FormField } from "../components/ui/FormField";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { Toggle } from "../components/ui/Toggle";
import { useAppState } from "../lib/AppState";
import { formatDateTime, formatNumber } from "../lib/format";
import type { SourceType } from "../types";

const sourceTypeInfo: Record<
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

export function SourcesPage() {
  const { sources, toggleSource, addToast } = useAppState();
  const [addOpen, setAddOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<SourceType>("imap");
  const [expandedSource, setExpandedSource] = useState<string | null>(
    sources[0]?.id ?? null,
  );

  const summary = useMemo(
    () => ({
      active: sources.filter((source) => source.status === "active").length,
      unread: sources.reduce((sum, source) => sum + source.unread, 0),
      total: sources.reduce((sum, source) => sum + source.total, 0),
      warnings: sources.filter((source) => source.status === "warning").length,
    }),
    [sources],
  );

  const testConnection = (label: string) => {
    addToast({
      title: "Połączenie poprawne",
      message: `${label} odpowiedział prawidłowo. Uwierzytelnienie i TLS są aktywne.`,
      tone: "success",
    });
  };

  return (
    <>
      <PageHeader
        actions={
          <Button icon={Plus} onClick={() => setAddOpen(true)} variant="primary">
            Dodaj źródło
          </Button>
        }
        description="Skrzynki, webhooki, formularze oraz strony monitorowane przez scraper."
        title="Źródła i scraping"
      />

      <section className="summary-strip">
        <div>
          <Activity size={18} />
          <span>Aktywne źródła</span>
          <strong>{summary.active}</strong>
        </div>
        <div>
          <Inbox size={18} />
          <span>Nowe elementy</span>
          <strong>{formatNumber(summary.unread)}</strong>
        </div>
        <div>
          <FileSearch size={18} />
          <span>Łącznie przetworzono</span>
          <strong>{formatNumber(summary.total)}</strong>
        </div>
        <div>
          <Clock3 size={18} />
          <span>Wymagają uwagi</span>
          <strong>{summary.warnings}</strong>
        </div>
      </section>

      <div className="sources-layout">
        <section className="workspace-panel">
          <div className="workspace-panel__header">
            <div>
              <h2>Połączone kanały</h2>
              <p>Każde źródło ma własny harmonogram, foldery i reguły wejściowe.</p>
            </div>
            <Button icon={RefreshCw} size="sm">
              Sprawdź wszystkie
            </Button>
          </div>

          <div className="connector-list">
            {sources.map((source) => {
              const info = sourceTypeInfo[source.type];
              const Icon = info.icon;
              const expanded = expandedSource === source.id;
              return (
                <article
                  className={`connector-row ${expanded ? "connector-row--expanded" : ""}`}
                  key={source.id}
                >
                  <button
                    className="connector-row__summary"
                    onClick={() =>
                      setExpandedSource(expanded ? null : source.id)
                    }
                    type="button"
                  >
                    <span className={`connector-icon connector-icon--${source.type}`}>
                      <Icon size={21} />
                    </span>
                    <span className="connector-row__identity">
                      <strong>{source.name}</strong>
                      <small>{source.address}</small>
                    </span>
                    <span className="connector-row__type">
                      <strong>{info.label}</strong>
                      <small>co {source.syncIntervalMinutes} min</small>
                    </span>
                    <span className="connector-row__stats">
                      <strong>{formatNumber(source.unread)}</strong>
                      <small>nowych</small>
                    </span>
                    <span className="connector-row__stats">
                      <strong>{formatNumber(source.total)}</strong>
                      <small>łącznie</small>
                    </span>
                    <span className="connector-row__sync">
                      <Badge
                        dot
                        tone={
                          source.status === "active"
                            ? "success"
                            : source.status === "warning"
                              ? "warning"
                              : source.status === "error"
                                ? "danger"
                                : "neutral"
                        }
                      >
                        {source.status === "active"
                          ? "Aktywne"
                          : source.status === "warning"
                            ? "Ostrzeżenie"
                            : source.status === "paused"
                              ? "Wstrzymane"
                              : "Błąd"}
                      </Badge>
                      <small>{formatDateTime(source.lastSyncAt)}</small>
                    </span>
                    <ChevronRight
                      className="connector-row__chevron"
                      size={18}
                    />
                  </button>

                  {expanded ? (
                    <div className="connector-row__details">
                      <div className="connector-detail-grid">
                        <div>
                          <span>Foldery synchronizowane</span>
                          <div className="tag-list">
                            {source.folders.map((folder) => (
                              <Badge key={folder} tone="neutral">
                                {folder}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div>
                          <span>Bezpieczeństwo</span>
                          <strong>
                            <ShieldCheck size={16} /> TLS 1.3 / dane zaszyfrowane
                          </strong>
                        </div>
                        <div>
                          <span>Następna synchronizacja</span>
                          <strong>
                            <CalendarClock size={16} /> za {source.nextSyncSeconds} s
                          </strong>
                        </div>
                      </div>
                      <div className="connector-row__actions">
                        <Button
                          icon={source.status === "paused" ? Play : Pause}
                          onClick={() => toggleSource(source.id)}
                          size="sm"
                        >
                          {source.status === "paused" ? "Wznów" : "Wstrzymaj"}
                        </Button>
                        <Button
                          icon={CheckCircle2}
                          onClick={() => testConnection(source.name)}
                          size="sm"
                        >
                          Test połączenia
                        </Button>
                        <Button icon={MoreHorizontal} size="sm">
                          Konfiguruj
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>

        <aside className="sources-rail">
          <section className="panel">
            <div className="panel__header">
              <div>
                <h2>Harmonogram pobierania</h2>
                <p>Zadania cykliczne działają w tle.</p>
              </div>
            </div>
            <div className="schedule-list">
              {[
                ["Skrzynki e-mail", "co 5 min", "12:30"],
                ["Scraping stron", "co 15 min", "12:30"],
                ["Ponowienia błędów", "co 30 min", "12:45"],
                ["Czyszczenie archiwum", "codziennie", "02:00"],
              ].map(([label, schedule, next]) => (
                <div key={label}>
                  <span className="schedule-list__icon">
                    <Clock3 size={16} />
                  </span>
                  <span>
                    <strong>{label}</strong>
                    <small>{schedule}</small>
                  </span>
                  <time>{next}</time>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel__header">
              <div>
                <h2>Endpoint odbiorczy</h2>
                <p>Uniwersalny webhook dla integracji.</p>
              </div>
            </div>
            <div className="endpoint-box">
              <code>POST /api/v1/ingest/messages</code>
              <button aria-label="Skopiuj endpoint" type="button">
                <Code2 size={16} />
              </button>
            </div>
            <div className="endpoint-meta">
              <div>
                <KeyRound size={15} />
                <span>
                  <strong>Klucz podpisu</strong>
                  <small>Wymagany HMAC SHA-256</small>
                </span>
              </div>
              <Toggle
                checked
                label="Włącz weryfikację podpisu"
                onChange={() => undefined}
              />
            </div>
          </section>
        </aside>
      </div>

      <Modal
        description="Wybierz typ źródła i skonfiguruj sposób pobierania danych."
        footer={
          <>
            <Button onClick={() => setAddOpen(false)}>Anuluj</Button>
            <Button
              icon={CheckCircle2}
              onClick={() => {
                setAddOpen(false);
                addToast({
                  title: "Konfiguracja zapisana",
                  message:
                    "Źródło zostało utworzone w trybie roboczym. Uruchom test przed aktywacją.",
                  tone: "success",
                });
              }}
              variant="primary"
            >
              Zapisz i przetestuj
            </Button>
          </>
        }
        onClose={() => setAddOpen(false)}
        open={addOpen}
        size="lg"
        title="Nowe źródło danych"
      >
        <div className="source-type-grid">
          {(Object.entries(sourceTypeInfo) as Array<
            [SourceType, (typeof sourceTypeInfo)[SourceType]]
          >).map(([key, info]) => {
            const Icon = info.icon;
            return (
              <button
                className={selectedType === key ? "is-selected" : ""}
                key={key}
                onClick={() => setSelectedType(key)}
                type="button"
              >
                <Icon size={21} />
                <strong>{info.label}</strong>
                <span>{info.description}</span>
              </button>
            );
          })}
        </div>

        <div className="form-grid form-grid--two">
          <FormField label="Nazwa połączenia">
            <input placeholder="np. Skrzynka działu sprzedaży" />
          </FormField>
          <FormField
            hint="Adres lub identyfikator będzie widoczny na liście źródeł."
            label={selectedType === "scraper" ? "Adres strony" : "Adres e-mail"}
          >
            <input
              placeholder={
                selectedType === "scraper"
                  ? "https://example.com/aktualnosci"
                  : "biuro@example.com"
              }
              type={selectedType === "scraper" ? "url" : "email"}
            />
          </FormField>
          {selectedType === "imap" ? (
            <>
              <FormField label="Serwer IMAP">
                <input placeholder="imap.example.com" />
              </FormField>
              <FormField label="Port i szyfrowanie">
                <div className="field-row">
                  <input defaultValue="993" type="number" />
                  <select defaultValue="tls">
                    <option value="tls">TLS</option>
                    <option value="starttls">STARTTLS</option>
                  </select>
                </div>
              </FormField>
              <FormField label="Login">
                <input placeholder="biuro@example.com" />
              </FormField>
              <FormField label="Hasło aplikacji">
                <input placeholder="••••••••••••••••" type="password" />
              </FormField>
            </>
          ) : null}
          {selectedType === "scraper" ? (
            <>
              <FormField label="Częstotliwość">
                <select defaultValue="15">
                  <option value="5">Co 5 minut</option>
                  <option value="15">Co 15 minut</option>
                  <option value="60">Co godzinę</option>
                  <option value="1440">Raz dziennie</option>
                </select>
              </FormField>
              <FormField label="Tryb ekstrakcji">
                <select defaultValue="content">
                  <option value="content">Główna treść strony</option>
                  <option value="selector">Selektor CSS</option>
                  <option value="rss">Kanał RSS/Atom</option>
                  <option value="sitemap">Mapa witryny</option>
                </select>
              </FormField>
              <FormField label="Selektor CSS (opcjonalnie)">
                <input placeholder="main .article-list" />
              </FormField>
              <FormField label="Nagłówek User-Agent">
                <input defaultValue="MailFlowBot/1.0" />
              </FormField>
            </>
          ) : null}
        </div>
      </Modal>
    </>
  );
}

