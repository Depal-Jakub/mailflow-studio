import { useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Download,
  Filter,
  History,
  Info,
  Search,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { useAppState } from "../lib/AppState";
import { formatDateTime } from "../lib/format";

const eventIcons = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  error: CircleAlert,
};

const eventTones = {
  info: "info",
  success: "success",
  warning: "warning",
  error: "danger",
} as const;

export function AuditPage() {
  const { auditEvents } = useAppState();
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState("all");

  const filteredEvents = useMemo(() => {
    const normalized = query.toLocaleLowerCase("pl").trim();
    return auditEvents.filter((event) => {
      if (severity !== "all" && event.severity !== severity) return false;
      return [event.actor, event.action, event.target, event.ip]
        .join(" ")
        .toLocaleLowerCase("pl")
        .includes(normalized);
    });
  }, [auditEvents, query, severity]);

  return (
    <>
      <PageHeader
        actions={
          <Button icon={Download}>Eksportuj CSV</Button>
        }
        description="Niezmienny zapis działań użytkowników, reguł i usług systemowych."
        title="Dziennik zdarzeń"
      />

      <section className="audit-security-banner">
        <ShieldCheck size={20} />
        <div>
          <strong>Audyt organizacji jest aktywny</strong>
          <span>
            Zdarzenia są przechowywane przez 365 dni i zabezpieczone przed
            modyfikacją przez użytkowników panelu.
          </span>
        </div>
        <Badge dot tone="success">
          kompletność 100%
        </Badge>
      </section>

      <section className="workspace-panel">
        <div className="filter-toolbar">
          <label className="search-field">
            <Search size={16} />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Szukaj po użytkowniku, działaniu, obiekcie lub IP..."
              value={query}
            />
          </label>
          <div className="filter-toolbar__select">
            <Filter size={15} />
            <select
              onChange={(event) => setSeverity(event.target.value)}
              value={severity}
            >
              <option value="all">Wszystkie poziomy</option>
              <option value="success">Sukces</option>
              <option value="info">Informacja</option>
              <option value="warning">Ostrzeżenie</option>
              <option value="error">Błąd</option>
            </select>
          </div>
          <div className="filter-toolbar__select">
            <History size={15} />
            <select defaultValue="24h">
              <option value="24h">Ostatnie 24 godziny</option>
              <option value="7d">Ostatnie 7 dni</option>
              <option value="30d">Ostatnie 30 dni</option>
            </select>
          </div>
        </div>

        <div className="audit-timeline">
          {filteredEvents.map((event) => {
            const Icon = eventIcons[event.severity];
            return (
              <article key={event.id}>
                <span className={`audit-timeline__icon audit-timeline__icon--${event.severity}`}>
                  <Icon size={16} />
                </span>
                <div className="audit-timeline__content">
                  <header>
                    <div>
                      <strong>{event.action}</strong>
                      <Badge tone={eventTones[event.severity]}>
                        {event.severity}
                      </Badge>
                    </div>
                    <time>{formatDateTime(event.createdAt)}</time>
                  </header>
                  <p>{event.target}</p>
                  <footer>
                    <span>
                      Aktor: <b>{event.actor}</b>
                    </span>
                    <span>
                      Źródło: <code>{event.ip}</code>
                    </span>
                    <span>ID: {event.id}</span>
                  </footer>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}

