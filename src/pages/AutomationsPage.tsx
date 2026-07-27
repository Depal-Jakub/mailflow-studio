import { useState } from "react";
import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock3,
  GitBranch,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Webhook,
} from "lucide-react";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { Toggle } from "../components/ui/Toggle";
import { useAppState } from "../lib/AppState";
import { formatDateTime, formatNumber, formatPercent } from "../lib/format";

export function AutomationsPage() {
  const { automations, toggleAutomation, addToast } = useAppState();
  const [builderOpen, setBuilderOpen] = useState(false);
  const [selectedAutomationId, setSelectedAutomationId] = useState(
    automations[0]?.id ?? "",
  );
  const selectedAutomation =
    automations.find((item) => item.id === selectedAutomationId) ??
    automations[0];

  return (
    <>
      <PageHeader
        actions={
          <>
            <Button icon={RefreshCw}>Odśwież stan</Button>
            <Button
              icon={Plus}
              onClick={() => setBuilderOpen(true)}
              variant="primary"
            >
              Nowa automatyzacja
            </Button>
          </>
        }
        description="Łącz wyzwalacze, warunki i działania w powtarzalne procesy."
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
          <strong>
            {formatPercent(
              automations.reduce((sum, item) => sum + item.successRate, 0) /
                automations.length,
            )}
            %
          </strong>
        </div>
        <div>
          <Clock3 size={18} />
          <span>W kolejce</span>
          <strong>12</strong>
        </div>
      </section>

      <div className="automation-layout">
        <section className="workspace-panel">
          <div className="workspace-panel__header">
            <div>
              <h2>Przepływy pracy</h2>
              <p>Aktywne automatyzacje wykonują kroki od lewej do prawej.</p>
            </div>
            <select aria-label="Filtr statusu" defaultValue="all">
              <option value="all">Wszystkie statusy</option>
              <option value="active">Aktywne</option>
              <option value="paused">Wstrzymane</option>
            </select>
          </div>

          <div className="automation-list">
            {automations.map((automation) => (
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
                  <button aria-label="Więcej opcji" className="icon-button" type="button">
                    <MoreHorizontal size={17} />
                  </button>
                </header>
                <div className="workflow-steps">
                  <span className="workflow-trigger">
                    <GitBranch size={15} />
                    Wyzwalacz
                  </span>
                  {automation.steps.map((step, index) => (
                    <div key={step}>
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
                    {formatDateTime(automation.lastRunAt)}
                  </span>
                  <Button
                    icon={Play}
                    onClick={(event) => {
                      event.stopPropagation();
                      addToast({
                        title: "Uruchomienie testowe rozpoczęte",
                        message: `${automation.name} działa na przykładowych danych.`,
                        tone: "info",
                      });
                    }}
                    size="sm"
                  >
                    Test
                  </Button>
                </footer>
              </article>
            ))}
          </div>
        </section>

        <aside className="automation-inspector panel">
          <div className="panel__header">
            <div>
              <h2>Inspektor przepływu</h2>
              <p>Konfiguracja wybranej automatyzacji.</p>
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
                <Badge dot tone={selectedAutomation.active ? "success" : "neutral"}>
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
                <dt>Retry policy</dt>
                <dd>3 próby / backoff 30 s</dd>
              </div>
              <div>
                <dt>Limit równoległości</dt>
                <dd>10 procesów</dd>
              </div>
              <div>
                <dt>Timeout</dt>
                <dd>90 sekund</dd>
              </div>
            </dl>
            <div className="integration-tags">
              <span>Integracje</span>
              <div>
                <Badge tone="info">
                  <Webhook size={13} /> Webhook
                </Badge>
                <Badge tone="teal">SMTP</Badge>
                <Badge tone="neutral">Scraper</Badge>
              </div>
            </div>
          </div>
          <footer>
            <Button icon={Settings2}>Edytuj przepływ</Button>
          </footer>
        </aside>
      </div>

      <Modal
        description="Wybierz wyzwalacz, a następnie dodaj warunki i działania."
        footer={
          <>
            <Button onClick={() => setBuilderOpen(false)}>Anuluj</Button>
            <Button
              onClick={() => {
                setBuilderOpen(false);
                addToast({
                  title: "Automatyzacja zapisana",
                  message: "Nowy przepływ został utworzony jako wersja robocza.",
                  tone: "success",
                });
              }}
              variant="primary"
            >
              Zapisz wersję roboczą
            </Button>
          </>
        }
        onClose={() => setBuilderOpen(false)}
        open={builderOpen}
        size="xl"
        title="Kreator automatyzacji"
      >
        <div className="automation-builder">
          <div className="builder-canvas">
            <article className="builder-node builder-node--trigger">
              <GitBranch size={19} />
              <span>
                <small>Kiedy</small>
                <strong>Nowa wiadomość pasuje do reguły</strong>
              </span>
              <button className="icon-button" type="button">
                <Settings2 size={15} />
              </button>
            </article>
            <span className="builder-connector" />
            <article className="builder-node">
              <CheckCircle2 size={19} />
              <span>
                <small>Jeżeli</small>
                <strong>Score jest większy lub równy 80</strong>
              </span>
              <button className="icon-button" type="button">
                <Settings2 size={15} />
              </button>
            </article>
            <span className="builder-connector" />
            <article className="builder-node">
              <Webhook size={19} />
              <span>
                <small>Następnie</small>
                <strong>Wyślij webhook i utwórz zadanie</strong>
              </span>
              <button className="icon-button" type="button">
                <Settings2 size={15} />
              </button>
            </article>
            <button className="builder-add-node" type="button">
              <Plus size={17} /> Dodaj kolejny krok
            </button>
          </div>
          <aside className="builder-library">
            <h3>Biblioteka kroków</h3>
            <p>Przeciągnij lub kliknij, aby dodać do przepływu.</p>
            {[
              ["Warunek logiczny", GitBranch],
              ["Webhook HTTP", Webhook],
              ["Wiadomość SMTP", Activity],
              ["Opóźnienie", Clock3],
              ["Zmiana kategorii", Sparkles],
            ].map(([label, Icon]) => {
              const ItemIcon = Icon as typeof Activity;
              return (
                <button key={label as string} type="button">
                  <ItemIcon size={17} />
                  {label as string}
                </button>
              );
            })}
          </aside>
        </div>
      </Modal>
    </>
  );
}

