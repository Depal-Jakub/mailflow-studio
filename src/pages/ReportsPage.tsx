import { useState } from "react";
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Download,
  Gauge,
  MailCheck,
  TimerReset,
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
import { categories, volumeData } from "../data/demo";
import { formatNumber } from "../lib/format";

const sourcePerformance = [
  { source: "Gmail Support", processed: 8542, errors: 32, review: 384 },
  { source: "Outlook Sales", processed: 6231, errors: 18, review: 217 },
  { source: "Info Contact", processed: 3187, errors: 41, review: 298 },
  { source: "Web scraper", processed: 1942, errors: 12, review: 89 },
];

const qualityTrend = volumeData.map((item, index) => ({
  day: item.day,
  precision: 84 + ((index * 7) % 11) + index * 0.22,
  automation: 77 + ((index * 5) % 12) + index * 0.26,
}));

export function ReportsPage() {
  const [range, setRange] = useState("14");

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
            <Button icon={Download}>Eksportuj raport</Button>
          </>
        }
        description="Jakość klasyfikacji, wydajność automatyzacji i kondycja kanałów."
        title="Raporty"
      />

      <section className="metrics-row metrics-row--reports">
        <article className="metric-tile">
          <span className="metric-tile__icon metric-tile__icon--teal">
            <MailCheck size={21} />
          </span>
          <div>
            <span>Przetworzone wiadomości</span>
            <strong>19 902</strong>
            <small className="trend trend--up">+14,8% vs poprzedni okres</small>
          </div>
        </article>
        <article className="metric-tile">
          <span className="metric-tile__icon metric-tile__icon--green">
            <Gauge size={21} />
          </span>
          <div>
            <span>Precyzja klasyfikacji</span>
            <strong>92,7%</strong>
            <small className="trend trend--up">+3,1 pp po korektach</small>
          </div>
        </article>
        <article className="metric-tile">
          <span className="metric-tile__icon metric-tile__icon--blue">
            <Activity size={21} />
          </span>
          <div>
            <span>Automatyzowane bez udziału</span>
            <strong>81,9%</strong>
            <small className="trend trend--up">+6,4 pp w 30 dni</small>
          </div>
        </article>
        <article className="metric-tile">
          <span className="metric-tile__icon metric-tile__icon--amber">
            <TimerReset size={21} />
          </span>
          <div>
            <span>Średni czas obsługi</span>
            <strong>3m 42s</strong>
            <small className="trend trend--up">-38 s szybciej</small>
          </div>
        </article>
      </section>

      <div className="reports-grid">
        <section className="panel report-chart report-chart--wide">
          <div className="panel__header">
            <div>
              <h2>Jakość klasyfikacji i automatyzacji</h2>
              <p>Odsetek poprawnych dopasowań oraz obsługi bez udziału człowieka.</p>
            </div>
            <Badge tone="success">
              <TrendingUp size={13} /> trend rosnący
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
              <XAxis axisLine={false} dataKey="day" fontSize={11} tickLine={false} />
              <YAxis
                axisLine={false}
                domain={[70, 100]}
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
                name="Precyzja klasyfikacji"
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
              <p>Całkowity udział w bazie.</p>
            </div>
          </div>
          <div className="report-donut">
            <ResponsiveContainer height={230} width="55%">
              <PieChart>
                <Pie
                  data={categories}
                  dataKey="messageCount"
                  innerRadius={58}
                  outerRadius={86}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {categories.map((category) => (
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
              {categories.map((category) => (
                <div key={category.id}>
                  <i style={{ backgroundColor: category.color }} />
                  <span>{category.name}</span>
                  <strong>{formatNumber(category.messageCount)}</strong>
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
            <BarChart data={sourcePerformance} layout="vertical">
              <CartesianGrid horizontal={false} stroke="#e7edf2" />
              <XAxis axisLine={false} fontSize={11} tickLine={false} type="number" />
              <YAxis
                axisLine={false}
                dataKey="source"
                fontSize={11}
                tickLine={false}
                type="category"
                width={110}
              />
              <Tooltip contentStyle={{ borderRadius: 6, borderColor: "#d9e2e9" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar
                dataKey="processed"
                fill="#109f97"
                name="Przetworzone"
                radius={[0, 3, 3, 0]}
                stackId="a"
              />
              <Bar dataKey="review" fill="#e5a326" name="Do przeglądu" stackId="a" />
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
              <h2>Najskuteczniejsze reguły</h2>
              <p>Ocena jakości po ręcznych korektach.</p>
            </div>
            <BarChart3 size={18} />
          </div>
          <div className="quality-list">
            {[
              ["Faktury do opłacenia", 98.8, 982],
              ["Błędy dostarczeń (NDR)", 97.6, 421],
              ["Zapytania ofertowe", 95.4, 756],
              ["Pilne reklamacje", 93.9, 1248],
              ["Wiadomości partnerskie", 91.2, 643],
            ].map(([name, score, hits], index) => (
              <div key={name as string}>
                <span>{index + 1}</span>
                <div>
                  <strong>{name as string}</strong>
                  <small>{formatNumber(hits as number)} trafień</small>
                </div>
                <div className="quality-bar">
                  <span>
                    <i style={{ width: `${score as number}%` }} />
                  </span>
                  <strong>{score as number}%</strong>
                </div>
                <CheckCircle2 size={16} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

