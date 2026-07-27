import { useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Code2,
  Eye,
  FileText,
  MailCheck,
  MousePointerClick,
  Plus,
  Search,
  Send,
  Users,
} from "lucide-react";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { FormField } from "../components/ui/FormField";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { useAppState } from "../lib/AppState";
import { formatDateTime, formatNumber, formatPercent } from "../lib/format";

const campaignStatus = {
  draft: { label: "Wersja robocza", tone: "neutral" },
  scheduled: { label: "Zaplanowana", tone: "info" },
  sending: { label: "Wysyłanie", tone: "warning" },
  sent: { label: "Wysłana", tone: "success" },
  failed: { label: "Błąd", tone: "danger" },
} as const;

export function SendPage() {
  const { campaigns, sources, categories, addToast } = useAppState();
  const [composerOpen, setComposerOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<"editor" | "preview" | "html">(
    "editor",
  );
  const [search, setSearch] = useState("");

  const filteredCampaigns = useMemo(() => {
    const normalized = search.toLocaleLowerCase("pl").trim();
    return campaigns.filter((campaign) =>
      [campaign.subject, campaign.sender, campaign.audience]
        .join(" ")
        .toLocaleLowerCase("pl")
        .includes(normalized),
    );
  }, [campaigns, search]);

  const totalRecipients = campaigns.reduce(
    (sum, campaign) => sum + campaign.recipients,
    0,
  );
  const totalDelivered = campaigns.reduce(
    (sum, campaign) => sum + campaign.delivered,
    0,
  );
  const totalOpened = campaigns.reduce(
    (sum, campaign) => sum + campaign.opened,
    0,
  );

  return (
    <>
      <PageHeader
        actions={
          <Button
            icon={Plus}
            onClick={() => setComposerOpen(true)}
            variant="primary"
          >
            Nowa wiadomość
          </Button>
        }
        description="Ręczne wiadomości, szablony, kolejki oraz historia wysyłek SMTP."
        title="Wysyłka"
      />

      <section className="summary-strip">
        <div>
          <Send size={18} />
          <span>Wysłano</span>
          <strong>{formatNumber(totalRecipients)}</strong>
        </div>
        <div>
          <MailCheck size={18} />
          <span>Dostarczono</span>
          <strong>{formatNumber(totalDelivered)}</strong>
        </div>
        <div>
          <MousePointerClick size={18} />
          <span>Otwarto</span>
          <strong>{formatNumber(totalOpened)}</strong>
        </div>
        <div>
          <CheckCircle2 size={18} />
          <span>Skuteczność</span>
          <strong>
            {formatPercent(
              totalRecipients ? (totalDelivered / totalRecipients) * 100 : 0,
            )}
            %
          </strong>
        </div>
      </section>

      <section className="workspace-panel">
        <div className="workspace-panel__header">
          <div>
            <h2>Historia wysyłek</h2>
            <p>Wiadomości ręczne, automatyczne i zaplanowane kampanie.</p>
          </div>
          <div className="workspace-panel__tools">
            <label className="search-field search-field--compact">
              <Search size={15} />
              <input
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Szukaj wysyłki..."
                value={search}
              />
            </label>
            <select aria-label="Status wysyłki" defaultValue="all">
              <option value="all">Wszystkie statusy</option>
              <option value="draft">Wersje robocze</option>
              <option value="scheduled">Zaplanowane</option>
              <option value="sent">Wysłane</option>
            </select>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table campaign-table">
            <thead>
              <tr>
                <th>Temat</th>
                <th>Nadawca</th>
                <th>Odbiorcy</th>
                <th>Status</th>
                <th>Adresaci</th>
                <th>Dostarczono</th>
                <th>Otwarto</th>
                <th>Utworzono</th>
                <th aria-label="Akcje" />
              </tr>
            </thead>
            <tbody>
              {filteredCampaigns.map((campaign) => {
                const status = campaignStatus[campaign.status];
                return (
                  <tr key={campaign.id}>
                    <td>
                      <strong className="cell-primary">{campaign.subject}</strong>
                      <span className="cell-secondary">ID: {campaign.id}</span>
                    </td>
                    <td>{campaign.sender}</td>
                    <td>{campaign.audience}</td>
                    <td>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                    <td>{formatNumber(campaign.recipients)}</td>
                    <td>{formatNumber(campaign.delivered)}</td>
                    <td>{formatNumber(campaign.opened)}</td>
                    <td>{formatDateTime(campaign.createdAt)}</td>
                    <td>
                      <button
                        aria-label={`Podgląd ${campaign.subject}`}
                        className="icon-button"
                        type="button"
                      >
                        <Eye size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        description="Napisz wiadomość, wybierz odbiorców i przetestuj ją przed wysłaniem."
        footer={
          <>
            <Button onClick={() => setComposerOpen(false)}>
              Zapisz wersję roboczą
            </Button>
            <Button
              icon={Send}
              onClick={() => {
                setComposerOpen(false);
                addToast({
                  title: "Wiadomość dodana do kolejki",
                  message:
                    "Wysyłka rozpocznie się po przejściu walidacji odbiorców.",
                  tone: "success",
                });
              }}
              variant="primary"
            >
              Wyślij wiadomość
            </Button>
          </>
        }
        onClose={() => setComposerOpen(false)}
        open={composerOpen}
        size="xl"
        title="Nowa wiadomość"
      >
        <div className="composer-layout">
          <div className="composer-form">
            <div className="form-grid form-grid--two">
              <FormField label="Konto wysyłkowe">
                <select defaultValue={sources[0]?.id}>
                  {sources
                    .filter((source) => source.type !== "scraper")
                    .map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.name} · {source.address}
                      </option>
                    ))}
                </select>
              </FormField>
              <FormField label="Tryb wysyłki">
                <select defaultValue="now">
                  <option value="now">Wyślij po zatwierdzeniu</option>
                  <option value="schedule">Zaplanuj termin</option>
                  <option value="draft">Tylko wersja robocza</option>
                </select>
              </FormField>
            </div>
            <FormField label="Odbiorcy">
              <div className="recipient-builder">
                <span className="recipient-chip">
                  <Users size={13} />
                  Kategoria: {categories[0]?.name}
                  <button aria-label="Usuń odbiorców" type="button">
                    ×
                  </button>
                </span>
                <input placeholder="Dodaj adres, kategorię lub segment..." />
                <ChevronDown size={15} />
              </div>
            </FormField>
            <div className="form-grid form-grid--two">
              <FormField label="Temat">
                <input defaultValue="Ważna informacja dotycząca Twojego zgłoszenia" />
              </FormField>
              <FormField label="Szablon">
                <select defaultValue="notification">
                  <option value="notification">Powiadomienie standardowe</option>
                  <option value="support">Odpowiedź wsparcia</option>
                  <option value="offer">Oferta handlowa</option>
                  <option value="blank">Pusty szablon</option>
                </select>
              </FormField>
            </div>

            <div className="editor-toolbar">
              <button className="is-active" type="button">
                B
              </button>
              <button type="button">
                <i>I</i>
              </button>
              <button type="button">U</button>
              <span />
              <button type="button">H1</button>
              <button type="button">H2</button>
              <span />
              <button type="button">Lista</button>
              <button type="button">Link</button>
              <button type="button">Zmienna</button>
            </div>
            <div className="rich-editor" contentEditable suppressContentEditableWarning>
              <h2>Dzień dobry,</h2>
              <p>
                przesyłamy ważną informację dotyczącą Twojego zgłoszenia.
                Poniżej znajdziesz wszystkie potrzebne szczegóły.
              </p>
              <p>
                <strong>Numer sprawy:</strong> {"{{message.reference}}"}
              </p>
              <p>
                W razie pytań odpowiedz na tę wiadomość lub skontaktuj się z
                naszym zespołem.
              </p>
            </div>
            <div className="composer-options">
              <label>
                <input defaultChecked type="checkbox" />
                Dodaj link rezygnacji
              </label>
              <label>
                <input defaultChecked type="checkbox" />
                Śledź dostarczenie i otwarcie
              </label>
              <label>
                <input type="checkbox" />
                Dołącz oryginalną wiadomość
              </label>
            </div>
          </div>

          <aside className="composer-preview">
            <div className="composer-preview__tabs">
              <button
                className={previewMode === "editor" ? "is-active" : ""}
                onClick={() => setPreviewMode("editor")}
                type="button"
              >
                <FileText size={14} /> Edytor
              </button>
              <button
                className={previewMode === "preview" ? "is-active" : ""}
                onClick={() => setPreviewMode("preview")}
                type="button"
              >
                <Eye size={14} /> Podgląd
              </button>
              <button
                className={previewMode === "html" ? "is-active" : ""}
                onClick={() => setPreviewMode("html")}
                type="button"
              >
                <Code2 size={14} /> HTML
              </button>
            </div>
            <div className="email-preview-card">
              <header>
                <span>MF</span>
                <div>
                  <strong>MailFlow Studio</strong>
                  <small>support@acme.pl</small>
                </div>
              </header>
              <main>
                <h2>Dzień dobry,</h2>
                <p>
                  przesyłamy ważną informację dotyczącą Twojego zgłoszenia.
                  Poniżej znajdziesz wszystkie potrzebne szczegóły.
                </p>
                <div className="email-info-box">
                  <span>Numer sprawy</span>
                  <strong>#MF-2026-0727</strong>
                </div>
                <p>
                  W razie pytań odpowiedz na tę wiadomość lub skontaktuj się z
                  naszym zespołem.
                </p>
                <a href="#preview">Otwórz szczegóły</a>
              </main>
              <footer>
                MailFlow Studio · Automatyczne centrum komunikacji
              </footer>
            </div>
            <div className="send-safety">
              <CalendarClock size={17} />
              <div>
                <strong>Kontrola przed wysłaniem</strong>
                <span>
                  Duplikaty, wypisane adresy i limity SMTP zostaną sprawdzone
                  automatycznie.
                </span>
              </div>
            </div>
          </aside>
        </div>
      </Modal>
    </>
  );
}

