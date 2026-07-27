import {
  useDeferredValue,
  useMemo,
  useState,
  type ChangeEvent,
} from "react";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  Download,
  Eye,
  File,
  Filter,
  Inbox,
  Paperclip,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Tag,
} from "lucide-react";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Drawer } from "../components/ui/Drawer";
import { PageHeader } from "../components/ui/PageHeader";
import { useAppState } from "../lib/AppState";
import { cn, formatDateTime } from "../lib/format";
import type { EmailMessage, MessageStatus } from "../types";

type DirectionFilter = "all" | "incoming" | "outgoing";

const statusLabels: Record<MessageStatus, string> = {
  new: "Nowa",
  classified: "Sklasyfikowana",
  review: "Wymaga przeglądu",
  automated: "Zautomatyzowana",
  failed: "Błąd",
  archived: "Zarchiwizowana",
};

const statusTone: Record<
  MessageStatus,
  "neutral" | "success" | "warning" | "danger" | "info" | "teal"
> = {
  new: "info",
  classified: "teal",
  review: "warning",
  automated: "success",
  failed: "danger",
  archived: "neutral",
};

export function MessagesPage() {
  const { messages, categories, sources, rules, updateMessage, addToast } =
    useAppState();
  const [direction, setDirection] = useState<DirectionFilter>("incoming");
  const [status, setStatus] = useState<MessageStatus | "all">("all");
  const [categoryId, setCategoryId] = useState("all");
  const [sourceId, setSourceId] = useState("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [openedMessage, setOpenedMessage] = useState<EmailMessage | null>(null);

  const filteredMessages = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLocaleLowerCase("pl");
    return messages.filter((message) => {
      if (direction !== "all" && message.direction !== direction) return false;
      if (status !== "all" && message.status !== status) return false;
      if (categoryId !== "all" && message.categoryId !== categoryId) return false;
      if (sourceId !== "all" && message.sourceId !== sourceId) return false;
      if (
        normalizedQuery &&
        ![
          message.sender,
          message.senderName,
          message.recipient,
          message.subject,
          message.preview,
          ...message.tags,
        ]
          .join(" ")
          .toLocaleLowerCase("pl")
          .includes(normalizedQuery)
      ) {
        return false;
      }
      return true;
    });
  }, [categoryId, deferredQuery, direction, messages, sourceId, status]);

  const selectedMessageIds = new Set(selectedIds);
  const allVisibleSelected =
    filteredMessages.length > 0 &&
    filteredMessages.every((message) => selectedMessageIds.has(message.id));

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      const visibleIds = new Set(filteredMessages.map((message) => message.id));
      setSelectedIds((current) =>
        current.filter((id) => !visibleIds.has(id)),
      );
      return;
    }
    setSelectedIds((current) => [
      ...new Set([...current, ...filteredMessages.map((message) => message.id)]),
    ]);
  };

  const toggleMessage = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((messageId) => messageId !== id)
        : [...current, id],
    );
  };

  const bulkArchive = () => {
    selectedIds.forEach((id) => updateMessage(id, { status: "archived" }));
    addToast({
      title: "Wiadomości zarchiwizowane",
      message: `Przeniesiono ${selectedIds.length} wiadomości do archiwum.`,
      tone: "success",
    });
    setSelectedIds([]);
  };

  const updateOpenedMessage = (patch: Partial<EmailMessage>) => {
    if (!openedMessage) return;
    updateMessage(openedMessage.id, patch);
    setOpenedMessage((current) => (current ? { ...current, ...patch } : null));
  };

  const runSync = () => {
    addToast({
      title: "Synchronizacja trwa",
      message: "Pobieramy nowe wiadomości ze wszystkich aktywnych skrzynek.",
      tone: "info",
    });
  };

  return (
    <>
      <PageHeader
        actions={
          <>
            <Button icon={Download} size="sm">
              Eksportuj
            </Button>
            <Button icon={RefreshCw} onClick={runSync} size="sm" variant="primary">
              Synchronizuj
            </Button>
          </>
        }
        description="Wspólna kolejka poczty, klasyfikacja, scoring i ręczna weryfikacja."
        title="Wiadomości"
      />

      <section className="workspace-panel messages-workspace">
        <div className="message-tabs" role="tablist">
          {[
            { key: "incoming", label: "Odebrane", icon: ArrowDownToLine },
            { key: "outgoing", label: "Wysłane", icon: ArrowUpFromLine },
            { key: "all", label: "Wszystkie", icon: Inbox },
          ].map((tab) => {
            const Icon = tab.icon;
            const count =
              tab.key === "all"
                ? messages.length
                : messages.filter((message) => message.direction === tab.key)
                    .length;
            return (
              <button
                aria-selected={direction === tab.key}
                className={cn(
                  "message-tab",
                  direction === tab.key && "message-tab--active",
                )}
                key={tab.key}
                onClick={() => setDirection(tab.key as DirectionFilter)}
                role="tab"
                type="button"
              >
                <Icon size={16} />
                {tab.label}
                <span>{count}</span>
              </button>
            );
          })}
        </div>

        <div className="filter-toolbar">
          <label className="search-field">
            <Search size={16} />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Szukaj po nadawcy, temacie, treści lub tagach..."
              value={query}
            />
          </label>
          <div className="filter-toolbar__select">
            <Filter size={15} />
            <select
              aria-label="Status wiadomości"
              onChange={(event) =>
                setStatus(event.target.value as MessageStatus | "all")
              }
              value={status}
            >
              <option value="all">Wszystkie statusy</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </div>
          <div className="filter-toolbar__select">
            <Tag size={15} />
            <select
              aria-label="Kategoria"
              onChange={(event) => setCategoryId(event.target.value)}
              value={categoryId}
            >
              <option value="all">Wszystkie kategorie</option>
              <option value="">Bez kategorii</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </div>
          <div className="filter-toolbar__select">
            <Inbox size={15} />
            <select
              aria-label="Źródło"
              onChange={(event) => setSourceId(event.target.value)}
              value={sourceId}
            >
              <option value="all">Wszystkie źródła</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </div>
        </div>

        {selectedIds.length > 0 ? (
          <div className="selection-toolbar">
            <span>
              <Check size={16} /> Zaznaczono <b>{selectedIds.length}</b>
            </span>
            <div>
              <Button icon={Tag} size="sm">
                Przypisz kategorię
              </Button>
              <Button icon={ShieldCheck} size="sm">
                Oznacz jako sprawdzone
              </Button>
              <Button icon={Archive} onClick={bulkArchive} size="sm">
                Archiwizuj
              </Button>
              <button
                className="text-button"
                onClick={() => setSelectedIds([])}
                type="button"
              >
                Wyczyść
              </button>
            </div>
          </div>
        ) : null}

        <div className="table-wrap message-table-wrap">
          <table className="data-table message-table">
            <thead>
              <tr>
                <th className="checkbox-cell">
                  <input
                    aria-label="Zaznacz wszystkie wiadomości w widoku"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    type="checkbox"
                  />
                </th>
                <th>Nadawca i odbiorca</th>
                <th>Temat i podgląd</th>
                <th>Kategoria</th>
                <th>Score</th>
                <th>Źródło</th>
                <th>Odebrano</th>
                <th>Status</th>
                <th aria-label="Akcje" />
              </tr>
            </thead>
            <tbody>
              {filteredMessages.map((message) => {
                const category = categories.find(
                  (item) => item.id === message.categoryId,
                );
                const source = sources.find(
                  (item) => item.id === message.sourceId,
                );
                return (
                  <tr
                    className={cn(
                      message.status === "new" && "message-row--unread",
                      selectedMessageIds.has(message.id) &&
                        "message-row--selected",
                    )}
                    key={message.id}
                  >
                    <td className="checkbox-cell">
                      <input
                        aria-label={`Zaznacz ${message.subject}`}
                        checked={selectedMessageIds.has(message.id)}
                        onChange={() => toggleMessage(message.id)}
                        type="checkbox"
                      />
                    </td>
                    <td>
                      <strong className="cell-primary">
                        {message.senderName || message.sender}
                      </strong>
                      <span className="cell-secondary">{message.sender}</span>
                      <span className="cell-tertiary">
                        do: {message.recipient}
                      </span>
                    </td>
                    <td className="message-subject-cell">
                      <div>
                        <strong>{message.subject}</strong>
                        {message.hasAttachments ? (
                          <Paperclip aria-label="Ma załączniki" size={14} />
                        ) : null}
                      </div>
                      <span>{message.preview}</span>
                    </td>
                    <td>
                      {category ? (
                        <span
                          className="category-label"
                          style={{
                            backgroundColor: `${category.color}14`,
                            borderColor: `${category.color}42`,
                            color: category.color,
                          }}
                        >
                          {category.name}
                        </span>
                      ) : (
                        <Badge tone="neutral">Bez kategorii</Badge>
                      )}
                    </td>
                    <td>
                      <span
                        className={`score score--${
                          message.score >= 80
                            ? "high"
                            : message.score >= 50
                              ? "medium"
                              : "low"
                        }`}
                      >
                        {message.score || "—"}
                      </span>
                    </td>
                    <td>
                      <div className="source-cell">
                        <span className={`source-glyph source-glyph--${source?.type}`}>
                          {source?.type === "gmail"
                            ? "G"
                            : source?.type === "outlook"
                              ? "O"
                              : source?.type === "scraper"
                                ? "WS"
                                : "IM"}
                        </span>
                        <span>{source?.name ?? "Nieznane"}</span>
                      </div>
                    </td>
                    <td>
                      <time>{formatDateTime(message.receivedAt)}</time>
                    </td>
                    <td>
                      <Badge dot tone={statusTone[message.status]}>
                        {statusLabels[message.status]}
                      </Badge>
                    </td>
                    <td>
                      <button
                        aria-label={`Otwórz wiadomość ${message.subject}`}
                        className="icon-button"
                        onClick={() => setOpenedMessage(message)}
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
          {filteredMessages.length === 0 ? (
            <div className="empty-state">
              <Inbox size={28} />
              <strong>Brak wiadomości dla tych filtrów</strong>
              <span>Zmień warunki wyszukiwania lub wyczyść filtry.</span>
            </div>
          ) : null}
        </div>

        <footer className="table-footer">
          <span>
            Wyświetlanie 1-{filteredMessages.length} z {filteredMessages.length}
          </span>
          <div>
            <button disabled type="button">
              Poprzednia
            </button>
            <button className="is-current" type="button">
              1
            </button>
            <button disabled type="button">
              Następna
            </button>
          </div>
        </footer>
      </section>

      <Drawer
        footer={
          <>
            <Button
              icon={Archive}
              onClick={() => updateOpenedMessage({ status: "archived" })}
            >
              Archiwizuj
            </Button>
            <Button
              icon={Sparkles}
              onClick={() => {
                if (!openedMessage) return;
                updateOpenedMessage({
                  status: "classified",
                  score: openedMessage.score || 75,
                });
                addToast({
                  title: "Wiadomość przetworzona",
                  message: "Zapisano ręczną klasyfikację i wynik.",
                  tone: "success",
                });
              }}
              variant="primary"
            >
              Zapisz klasyfikację
            </Button>
          </>
        }
        onClose={() => setOpenedMessage(null)}
        open={Boolean(openedMessage)}
        subtitle={openedMessage ? formatDateTime(openedMessage.receivedAt) : ""}
        title={openedMessage?.subject ?? "Wiadomość"}
      >
        {openedMessage ? (
          <div className="message-detail">
            <section className="message-detail__meta">
              <div>
                <span>Od</span>
                <strong>
                  {openedMessage.senderName} &lt;{openedMessage.sender}&gt;
                </strong>
              </div>
              <div>
                <span>Do</span>
                <strong>{openedMessage.recipient}</strong>
              </div>
              <div>
                <span>Kierunek</span>
                <Badge tone={openedMessage.direction === "incoming" ? "info" : "teal"}>
                  {openedMessage.direction === "incoming" ? "Odebrana" : "Wysłana"}
                </Badge>
              </div>
            </section>

            <section className="message-body">
              <p>{openedMessage.body}</p>
            </section>

            {openedMessage.hasAttachments ? (
              <section className="detail-section">
                <h3>Załączniki</h3>
                <div className="attachment-list">
                  {openedMessage.attachmentNames.map((attachment) => (
                    <button key={attachment} type="button">
                      <File size={17} />
                      <span>
                        <strong>{attachment}</strong>
                        <small>Gotowy do pobrania i analizy</small>
                      </span>
                      <Download size={15} />
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="detail-section detail-section--form">
              <h3>Klasyfikacja</h3>
              <label>
                <span>Kategoria</span>
                <select
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    updateOpenedMessage({
                      categoryId: event.target.value || null,
                    })
                  }
                  value={openedMessage.categoryId ?? ""}
                >
                  <option value="">Bez kategorii</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Wynik (0-100)</span>
                <input
                  max="100"
                  min="0"
                  onChange={(event) =>
                    updateOpenedMessage({ score: Number(event.target.value) })
                  }
                  type="number"
                  value={openedMessage.score}
                />
              </label>
              <label>
                <span>Status</span>
                <select
                  onChange={(event) =>
                    updateOpenedMessage({
                      status: event.target.value as MessageStatus,
                    })
                  }
                  value={openedMessage.status}
                >
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            <section className="detail-section">
              <h3>Dopasowane reguły</h3>
              {openedMessage.matchedRuleIds.length > 0 ? (
                <div className="matched-rules">
                  {openedMessage.matchedRuleIds.map((id) => {
                    const rule = rules.find((item) => item.id === id);
                    return (
                      <div key={id}>
                        <ShieldCheck size={17} />
                        <span>
                          <strong>{rule?.name ?? id}</strong>
                          <small>{rule?.description}</small>
                        </span>
                        <Badge tone="success">pasuje</Badge>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="detail-placeholder">
                  Żadna aktywna reguła nie dopasowała tej wiadomości.
                </p>
              )}
            </section>

            {openedMessage.reviewReason ? (
              <section className="review-note">
                <strong>Powód weryfikacji</strong>
                <p>{openedMessage.reviewReason}</p>
              </section>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </>
  );
}

