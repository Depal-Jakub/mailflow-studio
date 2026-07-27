import { useMemo, useState } from "react";
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Code2,
  FileSearch,
  Inbox,
  KeyRound,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  SourceWizard,
  sourceTypeInfo,
} from "../components/sources/SourceWizard";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { Toggle } from "../components/ui/Toggle";
import { useAppState } from "../lib/AppState";
import { formatDateTime, formatNumber } from "../lib/format";
import { api } from "../services/api";
import { demoMode } from "../services/supabase";
import type { SourceValidation } from "../lib/connectors";
import type { SourceConnector } from "../types";

export function SourcesPage() {
  const {
    sources,
    activeOrganizationId,
    toggleSource,
    addSource,
    updateSource,
    removeSource,
    addToast,
  } = useAppState();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<SourceConnector | null>(
    null,
  );
  const [removeCandidate, setRemoveCandidate] =
    useState<SourceConnector | null>(null);
  const [expandedSource, setExpandedSource] = useState<string | null>(
    sources[0]?.id ?? null,
  );
  const [signatureRequired, setSignatureRequired] = useState(true);
  const [checkingAll, setCheckingAll] = useState(false);

  const summary = useMemo(
    () => ({
      active: sources.filter((source) => source.status === "active").length,
      unread: sources.reduce((sum, source) => sum + source.unread, 0),
      total: sources.reduce((sum, source) => sum + source.total, 0),
      warnings: sources.filter((source) =>
        ["warning", "error"].includes(source.status),
      ).length,
    }),
    [sources],
  );

  const openCreate = () => {
    setEditingSource(null);
    setWizardOpen(true);
  };

  const openEdit = (source: SourceConnector) => {
    setEditingSource(source);
    setWizardOpen(true);
  };

  const testConnection = async (source: SourceConnector) => {
    const result = demoMode
      ? {
          valid: Boolean(
            source.credentialsConfigured || source.type === "scraper",
          ),
          errors: {},
          checks: [],
        }
      : await api.post<SourceValidation>(
          `sources/${source.id}/test`,
          {},
          activeOrganizationId,
        );
    updateSource(source.id, {
      status: result.valid ? "active" : "error",
      lastTestAt: new Date().toISOString(),
      lastError: result.valid
        ? null
        : result.errors.connection ?? "Test połączenia nie powiódł się.",
    });
    addToast({
      title: result.valid ? "Połączenie poprawne" : "Połączenie wymaga uwagi",
      message: result.valid
        ? `${source.name}: uwierzytelnienie, konfiguracja i harmonogram są gotowe.`
        : result.errors.connection ?? "Dostawca odrzucił konfigurację.",
      tone: result.valid ? "success" : "error",
    });
  };

  const checkAll = async () => {
    setCheckingAll(true);
    for (const source of sources) {
      await testConnection(source);
    }
    setCheckingAll(false);
    addToast({
      title: "Kontrola źródeł zakończona",
      message: `Sprawdzono ${sources.length} źródeł i odświeżono ich kondycję.`,
      tone: "success",
    });
  };

  const toggleConnection = async (source: SourceConnector) => {
    const status = source.status === "paused" ? "active" : "paused";
    if (!demoMode) {
      await api.patch(
        `sources/${source.id}`,
        { status },
        activeOrganizationId,
      );
    }
    toggleSource(source.id);
  };

  const syncNow = async (source: SourceConnector) => {
    if (!demoMode) {
      await api.post(
        `sources/${source.id}/sync`,
        {},
        activeOrganizationId,
      );
    }
    updateSource(source.id, {
      status: "active",
      lastSyncAt: new Date().toISOString(),
      nextSyncSeconds: source.syncIntervalMinutes * 60,
      lastError: null,
    });
    addToast({
      title: "Synchronizacja dodana do kolejki",
      message: `${source.name} zostanie podjęte przez najbliższy przebieg workera.`,
      tone: "success",
    });
  };

  const confirmRemove = async () => {
    if (!removeCandidate) return;
    if (!demoMode) {
      await api.delete(
        `sources/${removeCandidate.id}`,
        activeOrganizationId,
      );
    }
    removeSource(removeCandidate.id);
    addToast({
      title: "Źródło usunięte",
      message: `${removeCandidate.name} nie będzie już synchronizowane.`,
      tone: "warning",
    });
    setRemoveCandidate(null);
  };

  const endpoint = `${window.location.origin}/hooks/SOURCE_ID`;

  return (
    <>
      <PageHeader
        actions={
          <Button icon={Plus} onClick={openCreate} variant="primary">
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
            <Button
              icon={RefreshCw}
              loading={checkingAll}
              onClick={() => void checkAll()}
              size="sm"
            >
              Sprawdź wszystkie
            </Button>
          </div>

          {sources.length > 0 ? (
            <div className="connector-list">
              {sources.map((source) => {
                const info = sourceTypeInfo[source.type];
                const Icon = info.icon;
                const expanded = expandedSource === source.id;
                return (
                  <article
                    className={`connector-row ${
                      expanded ? "connector-row--expanded" : ""
                    }`}
                    key={source.id}
                  >
                    <button
                      className="connector-row__summary"
                      onClick={() =>
                        setExpandedSource(expanded ? null : source.id)
                      }
                      type="button"
                    >
                      <span
                        className={`connector-icon connector-icon--${source.type}`}
                      >
                        <Icon size={21} />
                      </span>
                      <span className="connector-row__identity">
                        <strong>{source.name}</strong>
                        <small>{source.address}</small>
                      </span>
                      <span className="connector-row__type">
                        <strong>{info.label}</strong>
                        <small>
                          {source.type === "webhook"
                            ? "zdarzeniowo"
                            : `co ${source.syncIntervalMinutes} min`}
                        </small>
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
                            <span>
                              {source.type === "scraper"
                                ? "Tryb ekstrakcji"
                                : source.type === "webhook"
                                  ? "Tryb odbioru"
                                  : "Foldery synchronizowane"}
                            </span>
                            <div className="tag-list">
                              {(source.folders.length
                                ? source.folders
                                : [
                                    source.type === "webhook"
                                      ? "HMAC SHA-256"
                                      : String(
                                          source.publicConfig
                                            ?.extraction_mode ?? "content",
                                        ),
                                  ]
                              ).map((folder) => (
                                <Badge key={folder} tone="neutral">
                                  {folder}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <div>
                            <span>Bezpieczeństwo</span>
                            <strong>
                              <ShieldCheck size={16} />
                              {source.credentialsConfigured
                                ? "Sekrety zaszyfrowane"
                                : "Brak poświadczeń"}
                            </strong>
                          </div>
                          <div>
                            <span>Następna synchronizacja</span>
                            <strong>
                              <CalendarClock size={16} />
                              {source.type === "webhook"
                                ? "oczekuje na zdarzenie"
                                : `za ${source.nextSyncSeconds} s`}
                            </strong>
                          </div>
                          <div>
                            <span>Ostatni test</span>
                            <strong>
                              <CheckCircle2 size={16} />
                              {source.lastTestAt
                                ? formatDateTime(source.lastTestAt)
                                : "jeszcze nie wykonano"}
                            </strong>
                          </div>
                        </div>
                        {source.lastError ? (
                          <div className="connector-inline-error">
                            {source.lastError}
                          </div>
                        ) : null}
                        <div className="connector-row__actions">
                          <Button
                            icon={source.status === "paused" ? Play : Pause}
                            onClick={() => void toggleConnection(source)}
                            size="sm"
                          >
                            {source.status === "paused" ? "Wznów" : "Wstrzymaj"}
                          </Button>
                          <Button
                            icon={CheckCircle2}
                            onClick={() => void testConnection(source)}
                            size="sm"
                          >
                            Test połączenia
                          </Button>
                          {source.type !== "webhook" ? (
                            <Button
                              icon={RefreshCw}
                              onClick={() => void syncNow(source)}
                              size="sm"
                            >
                              Synchronizuj teraz
                            </Button>
                          ) : null}
                          <Button
                            icon={Settings2}
                            onClick={() => openEdit(source)}
                            size="sm"
                          >
                            Konfiguruj
                          </Button>
                          <Button
                            icon={Trash2}
                            onClick={() => setRemoveCandidate(source)}
                            size="sm"
                            variant="ghost"
                          >
                            Usuń
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-workspace">
              <FileSearch size={28} />
              <h3>Ta organizacja nie ma jeszcze źródeł</h3>
              <p>Dodaj skrzynkę, webhook lub monitorowaną stronę.</p>
              <Button icon={Plus} onClick={openCreate} variant="primary">
                Dodaj pierwsze źródło
              </Button>
            </div>
          )}
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
                ["Skrzynki e-mail", "co 5 min", "kolejny cykl"],
                ["Scraping stron", "co 15 min", "kolejny cykl"],
                ["Ponowienia błędów", "wykładniczo", "maks. 5 prób"],
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
                <p>Każdy webhook otrzymuje osobny adres i sekret.</p>
              </div>
            </div>
            <div className="endpoint-box">
              <code>{endpoint}</code>
              <button
                aria-label="Skopiuj endpoint"
                onClick={() => {
                  void navigator.clipboard.writeText(endpoint);
                  addToast({
                    title: "Endpoint skopiowany",
                    message: "Adres jest gotowy do wklejenia w systemie źródłowym.",
                    tone: "info",
                  });
                }}
                type="button"
              >
                <Code2 size={16} />
              </button>
            </div>
            <div className="endpoint-meta">
              <div>
                <KeyRound size={15} />
                <span>
                  <strong>Podpis per źródło</strong>
                  <small>HMAC SHA-256 i deduplikacja externalId</small>
                </span>
              </div>
              <Toggle
                checked={signatureRequired}
                label="Włącz weryfikację podpisu"
                onChange={setSignatureRequired}
              />
            </div>
          </section>
        </aside>
      </div>

      {wizardOpen ? (
        <SourceWizard
          addToast={addToast}
          key={editingSource?.id ?? "new-source"}
          onClose={() => setWizardOpen(false)}
          onSaved={addSource}
          onUpdated={updateSource}
          open
          organizationId={activeOrganizationId}
          source={editingSource}
        />
      ) : null}

      <Modal
        description="Wiadomości już pobrane pozostaną w bazie, ale automatyczna synchronizacja zostanie zatrzymana."
        footer={
          <>
            <Button onClick={() => setRemoveCandidate(null)}>Anuluj</Button>
            <Button
              icon={Trash2}
              onClick={() => void confirmRemove()}
              variant="danger"
            >
              Usuń źródło
            </Button>
          </>
        }
        onClose={() => setRemoveCandidate(null)}
        open={Boolean(removeCandidate)}
        size="sm"
        title="Usunąć źródło?"
      >
        <p>
          Usuwasz <strong>{removeCandidate?.name}</strong>. Tej operacji nie
          można cofnąć w trybie produkcyjnym.
        </p>
      </Modal>
    </>
  );
}
