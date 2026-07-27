import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Archive,
  ArrowRight,
  Bell,
  Bot,
  CheckCircle2,
  Clock3,
  FileCheck2,
  GitBranch,
  Mail,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Tag,
  Trash2,
  Webhook,
} from "lucide-react";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { Toggle } from "../components/ui/Toggle";
import { useAppState } from "../lib/AppState";
import { formatDateTime, formatNumber, formatPercent } from "../lib/format";
import type { Automation } from "../types";

type TriggerType =
  | "message_ingested"
  | "message_classified"
  | "schedule"
  | "manual";

type StepType =
  | "set_category"
  | "set_score"
  | "add_score"
  | "add_tag"
  | "set_review"
  | "archive"
  | "send_webhook"
  | "send_email"
  | "create_task"
  | "notify_team"
  | "delay"
  | "stop";

interface DraftStep {
  id: string;
  type: StepType;
  config: Record<string, string | number | boolean>;
}

interface AutomationDraft {
  id: string | null;
  name: string;
  description: string;
  triggerType: TriggerType;
  triggerConfig: Record<string, string | number | boolean>;
  nextRunAt: string;
  active: boolean;
  steps: DraftStep[];
}

const triggerLabels: Record<TriggerType, string> = {
  message_ingested: "Po odebraniu nowej wiadomości",
  message_classified: "Po sklasyfikowaniu wiadomości",
  schedule: "Według harmonogramu",
  manual: "Ręcznie lub przez API",
};

const stepOptions: Array<{
  type: StepType;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    type: "set_category",
    label: "Ustaw kategorię",
    description: "Przypisz wiadomość do wybranej kategorii.",
    icon: Sparkles,
  },
  {
    type: "set_score",
    label: "Ustaw ocenę",
    description: "Zastąp aktualny wynik wartością od -100 do 100.",
    icon: Activity,
  },
  {
    type: "add_score",
    label: "Zmień ocenę",
    description: "Dodaj lub odejmij punkty od aktualnego wyniku.",
    icon: Activity,
  },
  {
    type: "add_tag",
    label: "Dodaj tag",
    description: "Oznacz wiadomość etykietą operacyjną.",
    icon: Tag,
  },
  {
    type: "set_review",
    label: "Skieruj do weryfikacji",
    description: "Zatrzymaj wiadomość w kolejce operatora.",
    icon: FileCheck2,
  },
  {
    type: "archive",
    label: "Archiwizuj",
    description: "Zmień status wiadomości na zarchiwizowaną.",
    icon: Archive,
  },
  {
    type: "send_webhook",
    label: "Wyślij webhook",
    description: "Przekaż podpisane dane do dozwolonego hosta HTTPS.",
    icon: Webhook,
  },
  {
    type: "send_email",
    label: "Przekaż e-mail",
    description: "Wyślij treść źródłowej wiadomości na wskazany adres.",
    icon: Mail,
  },
  {
    type: "create_task",
    label: "Utwórz zadanie",
    description: "Dodaj zadanie operacyjne z terminem i priorytetem.",
    icon: CheckCircle2,
  },
  {
    type: "notify_team",
    label: "Powiadom zespół",
    description: "Utwórz powiadomienie dla członków organizacji.",
    icon: Bell,
  },
  {
    type: "delay",
    label: "Poczekaj",
    description: "Wstrzymaj przepływ i wznow go po określonym czasie.",
    icon: Clock3,
  },
  {
    type: "stop",
    label: "Zakończ przepływ",
    description: "Zatrzymaj wykonywanie kolejnych kroków.",
    icon: CheckCircle2,
  },
];

const stepMeta = (type: StepType) =>
  stepOptions.find((option) => option.type === type) ?? stepOptions[0];

const newStep = (type: StepType = "notify_team"): DraftStep => ({
  id: crypto.randomUUID(),
  type,
  config:
    type === "notify_team"
      ? { title: "Nowa wiadomość wymaga uwagi", severity: "info" }
      : {},
});

const emptyDraft = (): AutomationDraft => ({
  id: null,
  name: "",
  description: "",
  triggerType: "message_classified",
  triggerConfig: { minimum_score: 0 },
  nextRunAt: "",
  active: false,
  steps: [newStep()],
});

const asConfig = (value: unknown): Record<string, string | number | boolean> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) =>
      ["string", "number", "boolean"].includes(typeof item),
    ),
  ) as Record<string, string | number | boolean>;
};

const toLocalDateTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const draftFromAutomation = (automation: Automation): AutomationDraft => {
  const definitions = automation.stepDefinitions ?? [];
  return {
    id: automation.id,
    name: automation.name,
    description: automation.description ?? "",
    triggerType:
      (automation.triggerType as TriggerType | undefined) ?? "manual",
    triggerConfig: asConfig(automation.triggerConfig),
    nextRunAt: toLocalDateTime(automation.nextRunAt),
    active: automation.active,
    steps:
      definitions.length > 0
        ? definitions.map((definition) => ({
            id: crypto.randomUUID(),
            type: String(definition.type ?? "notify_team") as StepType,
            config: asConfig(definition.config),
          }))
        : automation.steps.map((label) => ({
            ...newStep("notify_team"),
            config: { title: label, severity: "info" },
          })),
  };
};

const stepSummary = (step: DraftStep) => {
  const meta = stepMeta(step.type);
  if (step.type === "set_category") {
    return String(step.config.category_name ?? meta.label);
  }
  if (step.type === "send_webhook") {
    return String(step.config.url ?? meta.label);
  }
  if (step.type === "send_email") {
    return String(step.config.to ?? meta.label);
  }
  if (step.type === "delay") {
    return `${step.config.minutes ?? 5} min`;
  }
  if (step.type === "add_tag") {
    return String(step.config.tag ?? meta.label);
  }
  return meta.label;
};

export function AutomationsPage() {
  const {
    automations,
    categories,
    deliveryAccounts,
    toggleAutomation,
    addAutomation,
    updateAutomation,
    removeAutomation,
    runAutomation,
    addToast,
  } = useAppState();
  const [builderOpen, setBuilderOpen] = useState(false);
  const [draft, setDraft] = useState<AutomationDraft>(emptyDraft);
  const [deleteTarget, setDeleteTarget] = useState<Automation | null>(null);
  const [selectedAutomationId, setSelectedAutomationId] = useState(
    automations[0]?.id ?? "",
  );
  const [statusFilter, setStatusFilter] = useState("all");

  const visibleAutomations = useMemo(
    () =>
      automations.filter((automation) => {
        if (statusFilter === "active") return automation.active;
        if (statusFilter === "paused") return !automation.active;
        return true;
      }),
    [automations, statusFilter],
  );
  const selectedAutomation =
    automations.find((item) => item.id === selectedAutomationId) ??
    automations[0];
  const averageSuccessRate = automations.length
    ? automations.reduce((sum, item) => sum + item.successRate, 0) /
      automations.length
    : 0;
  const queuedRuns = automations.reduce(
    (total, automation) =>
      total +
      (automation.recentRuns ?? []).filter((run) =>
        ["pending", "processing"].includes(String(run.status)),
      ).length,
    0,
  );

  const openCreate = () => {
    setDraft(emptyDraft());
    setBuilderOpen(true);
  };

  const openEdit = (automation: Automation) => {
    setSelectedAutomationId(automation.id);
    setDraft(draftFromAutomation(automation));
    setBuilderOpen(true);
  };

  const updateStep = (
    id: string,
    patch: Partial<Pick<DraftStep, "type" | "config">>,
  ) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step) =>
        step.id === id ? { ...step, ...patch } : step,
      ),
    }));
  };

  const saveDraft = () => {
    const name = draft.name.trim();
    if (!name) {
      addToast({
        title: "Podaj nazwę automatyzacji",
        message: "Nazwa pozwala później rozpoznać przepływ w historii.",
        tone: "warning",
      });
      return;
    }
    if (draft.steps.length === 0) {
      addToast({
        title: "Dodaj co najmniej jeden krok",
        message: "Pusty przepływ nie wykona żadnej operacji.",
        tone: "warning",
      });
      return;
    }
    if (draft.triggerType === "schedule" && !draft.nextRunAt) {
      addToast({
        title: "Ustaw pierwsze uruchomienie",
        message: "Harmonogram wymaga daty rozpoczęcia.",
        tone: "warning",
      });
      return;
    }

    const definitions = draft.steps.map(({ type, config }) => ({
      type,
      config,
    }));
    const nextRunAt =
      draft.triggerType === "schedule" && draft.nextRunAt
        ? new Date(draft.nextRunAt).toISOString()
        : undefined;
    const automation: Automation = {
      id: draft.id ?? crypto.randomUUID(),
      name,
      description: draft.description.trim(),
      trigger: triggerLabels[draft.triggerType],
      triggerType: draft.triggerType,
      triggerConfig: draft.triggerConfig,
      steps: draft.steps.map(stepSummary),
      stepDefinitions: definitions,
      active: draft.active,
      runs: draft.id ? (selectedAutomation?.runs ?? 0) : 0,
      successRate: draft.id ? (selectedAutomation?.successRate ?? 0) : 0,
      lastRunAt: draft.id
        ? (selectedAutomation?.lastRunAt ?? new Date(0).toISOString())
        : new Date(0).toISOString(),
      nextRunAt,
      version: draft.id ? (selectedAutomation?.version ?? 1) : 1,
      recentRuns: draft.id ? selectedAutomation?.recentRuns : [],
    };

    if (draft.id) {
      updateAutomation(draft.id, automation);
    } else {
      addAutomation(automation);
      setSelectedAutomationId(automation.id);
    }
    setBuilderOpen(false);
    addToast({
      title: draft.id ? "Automatyzacja zaktualizowana" : "Automatyzacja utworzona",
      message: draft.active
        ? "Przepływ jest aktywny i może trafić do kolejki workera."
        : "Przepływ zapisano jako wstrzymany.",
      tone: "success",
    });
  };

  return (
    <>
      <PageHeader
        actions={
          <>
            <Button
              icon={RefreshCw}
              onClick={() => window.location.reload()}
            >
              Odśwież stan
            </Button>
            <Button icon={Plus} onClick={openCreate} variant="primary">
              Nowa automatyzacja
            </Button>
          </>
        }
        description="Łącz wyzwalacze i działania w procesy wykonywane przez bezpieczną kolejkę."
        title="Automatyzacje"
      />

      <section className="summary-strip">
        <div>
          <Bot size={18} />
          <span>Aktywne przepływy</span>
          <strong>{automations.filter((item) => item.active).length}</strong>
        </div>
        <div>
          <Activity size={18} />
          <span>Uruchomienia łącznie</span>
          <strong>
            {formatNumber(
              automations.reduce((sum, item) => sum + item.runs, 0),
            )}
          </strong>
        </div>
        <div>
          <CheckCircle2 size={18} />
          <span>Średnia skuteczność</span>
          <strong>{formatPercent(averageSuccessRate)}%</strong>
        </div>
        <div>
          <Clock3 size={18} />
          <span>W kolejce</span>
          <strong>{queuedRuns}</strong>
        </div>
      </section>

      <div className="automation-layout">
        <section className="workspace-panel">
          <div className="workspace-panel__header">
            <div>
              <h2>Przepływy pracy</h2>
              <p>Każdy krok jest wykonywany kolejno i zapisuje wynik w historii.</p>
            </div>
            <select
              aria-label="Filtr statusu"
              onChange={(event) => setStatusFilter(event.target.value)}
              value={statusFilter}
            >
              <option value="all">Wszystkie statusy</option>
              <option value="active">Aktywne</option>
              <option value="paused">Wstrzymane</option>
            </select>
          </div>

          <div className="automation-list">
            {visibleAutomations.map((automation) => (
              <article
                className={
                  automation.id === selectedAutomationId
                    ? "automation-card automation-card--selected"
                    : "automation-card"
                }
                key={automation.id}
                onClick={() => setSelectedAutomationId(automation.id)}
              >
                <header>
                  <span className="automation-card__icon">
                    <Bot size={20} />
                  </span>
                  <div>
                    <h3>{automation.name}</h3>
                    <p>{automation.trigger}</p>
                  </div>
                  <Toggle
                    checked={automation.active}
                    label={`Zmień status ${automation.name}`}
                    onChange={() => toggleAutomation(automation.id)}
                  />
                  <button
                    aria-label={`Edytuj ${automation.name}`}
                    className="icon-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openEdit(automation);
                    }}
                    title="Edytuj przepływ"
                    type="button"
                  >
                    <Pencil size={16} />
                  </button>
                </header>
                <div className="workflow-steps">
                  <span className="workflow-trigger">
                    <GitBranch size={15} />
                    Wyzwalacz
                  </span>
                  {automation.steps.map((step, index) => (
                    <div key={`${automation.id}-${index}`}>
                      <ArrowRight size={14} />
                      <span>
                        <small>Krok {index + 1}</small>
                        <strong>{step}</strong>
                      </span>
                    </div>
                  ))}
                </div>
                <footer>
                  <span>
                    <Activity size={14} />
                    {formatNumber(automation.runs)} uruchomień
                  </span>
                  <span>
                    <CheckCircle2 size={14} />
                    {formatPercent(automation.successRate)}% sukcesu
                  </span>
                  <span>
                    <Clock3 size={14} />
                    {automation.lastRunAt === new Date(0).toISOString()
                      ? "Jeszcze nie uruchamiano"
                      : formatDateTime(automation.lastRunAt)}
                  </span>
                  <Button
                    icon={Play}
                    onClick={(event) => {
                      event.stopPropagation();
                      runAutomation(automation.id);
                      addToast({
                        title: "Uruchomienie dodane do kolejki",
                        message: `${automation.name} zostanie obsłużona przez worker.`,
                        tone: "info",
                      });
                    }}
                    size="sm"
                  >
                    Uruchom
                  </Button>
                </footer>
              </article>
            ))}
            {visibleAutomations.length === 0 ? (
              <div className="empty-state">
                <Bot size={30} />
                <strong>Brak przepływów spełniających filtr</strong>
                <span>Utwórz automatyzację lub zmień filtr statusu.</span>
                <Button icon={Plus} onClick={openCreate} variant="primary">
                  Nowa automatyzacja
                </Button>
              </div>
            ) : null}
          </div>
        </section>

        {selectedAutomation ? (
          <aside className="automation-inspector panel">
            <div className="panel__header">
              <div>
                <h2>Inspektor przepływu</h2>
                <p>Konfiguracja i ostatnie wykonania.</p>
              </div>
              <Settings2 size={18} />
            </div>
            <div className="automation-inspector__body">
              <div className="inspector-status">
                <span className="automation-card__icon">
                  <Sparkles size={19} />
                </span>
                <div>
                  <strong>{selectedAutomation.name}</strong>
                  <Badge
                    dot
                    tone={selectedAutomation.active ? "success" : "neutral"}
                  >
                    {selectedAutomation.active ? "Aktywna" : "Wstrzymana"}
                  </Badge>
                </div>
              </div>
              <dl>
                <div>
                  <dt>Wyzwalacz</dt>
                  <dd>{selectedAutomation.trigger}</dd>
                </div>
                <div>
                  <dt>Wersja</dt>
                  <dd>v{selectedAutomation.version ?? 1}</dd>
                </div>
                <div>
                  <dt>Retry policy</dt>
                  <dd>3 próby / backoff</dd>
                </div>
                <div>
                  <dt>Kolejność</dt>
                  <dd>{selectedAutomation.steps.length} kroków</dd>
                </div>
                {selectedAutomation.nextRunAt ? (
                  <div>
                    <dt>Następne uruchomienie</dt>
                    <dd>{formatDateTime(selectedAutomation.nextRunAt)}</dd>
                  </div>
                ) : null}
              </dl>
              <div className="automation-run-list">
                <span>Ostatnie wykonania</span>
                {(selectedAutomation.recentRuns ?? []).slice(0, 5).map((run) => (
                  <div key={String(run.id)}>
                    <Badge
                      tone={
                        run.status === "complete"
                          ? "success"
                          : run.status === "failed"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {String(run.status)}
                    </Badge>
                    <time>{formatDateTime(String(run.created_at))}</time>
                  </div>
                ))}
                {(selectedAutomation.recentRuns ?? []).length === 0 ? (
                  <small>Brak uruchomień w historii.</small>
                ) : null}
              </div>
            </div>
            <footer className="automation-inspector__actions">
              <Button
                icon={Pencil}
                onClick={() => openEdit(selectedAutomation)}
              >
                Edytuj
              </Button>
              <Button
                aria-label="Usuń automatyzację"
                icon={Trash2}
                onClick={() => setDeleteTarget(selectedAutomation)}
                variant="danger"
              />
            </footer>
          </aside>
        ) : (
          <aside className="automation-inspector panel empty-state">
            <Settings2 size={28} />
            <strong>Inspektor jest gotowy</strong>
            <span>Wybierz lub utwórz przepływ, aby zobaczyć konfigurację.</span>
          </aside>
        )}
      </div>

      <Modal
        description="Skonfiguruj wyzwalacz i kroki wykonywane przez worker."
        footer={
          <>
            <Button onClick={() => setBuilderOpen(false)}>Anuluj</Button>
            <Button onClick={saveDraft} variant="primary">
              {draft.id ? "Zapisz zmiany" : "Utwórz przepływ"}
            </Button>
          </>
        }
        onClose={() => setBuilderOpen(false)}
        open={builderOpen}
        size="xl"
        title={draft.id ? "Edytuj automatyzację" : "Nowa automatyzacja"}
      >
        <div className="automation-editor">
          <section className="automation-editor__basics">
            <div className="form-grid form-grid--two">
              <label className="form-field">
                <span className="form-field__label">Nazwa</span>
                <input
                  autoFocus
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="np. Eskalacja pilnych zgłoszeń"
                  value={draft.name}
                />
              </label>
              <label className="form-field">
                <span className="form-field__label">Wyzwalacz</span>
                <select
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      triggerType: event.target.value as TriggerType,
                    }))
                  }
                  value={draft.triggerType}
                >
                  {Object.entries(triggerLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="form-field">
              <span className="form-field__label">Opis</span>
              <textarea
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Cel procesu, właściciel i oczekiwany rezultat."
                rows={3}
                value={draft.description}
              />
            </label>

            {draft.triggerType === "message_ingested" ||
            draft.triggerType === "message_classified" ? (
              <div className="form-grid form-grid--two">
                <label className="form-field">
                  <span className="form-field__label">
                    Kategoria wejściowa
                  </span>
                  <select
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        triggerConfig: {
                          ...current.triggerConfig,
                          category_id: event.target.value,
                        },
                      }))
                    }
                    value={String(draft.triggerConfig.category_id ?? "")}
                  >
                    <option value="">Dowolna kategoria</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span className="form-field__label">Minimalna ocena</span>
                  <input
                    max={100}
                    min={-100}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        triggerConfig: {
                          ...current.triggerConfig,
                          minimum_score: Number(event.target.value),
                        },
                      }))
                    }
                    type="number"
                    value={Number(draft.triggerConfig.minimum_score ?? 0)}
                  />
                </label>
              </div>
            ) : null}

            {draft.triggerType === "schedule" ? (
              <div className="form-grid form-grid--two">
                <label className="form-field">
                  <span className="form-field__label">
                    Pierwsze uruchomienie
                  </span>
                  <input
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        nextRunAt: event.target.value,
                      }))
                    }
                    type="datetime-local"
                    value={draft.nextRunAt}
                  />
                </label>
                <label className="form-field">
                  <span className="form-field__label">
                    Powtarzaj co (minuty)
                  </span>
                  <input
                    max={525600}
                    min={1}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        triggerConfig: {
                          ...current.triggerConfig,
                          interval_minutes: Number(event.target.value),
                        },
                      }))
                    }
                    type="number"
                    value={Number(
                      draft.triggerConfig.interval_minutes ?? 60,
                    )}
                  />
                </label>
              </div>
            ) : null}

            <label className="automation-editor__toggle">
              <Toggle
                checked={draft.active}
                label="Aktywuj automatyzację po zapisaniu"
                onChange={(active) =>
                  setDraft((current) => ({ ...current, active }))
                }
              />
              <span>
                <strong>Aktywna po zapisaniu</strong>
                <small>
                  Wstrzymany przepływ można uruchomić ręcznie w dowolnej chwili.
                </small>
              </span>
            </label>
          </section>

          <section className="automation-editor__steps">
            <header>
              <div>
                <h3>Kroki przepływu</h3>
                <p>Wykonywane kolejno; opóźnienie bezpiecznie wznawia kolejkę.</p>
              </div>
              <Button
                icon={Plus}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    steps: [...current.steps, newStep()],
                  }))
                }
                size="sm"
              >
                Dodaj krok
              </Button>
            </header>

            <div className="automation-step-editor">
              {draft.steps.map((step, index) => {
                const meta = stepMeta(step.type);
                const StepIcon = meta.icon;
                return (
                  <article key={step.id}>
                    <div className="automation-step-editor__index">
                      <span>{index + 1}</span>
                      {index < draft.steps.length - 1 ? <i /> : null}
                    </div>
                    <div className="automation-step-editor__card">
                      <header>
                        <span className="automation-card__icon">
                          <StepIcon size={18} />
                        </span>
                        <label className="form-field">
                          <span className="form-field__label">Działanie</span>
                          <select
                            onChange={(event) =>
                              updateStep(step.id, {
                                type: event.target.value as StepType,
                                config: newStep(
                                  event.target.value as StepType,
                                ).config,
                              })
                            }
                            value={step.type}
                          >
                            {stepOptions.map((option) => (
                              <option key={option.type} value={option.type}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          aria-label={`Usuń krok ${index + 1}`}
                          className="icon-button"
                          onClick={() =>
                            setDraft((current) => ({
                              ...current,
                              steps: current.steps.filter(
                                (item) => item.id !== step.id,
                              ),
                            }))
                          }
                          type="button"
                        >
                          <Trash2 size={16} />
                        </button>
                      </header>
                      <p>{meta.description}</p>
                      <StepFields
                        categories={categories}
                        deliveryAccounts={deliveryAccounts}
                        onChange={(config) => updateStep(step.id, { config })}
                        step={step}
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </Modal>

      <Modal
        description="Historia wykonań pozostanie w dzienniku audytowym."
        footer={
          <>
            <Button onClick={() => setDeleteTarget(null)}>Anuluj</Button>
            <Button
              icon={Trash2}
              onClick={() => {
                if (!deleteTarget) return;
                removeAutomation(deleteTarget.id);
                setDeleteTarget(null);
                addToast({
                  title: "Automatyzacja usunięta",
                  message: "Przepływ nie będzie już uruchamiany.",
                  tone: "success",
                });
              }}
              variant="danger"
            >
              Usuń
            </Button>
          </>
        }
        onClose={() => setDeleteTarget(null)}
        open={Boolean(deleteTarget)}
        size="sm"
        title={`Usunąć „${deleteTarget?.name ?? ""}”?`}
      >
        <p>
          Tej operacji nie można cofnąć. Oczekujące zadania powiązane z
          przepływem zostaną usunięte przez bazę danych.
        </p>
      </Modal>
    </>
  );
}

function StepFields({
  step,
  categories,
  deliveryAccounts,
  onChange,
}: {
  step: DraftStep;
  categories: ReturnType<typeof useAppState>["categories"];
  deliveryAccounts: ReturnType<typeof useAppState>["deliveryAccounts"];
  onChange: (config: DraftStep["config"]) => void;
}) {
  const field = (
    key: string,
    value: string | number | boolean,
  ): DraftStep["config"] => ({ ...step.config, [key]: value });

  if (step.type === "set_category") {
    return (
      <label className="form-field">
        <span className="form-field__label">Kategoria docelowa</span>
        <select
          onChange={(event) => {
            const category = categories.find(
              (item) => item.id === event.target.value,
            );
            onChange({
              ...field("category_id", event.target.value),
              category_name: category?.name ?? "",
            });
          }}
          value={String(step.config.category_id ?? "")}
        >
          <option value="">Wybierz kategorię...</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (step.type === "set_score" || step.type === "add_score") {
    const key = step.type === "set_score" ? "score" : "delta";
    return (
      <label className="form-field">
        <span className="form-field__label">
          {step.type === "set_score" ? "Nowa ocena" : "Zmiana punktów"}
        </span>
        <input
          max={100}
          min={-100}
          onChange={(event) => onChange(field(key, Number(event.target.value)))}
          type="number"
          value={Number(step.config[key] ?? 0)}
        />
      </label>
    );
  }

  if (step.type === "add_tag") {
    return (
      <label className="form-field">
        <span className="form-field__label">Tag</span>
        <input
          onChange={(event) => onChange(field("tag", event.target.value))}
          placeholder="np. pilne"
          value={String(step.config.tag ?? "")}
        />
      </label>
    );
  }

  if (step.type === "set_review") {
    return (
      <label className="form-field">
        <span className="form-field__label">Powód weryfikacji</span>
        <input
          onChange={(event) => onChange(field("reason", event.target.value))}
          placeholder="Dlaczego operator ma sprawdzić wiadomość?"
          value={String(step.config.reason ?? "")}
        />
      </label>
    );
  }

  if (step.type === "send_webhook") {
    return (
      <label className="form-field">
        <span className="form-field__label">Adres HTTPS</span>
        <input
          onChange={(event) => onChange(field("url", event.target.value))}
          placeholder="https://api.example.com/mailflow"
          type="url"
          value={String(step.config.url ?? "")}
        />
        <span className="form-field__hint">
          Domena musi być wpisana w WEBHOOK_ALLOWED_HOSTS.
        </span>
      </label>
    );
  }

  if (step.type === "send_email") {
    return (
      <div className="form-grid form-grid--two">
        <label className="form-field">
          <span className="form-field__label">Adres odbiorcy</span>
          <input
            onChange={(event) => onChange(field("to", event.target.value))}
            placeholder="zespol@example.com"
            type="email"
            value={String(step.config.to ?? "")}
          />
        </label>
        <label className="form-field">
          <span className="form-field__label">Konto wysyłkowe</span>
          <select
            onChange={(event) =>
              onChange(field("delivery_account_id", event.target.value))
            }
            value={String(step.config.delivery_account_id ?? "")}
          >
            <option value="">Pierwsze aktywne konto</option>
            {deliveryAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    );
  }

  if (step.type === "create_task") {
    return (
      <div className="form-grid form-grid--two">
        <label className="form-field">
          <span className="form-field__label">Tytuł zadania</span>
          <input
            onChange={(event) => onChange(field("title", event.target.value))}
            placeholder="{{message.subject}}"
            value={String(step.config.title ?? "")}
          />
        </label>
        <label className="form-field">
          <span className="form-field__label">Termin za (minuty)</span>
          <input
            min={1}
            onChange={(event) =>
              onChange(field("due_in_minutes", Number(event.target.value)))
            }
            type="number"
            value={Number(step.config.due_in_minutes ?? 60)}
          />
        </label>
      </div>
    );
  }

  if (step.type === "notify_team") {
    return (
      <div className="form-grid form-grid--two">
        <label className="form-field">
          <span className="form-field__label">Tytuł powiadomienia</span>
          <input
            onChange={(event) => onChange(field("title", event.target.value))}
            placeholder="{{message.subject}}"
            value={String(step.config.title ?? "")}
          />
        </label>
        <label className="form-field">
          <span className="form-field__label">Ważność</span>
          <select
            onChange={(event) => onChange(field("severity", event.target.value))}
            value={String(step.config.severity ?? "info")}
          >
            <option value="info">Informacja</option>
            <option value="success">Sukces</option>
            <option value="warning">Ostrzeżenie</option>
            <option value="error">Błąd</option>
          </select>
        </label>
      </div>
    );
  }

  if (step.type === "delay") {
    return (
      <label className="form-field">
        <span className="form-field__label">Opóźnienie (minuty)</span>
        <input
          max={10080}
          min={1}
          onChange={(event) =>
            onChange(field("minutes", Number(event.target.value)))
          }
          type="number"
          value={Number(step.config.minutes ?? 5)}
        />
      </label>
    );
  }

  return null;
}
