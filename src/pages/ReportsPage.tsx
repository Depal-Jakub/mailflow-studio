import { useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Download,
  Gauge,
  MailCheck,
  Send,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { formatNumber, formatPercent } from "../lib/format";
import { useOperationalReport } from "../lib/reports";

const percentage = (part: number, total: number) =>
  total > 0 ? (part / total) * 100 : 0;

export function ReportsPage() {
  const [range, setRange] = useState("14");
  const { report, loading } = useOperationalReport(Number(range));

  const qualityTrend = useMemo(
    () =>
      report.daily.map((item) => ({
        day: new Intl.DateTimeFormat("pl-PL", {
          day: "2-digit",
          month: "2-digit",
        }).format(new Date(`${item.day}T12:00:00Z`)),
        precision: percentage(
          Math.max(0, item.processed - item.review - item.failed),
          item.processed,
        ),
        automation: percentage(item.automated, item.incoming),
      })),
    [report.daily],
  );
  const classificationPrecision = percentage(
    Math.max(
      0,
      report.messages.classified -
        report.messages.review -
        report.messages.failed,
    ),
    report.messages.classified,
  );
  const automationRate = percentage(
    report.messages.automated,
    report.messages.incoming,
  );
  const deliveryRate = percentage(
    report.outbound.delivered,
    report.outbound.recipients,
  );

  const exportReport = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mailflow-report-${report.range.days}d-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        actions={
          <>
            <select
              aria-label="Zakres raportu"
              onChange={(event) => setRange(event.target.value)}
              value={range}
            >
              <option value="7">Ostatnie 7 dni</option>
              <option value="14">Ostatnie 14 dni</option>
              <option value="30">Ostatnie 30 dni</option>
              <option value="90">Ostatnie 90 dni</option>
            </select>
            <Button
              disabled={loading}
              icon={Download}
              onClick={exportReport}
            >
              Eksportuj JSON
            </Button>
          </>
        }
        description="Agregaty obliczane w bazie bez limitu liczby zwracanych rekordów."
        title="Raporty"
      />

      <section className="metrics-row metrics-row--reports">
        <article className="metric-tile">
          <span className="metric-tile__icon metric-tile__icon--teal">
            <MailCheck size={21} />
          </span>
          <div>
            <span>Przetworzone wiadomości</span>
            <strong>{formatNumber(report.messages.classified)}</strong>
            <small>{formatNumber(report.messages.total)} w okresie</small>
          </div>
        </article>
        <article className="metric-tile">
          <span className="metric-tile__icon metric-tile__icon--green">
            <Gauge size={21} />
          </span>
          <div>
            <span>Bez ręcznej korekty</span>
            <strong>{formatPercent(classificationPrecision)}%</strong>
            <small>
              {formatNumber(report.messages.review)} do weryfikacji
            </small>
          </div>
        </article>
        <article className="metric-tile">
          <span className="metric-tile__icon metric-tile__icon--blue">
            <Activity size={21} />
          </span>
          <div>
            <span>Automatyzowane bez udziału</span>
            <strong>{formatPercent(automationRate)}%</strong>
            <small>
              {formatNumber(report.messages.automated)} wiadomości
            </small>
          </div>
        </article>
        <article className="metric-tile">
          <span className="metric-tile__icon metric-tile__icon--amber">
            <Send size={21} />
          </span>
          <div>
            <span>Skuteczność dostarczeń</span>
            <strong>{formatPercent(deliveryRate)}%</strong>
            <small>
              {formatNumber(report.outbound.delivered)} z{" "}
              {formatNumber(report.outbound.recipients)}
            </small>
          </div>
        </article>
      </section>

      <div className="reports-grid">
        <section className="panel report-chart report-chart--wide">
          <div className="panel__header">
            <div>
              <h2>Jakość klasyfikacji i automatyzacji</h2>
              <p>Dzienny udział spraw zakończonych bez ręcznej obsługi.</p>
            </div>
            <Badge tone={loading ? "warning" : "success"}>
              <TrendingUp size={13} />
              {loading ? "odświeżanie" : "dane aktualne"}
            </Badge>
          </div>
          <ResponsiveContainer height={300} width="100%">
            <AreaChart data={qualityTrend}>
              <defs>
                <linearGradient id="precisionFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="5%" stopColor="#109f97" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#109f97" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="automationFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e7edf2" strokeDasharray="3 3" />
              <XAxis
                axisLine={false}
                dataKey="day"
                fontSize={11}
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                domain={[0, 100]}
                fontSize={11}
                tickFormatter={(value) => `${value}%`}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{ borderRadius: 6, borderColor: "#d9e2e9" }}
                formatter={(value) => `${Number(value).toFixed(1)}%`}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area
                dataKey="precision"
                fill="url(#precisionFill)"
                name="Bez ręcznej korekty"
                stroke="#109f97"
                strokeWidth={2}
                type="monotone"
              />
              <Area
                dataKey="automation"
                fill="url(#automationFill)"
                name="Automatyzacja"
                stroke="#2563eb"
                strokeWidth={2}
                type="monotone"
              />
            </AreaChart>
          </ResponsiveContainer>
        </section>

        <section className="panel report-chart">
          <div className="panel__header">
            <div>
              <h2>Rozkład kategorii</h2>
              <p>Wiadomości w wybranym okresie.</p>
            </div>
          </div>
          <div className="report-donut">
            <ResponsiveContainer height={230} width="55%">
              <PieChart>
                <Pie
                  data={report.categories}
                  dataKey="count"
                  innerRadius={58}
                  outerRadius={86}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {report.categories.map((category) => (
                    <Cell fill={category.color} key={category.id} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => formatNumber(Number(value))}
                  contentStyle={{ borderRadius: 6, fontSize: 11 }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="report-donut__legend">
              {report.categories.slice(0, 7).map((category) => (
                <div key={category.id}>
                  <i style={{ backgroundColor: category.color }} />
                  <span>{category.name}</span>
                  <strong>{formatNumber(category.count)}</strong>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="panel report-chart report-chart--wide">
          <div className="panel__header">
            <div>
              <h2>Wydajność źródeł</h2>
              <p>Przetworzone, wymagające weryfikacji i błędne elementy.</p>
            </div>
          </div>
          <ResponsiveContainer height={280} width="100%">
            <BarChart data={report.sources} layout="vertical">
              <CartesianGrid horizontal={false} stroke="#e7edf2" />
              <XAxis
                axisLine={false}
                fontSize={11}
                tickLine={false}
                type="number"
              />
              <YAxis
                axisLine={false}
                dataKey="name"
                fontSize={11}
                tickLine={false}
                type="category"
                width={110}
              />
              <Tooltip
                contentStyle={{ borderRadius: 6, borderColor: "#d9e2e9" }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar
                dataKey="processed"
                fill="#109f97"
                name="Przetworzone"
                radius={[0, 3, 3, 0]}
                stackId="a"
              />
              <Bar
                dataKey="review"
                fill="#e5a326"
                name="Do przeglądu"
                stackId="a"
              />
              <Bar
                dataKey="errors"
                fill="#ef5a4f"
                name="Błędy"
                radius={[0, 3, 3, 0]}
                stackId="a"
              />
            </BarChart>
          </ResponsiveContainer>
        </section>

        <section className="panel quality-table-panel">
          <div className="panel__header">
            <div>
              <h2>Najczęściej trafiające reguły</h2>
              <p>Wynik oparty na zapisanej historii ocen silnika.</p>
            </div>
            <BarChart3 size={18} />
          </div>
          <div className="quality-list">
            {report.rules.slice(0, 8).map((rule, index) => {
              const rate = percentage(rule.matches, rule.evaluations);
              return (
                <div key={rule.id}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{rule.name}</strong>
                    <small>{formatNumber(rule.matches)} trafień</small>
                  </div>
                  <div className="quality-bar">
                    <span>
                      <i style={{ width: `${Math.min(rate, 100)}%` }} />
                    </span>
                    <strong>{formatPercent(rate)}%</strong>
                  </div>
                  <CheckCircle2 size={16} />
                </div>
              );
            })}
            {report.rules.length === 0 ? (
              <div className="empty-state">
                <BarChart3 size={24} />
                <strong>Brak ocen reguł w tym okresie</strong>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}
