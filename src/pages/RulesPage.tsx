import { useMemo, useState } from "react";
import {
  Beaker,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  GitBranch,
  GripVertical,
  History,
  ListFilter,
  MoreHorizontal,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useSearchParams } from "react-router";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { Toggle } from "../components/ui/Toggle";
import { useAppState } from "../lib/AppState";
import { cn, formatDateTime, formatNumber } from "../lib/format";
import { evaluateRule } from "../lib/ruleEngine";
import type {
  AutomationRule,
  ConditionField,
  ConditionOperator,
  RuleActionType,
  RuleCondition,
} from "../types";

const fieldLabels: Record<ConditionField, string> = {
  sender: "Adres nadawcy",
  sender_domain: "Domena nadawcy",
  recipient: "Adres odbiorcy",
  subject: "Temat",
  body: "Treść",
  attachment_name: "Nazwa załącznika",
  attachment_type: "Typ załącznika",
  source: "Źródło / skrzynka",
  sentiment: "Wydźwięk",
  url: "URL w treści",
  size: "Rozmiar treści",
};

const operatorLabels: Record<ConditionOperator, string> = {
  contains: "zawiera",
  not_contains: "nie zawiera",
  equals: "jest równe",
  not_equals: "nie jest równe",
  starts_with: "zaczyna się od",
  ends_with: "kończy się na",
  matches: "pasuje do regex",
  greater_than: "jest większe niż",
  less_than: "jest mniejsze niż",
  exists: "istnieje",
};

const actionLabels: Record<RuleActionType, string> = {
  assign_category: "Przypisz kategorię",
  add_score: "Dodaj punkty (score)",
  add_tag: "Dodaj tag",
  set_review: "Ustaw priorytet przeglądu",
  forward_smtp: "Przekaż dalej (SMTP)",
  send_webhook: "Wyślij webhook",
  scrape_urls: "Wyodrębnij URL i zescrapuj",
  create_task: "Utwórz zadanie",
  archive: "Archiwizuj",
  stop_processing: "Zatrzymaj przetwarzanie",
};

const conditionFields = Object.keys(fieldLabels) as ConditionField[];
const conditionOperators = Object.keys(operatorLabels) as ConditionOperator[];
const actionTypes = Object.keys(actionLabels) as RuleActionType[];

const createCondition = (): RuleCondition => ({
  id: crypto.randomUUID(),
  field: "subject",
  operator: "contains",
  value: "",
});

const emptyRule: AutomationRule = {
  id: "new-rule",
  name: "Nowa reguła",
  description: "Nowa reguła do skonfigurowania.",
  categoryId: null,
  priority: 50,
  active: false,
  matchMode: "all",
  conditions: [
    {
      id: "new-condition",
      field: "subject",
      operator: "contains",
      value: "",
    },
  ],
  actions: [],
  hits: 0,
  version: 0,
  updatedAt: "2026-07-27T00:00:00+02:00",
  updatedBy: "System",
};

const emptyMessage = {
  id: "sample-message",
  sender: "nadawca@example.com",
  senderName: "Przykładowy nadawca",
  recipient: "inbox@example.com",
  subject: "Przykładowa wiadomość",
  preview: "",
  body: "",
  receivedAt: "2026-07-27T00:00:00+02:00",
  status: "new" as const,
  categoryId: null,
  score: 0,
  sourceId: "sample-source",
  direction: "incoming" as const,
  tags: [],
  hasAttachments: false,
  attachmentNames: [],
  matchedRuleIds: [],
};

export function RulesPage() {
  const { rules, categories, messages, updateRule, addRule, addToast } =
    useAppState();
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryFilter = searchParams.get("category");
  const [selectedRuleId, setSelectedRuleId] = useState(
    () =>
      rules.find((rule) => rule.categoryId === categoryFilter)?.id ??
      rules[0]?.id ??
      "",
  );
  const selectedRule =
    rules.find((rule) => rule.id === selectedRuleId) ?? rules[0];
  const [draft, setDraft] = useState<AutomationRule>(
    selectedRule ?? emptyRule,
  );
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [testMessageId, setTestMessageId] = useState(messages[0]?.id ?? "");
  const [newRuleOpen, setNewRuleOpen] = useState(false);
  const [newRuleName, setNewRuleName] = useState("");

  const selectRule = (rule: AutomationRule) => {
    setSelectedRuleId(rule.id);
    setDraft(structuredClone(rule));
  };

  const filteredRules = useMemo(() => {
    const normalized = query.toLocaleLowerCase("pl").trim();
    return rules.filter((rule) => {
      if (categoryFilter && rule.categoryId !== categoryFilter) return false;
      if (statusFilter === "active" && !rule.active) return false;
      if (statusFilter === "inactive" && rule.active) return false;
      return [rule.name, rule.description]
        .join(" ")
        .toLocaleLowerCase("pl")
        .includes(normalized);
    });
  }, [categoryFilter, query, rules, statusFilter]);

  const testMessage =
    messages.find((message) => message.id === testMessageId) ?? messages[0];
  const evaluation = useMemo(
    () => evaluateRule(testMessage ?? emptyMessage, draft),
    [draft, testMessage],
  );
  const calculatedScore = Math.min(
    100,
    Math.max(0, (testMessage?.score ?? 0) + evaluation.scoreDelta),
  );

  const updateCondition = (
    conditionId: string,
    patch: Partial<RuleCondition>,
  ) => {
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.map((condition) =>
        condition.id === conditionId
          ? { ...condition, ...patch }
          : condition,
      ),
    }));
  };

  const updateAction = (
    actionId: string,
    patch: Partial<AutomationRule["actions"][number]>,
  ) => {
    setDraft((current) => ({
      ...current,
      actions: current.actions.map((action) =>
        action.id === actionId ? { ...action, ...patch } : action,
      ),
    }));
  };

  const saveDraft = (activate: boolean) => {
    const nextVersion =
      Math.max(draft.version, selectedRule?.version ?? draft.version) + 1;
    const patch = {
      ...draft,
      active: activate ? true : draft.active,
      version: nextVersion,
      updatedAt: new Date().toISOString(),
      updatedBy: "Jakub Kowalski",
    };
    updateRule(draft.id, patch);
    setDraft(patch);
    addToast({
      title: activate ? "Reguła zapisana i aktywna" : "Wersja robocza zapisana",
      message: `${draft.name} ma teraz wersję ${nextVersion}.`,
      tone: "success",
    });
  };

  const createRule = () => {
    if (!newRuleName.trim()) return;
    const rule: AutomationRule = {
      id: `rule-${crypto.randomUUID()}`,
      name: newRuleName.trim(),
      description: "Nowa reguła do skonfigurowania.",
      categoryId: null,
      priority: 50,
      active: false,
      matchMode: "all",
      conditions: [createCondition()],
      actions: [
        {
          id: crypto.randomUUID(),
          type: "assign_category",
          value: categories[0]?.id ?? "",
        },
      ],
      hits: 0,
      version: 1,
      updatedAt: new Date().toISOString(),
      updatedBy: "Jakub Kowalski",
    };
    addRule(rule);
    setNewRuleOpen(false);
    setNewRuleName("");
    selectRule(rule);
  };

  if (!selectedRule) {
    return (
      <div className="rules-page">
        <div className="rules-toolbar">
          <div>
            <h1>Reguły i scoring</h1>
            <p>Buduj warunki, wyniki i akcje bez pisania kodu.</p>
          </div>
          <Button
            icon={Plus}
            onClick={() => setNewRuleOpen(true)}
            size="sm"
            variant="primary"
          >
            Nowa reguła
          </Button>
        </div>
        <section className="panel empty-state">
          <GitBranch size={30} />
          <strong>Ta organizacja nie ma jeszcze reguł</strong>
          <span>
            Utwórz pierwszą regułę, aby automatycznie klasyfikować wiadomości.
          </span>
          <Button
            icon={Plus}
            onClick={() => setNewRuleOpen(true)}
            variant="primary"
          >
            Utwórz pierwszą regułę
          </Button>
        </section>
        <Modal
          description="Zaczniemy od jednego warunku i akcji. Wszystko można później rozbudować."
          footer={
            <>
              <Button onClick={() => setNewRuleOpen(false)}>Anuluj</Button>
              <Button
                disabled={!newRuleName.trim()}
                onClick={createRule}
                variant="primary"
              >
                Utwórz regułę
              </Button>
            </>
          }
          onClose={() => setNewRuleOpen(false)}
          open={newRuleOpen}
          title="Nowa reguła"
        >
          <label className="form-field">
            <span className="form-field__label">Nazwa reguły</span>
            <input
              autoFocus
              onChange={(event) => setNewRuleName(event.target.value)}
              placeholder="np. Pilne zapytania od kluczowych klientów"
              value={newRuleName}
            />
          </label>
        </Modal>
      </div>
    );
  }

  return (
    <div className="rules-page">
      <div className="rules-toolbar">
        <div>
          <h1>Reguły i scoring</h1>
          <p>Buduj warunki, wyniki i akcje bez pisania kodu.</p>
        </div>
        <div className="rules-toolbar__actions">
          {categoryFilter ? (
            <Button
              icon={X}
              onClick={() => {
                searchParams.delete("category");
                setSearchParams(searchParams);
              }}
              size="sm"
            >
              Wyczyść kategorię
            </Button>
          ) : null}
          <Button
            icon={Beaker}
            onClick={() => {
              const matching = messages.filter((message) =>
                rules.some((rule) => evaluateRule(message, rule).matched),
              ).length;
              addToast({
                title: "Test zestawu zakończony",
                message: `${matching} z ${messages.length} wiadomości pasuje do co najmniej jednej aktywnej reguły.`,
                tone: "success",
              });
            }}
            size="sm"
          >
            Testuj zestaw
          </Button>
          <Button
            icon={Plus}
            onClick={() => setNewRuleOpen(true)}
            size="sm"
            variant="primary"
          >
            Nowa reguła
          </Button>
        </div>
      </div>

      <div className="rule-studio">
        <aside className="rule-list-pane">
          <div className="rule-list-pane__filters">
            <label className="search-field search-field--compact">
              <Search size={15} />
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Szukaj reguły..."
                value={query}
              />
            </label>
            <label className="mini-select">
              <ListFilter size={14} />
              <select
                onChange={(event) => setStatusFilter(event.target.value)}
                value={statusFilter}
              >
                <option value="all">Wszystkie</option>
                <option value="active">Aktywne</option>
                <option value="inactive">Nieaktywne</option>
              </select>
              <ChevronDown size={13} />
            </label>
          </div>

          <div className="rule-list__header">
            <span>#</span>
            <span>Nazwa reguły</span>
            <span>Priorytet</span>
            <span>Trafienia</span>
            <span>Status</span>
          </div>

          <div className="rule-list">
            {filteredRules.map((rule, index) => {
              const category = categories.find(
                (item) => item.id === rule.categoryId,
              );
              return (
                <button
                  className={cn(
                    "rule-list-item",
                    rule.id === draft.id && "rule-list-item--selected",
                  )}
                  key={rule.id}
                  onClick={() => selectRule(rule)}
                  type="button"
                >
                  <span className="rule-list-item__index">{index + 1}</span>
                  <span className="rule-list-item__identity">
                    <strong>{rule.name}</strong>
                    <small>
                      {category ? (
                        <>
                          <i style={{ backgroundColor: category.color }} />
                          {category.name}
                        </>
                      ) : (
                        "Bez kategorii"
                      )}
                    </small>
                  </span>
                  <Badge
                    tone={
                      rule.priority >= 90
                        ? "danger"
                        : rule.priority >= 60
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {rule.priority}
                  </Badge>
                  <span className="rule-list-item__hits">
                    {formatNumber(rule.hits)}
                  </span>
                  <span
                    aria-label={rule.active ? "Aktywna" : "Nieaktywna"}
                    className={`status-dot status-dot--${
                      rule.active ? "active" : "paused"
                    }`}
                  />
                </button>
              );
            })}
          </div>
          <footer className="rule-list-pane__footer">
            <span>{filteredRules.length} reguł</span>
            <span>Sortowanie: priorytet</span>
          </footer>
        </aside>

        <section className="rule-editor-pane">
          <header className="rule-editor__header">
            <div className="rule-editor__identity">
              <GripVertical size={17} />
              <div>
                <input
                  aria-label="Nazwa reguły"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  value={draft.name}
                />
                <span>
                  ID: {draft.id} · wersja {draft.version}
                </span>
              </div>
            </div>
            <Badge tone={draft.active ? "success" : "neutral"}>
              {draft.active ? "Aktywna" : "Wersja robocza"}
            </Badge>
            <Toggle
              checked={draft.active}
              label="Zmień status reguły"
              onChange={(active) =>
                setDraft((current) => ({ ...current, active }))
              }
            />
            <button aria-label="Opcje reguły" className="icon-button" type="button">
              <MoreHorizontal size={17} />
            </button>
          </header>

          <div className="rule-editor__scroll">
            <section className="rule-block">
              <header className="rule-block__header">
                <div>
                  <span className="rule-step">1</span>
                  <div>
                    <h2>Kiedy</h2>
                    <p>Wiadomość spełnia poniższe warunki.</p>
                  </div>
                </div>
                <div className="segmented-control">
                  <button
                    className={draft.matchMode === "all" ? "is-active" : ""}
                    onClick={() =>
                      setDraft((current) => ({ ...current, matchMode: "all" }))
                    }
                    type="button"
                  >
                    AND
                  </button>
                  <button
                    className={draft.matchMode === "any" ? "is-active" : ""}
                    onClick={() =>
                      setDraft((current) => ({ ...current, matchMode: "any" }))
                    }
                    type="button"
                  >
                    OR
                  </button>
                </div>
              </header>

              <div className="condition-list">
                {draft.conditions.map((condition, index) => (
                  <div className="condition-row" key={condition.id}>
                    <span className="condition-row__number">{index + 1}</span>
                    <select
                      aria-label={`Pole warunku ${index + 1}`}
                      onChange={(event) =>
                        updateCondition(condition.id, {
                          field: event.target.value as ConditionField,
                        })
                      }
                      value={condition.field}
                    >
                      {conditionFields.map((field) => (
                        <option key={field} value={field}>
                          {fieldLabels[field]}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`Operator warunku ${index + 1}`}
                      onChange={(event) =>
                        updateCondition(condition.id, {
                          operator: event.target.value as ConditionOperator,
                        })
                      }
                      value={condition.operator}
                    >
                      {conditionOperators.map((operator) => (
                        <option key={operator} value={operator}>
                          {operatorLabels[operator]}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`Wartość warunku ${index + 1}`}
                      disabled={condition.operator === "exists"}
                      onChange={(event) =>
                        updateCondition(condition.id, {
                          value: event.target.value,
                        })
                      }
                      placeholder="Wartość..."
                      value={condition.value}
                    />
                    <button
                      aria-label={`Usuń warunek ${index + 1}`}
                      className="icon-button"
                      disabled={draft.conditions.length === 1}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          conditions: current.conditions.filter(
                            (item) => item.id !== condition.id,
                          ),
                        }))
                      }
                      type="button"
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
              <Button
                icon={Plus}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    conditions: [...current.conditions, createCondition()],
                  }))
                }
                size="sm"
                variant="ghost"
              >
                Dodaj warunek
              </Button>
            </section>

            <section className="rule-block">
              <header className="rule-block__header">
                <div>
                  <span className="rule-step">2</span>
                  <div>
                    <h2>To</h2>
                    <p>Zmień klasyfikację, score i metadane.</p>
                  </div>
                </div>
              </header>
              <div className="action-list">
                {draft.actions
                  .filter((action) =>
                    [
                      "assign_category",
                      "add_score",
                      "add_tag",
                      "set_review",
                    ].includes(action.type),
                  )
                  .map((action, index) => (
                    <div className="action-row" key={action.id}>
                      <span>{index + 1}</span>
                      <select
                        onChange={(event) =>
                          updateAction(action.id, {
                            type: event.target.value as RuleActionType,
                          })
                        }
                        value={action.type}
                      >
                        {actionTypes.slice(0, 4).map((type) => (
                          <option key={type} value={type}>
                            {actionLabels[type]}
                          </option>
                        ))}
                      </select>
                      {action.type === "assign_category" ? (
                        <select
                          onChange={(event) =>
                            updateAction(action.id, { value: event.target.value })
                          }
                          value={action.value}
                        >
                          <option value="">Wybierz kategorię</option>
                          {categories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          onChange={(event) =>
                            updateAction(action.id, { value: event.target.value })
                          }
                          placeholder="Wartość akcji..."
                          value={action.value}
                        />
                      )}
                      <button
                        aria-label="Usuń akcję"
                        className="icon-button"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            actions: current.actions.filter(
                              (item) => item.id !== action.id,
                            ),
                          }))
                        }
                        type="button"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
              </div>
              <Button
                icon={Plus}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    actions: [
                      ...current.actions,
                      {
                        id: crypto.randomUUID(),
                        type: "add_tag",
                        value: "",
                      },
                    ],
                  }))
                }
                size="sm"
                variant="ghost"
              >
                Dodaj modyfikację
              </Button>
            </section>

            <section className="rule-block">
              <header className="rule-block__header">
                <div>
                  <span className="rule-step">3</span>
                  <div>
                    <h2>Następnie</h2>
                    <p>Uruchom integracje i kolejne kroki.</p>
                  </div>
                </div>
              </header>
              <div className="action-list">
                {draft.actions
                  .filter((action) =>
                    [
                      "forward_smtp",
                      "send_webhook",
                      "scrape_urls",
                      "create_task",
                      "archive",
                      "stop_processing",
                    ].includes(action.type),
                  )
                  .map((action, index) => (
                    <div className="action-row" key={action.id}>
                      <span>{index + 1}</span>
                      <select
                        onChange={(event) =>
                          updateAction(action.id, {
                            type: event.target.value as RuleActionType,
                          })
                        }
                        value={action.type}
                      >
                        {actionTypes.slice(4).map((type) => (
                          <option key={type} value={type}>
                            {actionLabels[type]}
                          </option>
                        ))}
                      </select>
                      <input
                        onChange={(event) =>
                          updateAction(action.id, { value: event.target.value })
                        }
                        placeholder="Konfiguracja kroku..."
                        value={action.value}
                      />
                      <button
                        aria-label="Usuń krok"
                        className="icon-button"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            actions: current.actions.filter(
                              (item) => item.id !== action.id,
                            ),
                          }))
                        }
                        type="button"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
              </div>
              <Button
                icon={Plus}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    actions: [
                      ...current.actions,
                      {
                        id: crypto.randomUUID(),
                        type: "send_webhook",
                        value: "",
                      },
                    ],
                  }))
                }
                size="sm"
                variant="ghost"
              >
                Dodaj krok
              </Button>
            </section>
          </div>
        </section>

        <aside className="rule-test-pane">
          <header className="rule-test-pane__header">
            <div>
              <Beaker size={17} />
              <strong>Test reguły</strong>
            </div>
            <Badge tone={evaluation.matched ? "success" : "warning"}>
              {evaluation.matched ? "PASUJE" : "NIE PASUJE"}
            </Badge>
          </header>

          <div className="rule-test-pane__body">
            <label className="test-message-select">
              <span>Wiadomość testowa</span>
              <select
                onChange={(event) => setTestMessageId(event.target.value)}
                value={testMessageId}
              >
                {messages
                  .filter((message) => message.direction === "incoming")
                  .map((message) => (
                    <option key={message.id} value={message.id}>
                      {message.subject}
                    </option>
                  ))}
              </select>
            </label>

            <section className="test-message-card">
              <div>
                <span>Od</span>
                <strong>{testMessage.sender}</strong>
              </div>
              <div>
                <span>Do</span>
                <strong>{testMessage.recipient}</strong>
              </div>
              <div>
                <span>Temat</span>
                <strong>{testMessage.subject}</strong>
              </div>
              <p>{testMessage.preview}</p>
              {testMessage.attachmentNames.length > 0 ? (
                <small>
                  Załączniki: {testMessage.attachmentNames.join(", ")}
                </small>
              ) : null}
            </section>

            <section className="test-results">
              <header>
                <strong>Wynik dopasowania</strong>
                <span>
                  {
                    evaluation.conditionResults.filter(
                      (condition) => condition.matched,
                    ).length
                  }
                  /{evaluation.conditionResults.length} warunków
                </span>
              </header>
              <div>
                {evaluation.conditionResults.map((result, index) => {
                  const condition = draft.conditions[index];
                  return (
                    <article
                      className={
                        result.matched
                          ? "condition-result condition-result--match"
                          : "condition-result condition-result--miss"
                      }
                      key={result.conditionId}
                    >
                      {result.matched ? (
                        <Check size={14} />
                      ) : (
                        <X size={14} />
                      )}
                      <span>
                        <strong>
                          {fieldLabels[condition.field]}{" "}
                          {operatorLabels[condition.operator]} „{condition.value}”
                        </strong>
                        <small>
                          Odczytano: {result.actualValue || "brak wartości"}
                        </small>
                      </span>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="score-result">
              <div>
                <span>Wyliczony wynik</span>
                <strong>{calculatedScore}</strong>
              </div>
              <dl>
                <div>
                  <dt>Score wiadomości</dt>
                  <dd>{testMessage.score}</dd>
                </div>
                <div>
                  <dt>Modyfikator reguły</dt>
                  <dd>+{evaluation.scoreDelta}</dd>
                </div>
                <div>
                  <dt>Dopasowanie</dt>
                  <dd>{evaluation.matched ? "pełne" : "brak"}</dd>
                </div>
              </dl>
            </section>

            <section className="version-history">
              <header>
                <History size={16} />
                <strong>Historia wersji</strong>
              </header>
              {[
                {
                  version: draft.version,
                  date: draft.updatedAt,
                  actor: draft.updatedBy,
                },
                {
                  version: Math.max(1, draft.version - 1),
                  date: "2026-07-24T09:32:00+02:00",
                  actor: "Admin",
                },
                {
                  version: Math.max(1, draft.version - 2),
                  date: "2026-07-18T15:08:00+02:00",
                  actor: "Anna Nowak",
                },
              ].map((version, index) => (
                <div key={`${version.version}-${index}`}>
                  <span>v{version.version}</span>
                  <small>
                    {formatDateTime(version.date)} · {version.actor}
                  </small>
                  {index === 0 ? <Badge tone="success">bieżąca</Badge> : null}
                </div>
              ))}
            </section>
          </div>
        </aside>
      </div>

      <footer className="rule-savebar">
        <div>
          <CircleHelp size={16} />
          Zmiany są zapisywane jako nowa wersja i trafiają do dziennika audytu.
        </div>
        <div>
          <Button
            icon={Copy}
            onClick={() => setDraft(structuredClone(selectedRule))}
          >
            Odrzuć zmiany
          </Button>
          <Button icon={Save} onClick={() => saveDraft(false)}>
            Zapisz wersję roboczą
          </Button>
          <Button
            icon={Sparkles}
            onClick={() => saveDraft(true)}
            variant="primary"
          >
            Zapisz i włącz
          </Button>
        </div>
      </footer>

      <Modal
        description="Zaczniemy od jednego warunku i akcji. Wszystko można później rozbudować."
        footer={
          <>
            <Button onClick={() => setNewRuleOpen(false)}>Anuluj</Button>
            <Button
              disabled={!newRuleName.trim()}
              onClick={createRule}
              variant="primary"
            >
              Utwórz regułę
            </Button>
          </>
        }
        onClose={() => setNewRuleOpen(false)}
        open={newRuleOpen}
        title="Nowa reguła"
      >
        <label className="form-field">
          <span className="form-field__label">Nazwa reguły</span>
          <input
            autoFocus
            onChange={(event) => setNewRuleName(event.target.value)}
            placeholder="np. Pilne zapytania od kluczowych klientów"
            value={newRuleName}
          />
        </label>
        <div className="new-rule-options">
          <button className="is-selected" type="button">
            <GitBranch size={18} />
            <span>
              <strong>Pusta reguła</strong>
              <small>Zbuduj warunki od podstaw</small>
            </span>
          </button>
          <button type="button">
            <Copy size={18} />
            <span>
              <strong>Skopiuj istniejącą</strong>
              <small>Użyj reguły jako szablonu</small>
            </span>
          </button>
        </div>
      </Modal>
    </div>
  );
}
