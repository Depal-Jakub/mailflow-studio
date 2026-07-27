import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock3,
  FileSearch,
  Inbox,
  MailCheck,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Link } from "react-router";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { systemHealth, volumeData } from "../data/demo";
import { useAppState } from "../lib/AppState";
import {
  formatCountdown,
  formatNumber,
  formatPercent,
  formatTime,
} from "../lib/format";
import type { ConnectorStatus, MessageStatus } from "../types";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";

const statusLabels: Record<MessageStatus, string> = {
  new: "Nowa",
  classified: "Sklasyfikowana",
  review: "Wymaga przeglądu",
  automated: "Zautomatyzowana",
  failed: "Błąd",
  archived: "Zarchiwizowana",
};

const statusTones: Record<
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

const sourceLogos: Record<string, string> = {
  gmail: "G",
  outlook: "O",
  imap: "IM",
  webhook: "W",
  scraper: "WS",
};

const healthStatusLabel: Record<ConnectorStatus, string> = {
  active: "Aktywny",
  warning: "Ostrzeżenie",
  error: "Błąd",
  paused: "Wstrzymany",
};

export function DashboardPage() {
  const { messages, categories, sources, automations, addToast } = useAppState();
  const [healthCounters, setHealthCounters] = useState(() =>
    Object.fromEntries(
      systemHealth.map((item) => [item.key, item.countdownSeconds]),
    ),
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      setHealthCounters((current) =>
        Object.fromEntries(
          systemHealth.map((item) => {
            const previous = current[item.key] ?? item.countdownSeconds;
            return [
              item.key,
              previous <= 0 ? item.countdownSeconds : previous - 1,
            ];
          }),
        ),
      );
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const stats = useMemo(() => {
    const review = messages.filter((message) => message.status === "review").length;
    const automated = messages.filter(
      (message) => message.status === "automated",
    ).length;
    const failed = messages.filter((message) => message.status === "failed").length;
    const classified = messages.filter((message) =>
      ["classified", "review", "automated", "failed"].includes(message.status),
    ).length;
    return { review, automated, failed, classified };
  }, [messages]);

  const categoryDistribution = categories.map((category) => ({
    name: category.name,
    value: category.messageCount,
    color: category.color,
  }));

  const liveMessages = messages
    .filter((message) => message.direction === "incoming")
    .slice(0, 8);

  const runManualSync = () => {
    addToast({
      title: "Synchronizacja uruchomiona",
      message: "Wszystkie aktywne źródła zostały dodane do kolejki.",
      tone: "success",
    });
  };

  return (
    <div className="dashboard-page">
      <div className="dashboard-titlebar">
        <div>
          <h1>Pulpit operacyjny</h1>
          <p>Przetwarzanie wiadomości i automatyzacje w czasie rzeczywistym.</p>
        </div>
        <div className="dashboard-titlebar__actions">
          <select aria-label="Zakres raportu" defaultValue="14">
            <option value="7">Ostatnie 7 dni</option>
            <option value="14">Ostatnie 14 dni</option>
            <option value="30">Ostatnie 30 dni</option>
          </select>
          <Button icon={RefreshCw} onClick={runManualSync}>
            Synchronizuj
          </Button>
        </div>
      </div>

      <section className="source-strip" aria-label="Połączone źródła">
        <div className="section-heading section-heading--inline">
          <div>
            <h2>Połączone źródła</h2>
            <p>{sources.length} aktywne kanały wejściowe</p>
          </div>
          <Link to="/accounts">
            Zarządzaj <ArrowRight size={14} />
          </Link>
        </div>
        <div className="source-strip__grid">
          {sources.map((source) => (
            <article className="source-summary" key={source.id}>
              <div className={`source-logo source-logo--${source.type}`}>
                {sourceLogos[source.type]}
              </div>
              <div className="source-summary__main">
                <strong>{source.name}</strong>
                <span>{source.address}</span>
              </div>
              <div className="source-summary__numbers">
                <span>
                  <b>{formatNumber(source.unread)}</b> nowych
                </span>
                <span>{formatNumber(source.total)} łącznie</span>
              </div>
              <span
                aria-label={healthStatusLabel[source.status]}
                className={`status-dot status-dot--${source.status}`}
                title={healthStatusLabel[source.status]}
              />
            </article>
          ))}
        </div>
      </section>

      <section className="metrics-row" aria-label="Główne metryki">
        <article className="metric-tile">
          <span className="metric-tile__icon metric-tile__icon--teal">
            <Inbox size={21} />
          </span>
          <div>
            <span>Nowe wiadomości</span>
            <strong>266</strong>
            <small className="trend trend--up">+18% vs poprzedni okres</small>
          </div>
        </article>
        <article className="metric-tile">
          <span className="metric-tile__icon metric-tile__icon--green">
            <ShieldCheck size={21} />
          </span>
          <div>
            <span>Automatycznie sklasyfikowane</span>
            <strong>87,4%</strong>
            <small className="trend trend--up">+2,6 pp jakości</small>
          </div>
        </article>
        <article className="metric-tile">
          <span className="metric-tile__icon metric-tile__icon--amber">
            <Clock3 size={21} />
          </span>
          <div>
            <span>Wymagają przeglądu</span>
            <strong>{stats.review + 32}</strong>
            <small className="trend trend--down">-12% tydzień do tygodnia</small>
          </div>
        </article>
        <article className="metric-tile">
          <span className="metric-tile__icon metric-tile__icon--blue">
            <Bot size={21} />
          </span>
          <div>
            <span>Automatyzacje zakończone</span>
            <strong>128</strong>
            <small className="trend trend--up">+24% w tym okresie</small>
          </div>
        </article>
        <article className="metric-tile">
          <span className="metric-tile__icon metric-tile__icon--coral">
            <AlertTriangle size={21} />
          </span>
          <div>
            <span>Błędy zadań</span>
            <strong>{stats.failed + 6}</strong>
            <small className="trend trend--down">-22% vs poprzedni okres</small>
          </div>
        </article>
      </section>

      <div className="dashboard-grid">
        <div className="dashboard-grid__main">
          <section className="panel analytics-panel">
            <div className="panel__header">
              <div>
                <h2>Przepływ przetwarzania</h2>
                <p>Od pobrania do wykonania automatyzacji.</p>
              </div>
              <Badge tone="success" dot>
                system działa
              </Badge>
            </div>
            <div className="analytics-panel__body">
              <div className="funnel">
                {[
                  {
                    label: "Pobrane",
                    count: 9860,
                    percent: 100,
                    color: "#109f97",
                    icon: Inbox,
                  },
                  {
                    label: "Sparsowane",
                    count: 9742,
                    percent: 98.8,
                    color: "#55b84d",
                    icon: FileSearch,
                  },
                  {
                    label: "Sklasyfikowane",
                    count: 8618,
                    percent: 87.4,
                    color: "#2473c8",
                    icon: MailCheck,
                  },
                  {
                    label: "Wymagają przeglądu",
                    count: 1124,
                    percent: 11.4,
                    color: "#e9a51b",
                    icon: Clock3,
                  },
                  {
                    label: "Zautomatyzowane",
                    count: 8126,
                    percent: 82.4,
                    color: "#2d9c67",
                    icon: Sparkles,
                  },
                ].map((step) => {
                  const Icon = step.icon;
                  return (
                    <div className="funnel__row" key={step.label}>
                      <span
                        className="funnel__icon"
                        style={{ color: step.color }}
                      >
                        <Icon size={17} />
                      </span>
                      <div className="funnel__label">
                        <strong>{step.label}</strong>
                        <span>{formatPercent(step.percent)}% całości</span>
                      </div>
                      <div className="funnel__bar">
                        <span
                          style={{
                            backgroundColor: step.color,
                            width: `${step.percent}%`,
                          }}
                        />
                      </div>
                      <b>{formatNumber(step.count)}</b>
                    </div>
                  );
                })}
              </div>

              <div className="volume-chart">
                <div className="chart-title">
                  <div>
                    <h3>Wolumen wiadomości</h3>
                    <span>Ostatnie 14 dni</span>
                  </div>
                </div>
                <ResponsiveContainer height={260} width="100%">
                  <ComposedChart data={volumeData}>
                    <CartesianGrid stroke="#e7edf2" strokeDasharray="3 3" />
                    <XAxis
                      axisLine={false}
                      dataKey="day"
                      fontSize={11}
                      tickLine={false}
                    />
                    <YAxis axisLine={false} fontSize={11} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        border: "1px solid #d9e2e9",
                        borderRadius: 6,
                        boxShadow: "0 8px 30px rgba(13, 33, 46, .1)",
                        fontSize: 12,
                      }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                    <Bar
                      dataKey="messages"
                      fill="#10a39b"
                      maxBarSize={30}
                      name="Wiadomości"
                      radius={[3, 3, 0, 0]}
                    />
                    <Line
                      dataKey="average"
                      dot={{ r: 2.5 }}
                      name="Średnia 7 dni"
                      stroke="#143f63"
                      strokeWidth={2}
                      type="monotone"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          <section className="panel queue-panel">
            <div className="panel__header">
              <div>
                <h2>Kolejka na żywo</h2>
                <p>Najnowsze wiadomości z wszystkich źródeł.</p>
              </div>
              <Link className="text-link" to="/messages">
                Zobacz wszystkie <ArrowRight size={14} />
              </Link>
            </div>
            <div className="table-wrap">
              <table className="data-table data-table--compact">
                <thead>
                  <tr>
                    <th>Nadawca</th>
                    <th>Temat</th>
                    <th>Kategoria</th>
                    <th>Wynik</th>
                    <th>Źródło</th>
                    <th>Odebrano</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {liveMessages.map((message) => {
                    const category = categories.find(
                      (item) => item.id === message.categoryId,
                    );
                    const source = sources.find(
                      (item) => item.id === message.sourceId,
                    );
                    return (
                      <tr key={message.id}>
                        <td>
                          <strong className="cell-primary">
                            {message.senderName}
                          </strong>
                          <span className="cell-secondary">{message.sender}</span>
                        </td>
                        <td className="subject-cell">{message.subject}</td>
                        <td>
                          {category ? (
                            <span
                              className="category-label"
                              style={{
                                backgroundColor: `${category.color}15`,
                                borderColor: `${category.color}45`,
                                color: category.color,
                              }}
                            >
                              {category.name}
                            </span>
                          ) : (
                            <span className="cell-secondary">Bez kategorii</span>
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
                          <span className={`mini-source mini-source--${source?.type}`}>
                            {source ? sourceLogos[source.type] : "?"}
                          </span>
                        </td>
                        <td>{formatTime(message.receivedAt)}</td>
                        <td>
                          <Badge tone={statusTones[message.status]} dot>
                            {statusLabels[message.status]}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="dashboard-rail">
          <section className="panel health-panel">
            <div className="panel__header">
              <div>
                <h2>Stan systemu</h2>
                <p>Usługi i harmonogramy.</p>
              </div>
              <Wifi size={18} className="text-success" />
            </div>
            <div className="health-list">
              {systemHealth.map((item) => (
                <div className="health-item" key={item.key}>
                  <span className="health-item__icon">
                    {item.status === "error" ? (
                      <WifiOff size={18} />
                    ) : (
                      <Wifi size={18} />
                    )}
                  </span>
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                  </div>
                  <div className="health-item__state">
                    <Badge tone="success" dot>
                      {healthStatusLabel[item.status]}
                    </Badge>
                    <time>{formatCountdown(healthCounters[item.key] ?? 0)}</time>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel activity-panel">
            <div className="panel__header">
              <div>
                <h2>Ostatnie automatyzacje</h2>
                <p>Aktualna aktywność przepływów.</p>
              </div>
            </div>
            <div className="activity-list">
              {automations.slice(0, 4).map((automation) => (
                <div className="activity-row" key={automation.id}>
                  <span className="activity-row__icon">
                    <CheckCircle2 size={16} />
                  </span>
                  <div>
                    <strong>{automation.name}</strong>
                    <span>{formatTime(automation.lastRunAt)}</span>
                  </div>
                  <Badge tone="success">Sukces</Badge>
                </div>
              ))}
            </div>
            <Link className="panel-link" to="/automations">
              Przejdź do automatyzacji <ArrowRight size={14} />
            </Link>
          </section>

          <section className="panel distribution-panel">
            <div className="panel__header">
              <div>
                <h2>Dystrybucja kategorii</h2>
                <p>Udział wiadomości w 14 dniach.</p>
              </div>
            </div>
            <div className="distribution-panel__body">
              <ResponsiveContainer height={170} width="48%">
                <PieChart>
                  <Pie
                    data={categoryDistribution}
                    dataKey="value"
                    innerRadius={42}
                    outerRadius={68}
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {categoryDistribution.map((entry) => (
                      <Cell fill={entry.color} key={entry.name} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => formatNumber(Number(value))}
                    contentStyle={{ borderRadius: 6, fontSize: 11 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="distribution-legend">
                {categoryDistribution.slice(0, 5).map((entry) => (
                  <div key={entry.name}>
                    <span style={{ background: entry.color }} />
                    <strong>{entry.name}</strong>
                    <b>{formatNumber(entry.value)}</b>
                  </div>
                ))}
              </div>
            </div>
            <div className="distribution-panel__footer">
              <Users size={15} />
              {formatNumber(
                categoryDistribution.reduce((sum, item) => sum + item.value, 0),
              )}{" "}
              wiadomości
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
