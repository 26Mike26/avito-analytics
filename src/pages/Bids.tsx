import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, ShieldCheck, Wand2 } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Badge, PriorityBadge } from '../components/Badge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useStore } from '../store/useStore';
import { calculateBidRecommendation } from '../lib/recommendations';
import { formatNumber, formatRub } from '../lib/analytics';

export default function Bids() {
  const items = useStore((s) => s.items);
  const kpi = useStore((s) => s.kpi);
  const metrics = useStore((s) => s.metrics);
  const setItemBid = useStore((s) => s.setItemBid);
  const applyAll = useStore((s) => s.applyAllBidRecommendations);

  const [limit, setLimit] = useState(15);
  const [filter, setFilter] = useState<'all' | 'increase' | 'decrease' | 'thin'>('all');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [appliedCount, setAppliedCount] = useState<number | null>(null);
  const appliedResetTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (appliedResetTimer.current != null) {
        window.clearTimeout(appliedResetTimer.current);
      }
    };
  }, []);

  const showAppliedCount = (count: number) => {
    if (appliedResetTimer.current != null) {
      window.clearTimeout(appliedResetTimer.current);
    }
    setAppliedCount(count);
    appliedResetTimer.current = window.setTimeout(() => {
      setAppliedCount(null);
      appliedResetTimer.current = null;
    }, 3000);
  };

  const rows = useMemo(() => {
    return items
      // Управление ставками имеет смысл только для активных объявлений —
      // у архивных и приостановленных ставку менять некуда.
      .filter((item) => item.status === 'active')
      .map((item) => ({ item, rec: calculateBidRecommendation(item, kpi, metrics) }))
      .filter((r) => {
        if (filter === 'increase') return r.rec.diffPercent > 0;
        if (filter === 'decrease') return r.rec.diffPercent < 0;
        if (filter === 'thin') return r.rec.thinData;
        return true;
      })
      .sort((a, b) => Math.abs(b.rec.diffPercent) - Math.abs(a.rec.diffPercent));
  }, [items, kpi, filter]);

  const totalForecastSpend = rows.reduce((s, r) => s + r.rec.forecastSpend, 0);
  const totalCurrentSpend = rows.reduce((s, r) => s + r.item.spend, 0);
  const diffSpend = totalForecastSpend - totalCurrentSpend;

  return (
    <Layout
      title="Управление ставками"
      subtitle="Массовая работа со ставками и прогноз изменений"
    >
      <div className="pill-nav mb-4">
        <Link to="/items" className="pill-nav-item">
          Объявления
        </Link>
        <Link to="/bids" className="pill-nav-item active">
          Управление ставками
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div className="card p-4">
          <div className="text-xs text-ink-400">Объявлений в работе</div>
          <div className="text-2xl font-semibold text-white mt-1">
            {formatNumber(rows.length)}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-ink-400">Прогноз изменения расхода</div>
          <div
            className={`text-2xl font-semibold mt-1 ${
              diffSpend > 0 ? 'text-rose-300' : diffSpend < 0 ? 'text-emerald-300' : 'text-white'
            }`}
          >
            {diffSpend > 0 ? '+' : ''}
            {formatRub(diffSpend)}
          </div>
        </div>
        <div className="card p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-ink-400">Ограничение повышения</div>
            <div className="text-2xl font-semibold text-white mt-1">{limit}%</div>
          </div>
          <input
            type="range"
            min={5}
            max={50}
            value={limit}
            onChange={(e) => setLimit(+e.target.value)}
            className="w-32"
          />
        </div>
      </div>

      <div className="card p-4 mb-4 flex flex-wrap items-center gap-3">
        <div className="pill-nav">
          {(
            [
              ['all', 'Все'],
              ['increase', 'Повысить'],
              ['decrease', 'Снизить'],
              ['thin', 'Мало данных'],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={['pill-nav-item', filter === k ? 'active' : ''].join(' ')}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="w-full lg:w-auto lg:ml-auto flex flex-col sm:flex-row sm:items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span className="text-xs text-ink-400">
            Защита: ставки выше {limit}% или для объявлений без лидов не применяются автоматически.
          </span>
          <button className="btn-primary w-full sm:w-auto sm:shrink-0" onClick={() => setConfirmOpen(true)}>
            <Wand2 className="w-4 h-4" /> Применить все
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-th">Объявление</th>
                <th className="table-th">Категория</th>
                <th className="table-th text-right">Текущая</th>
                <th className="table-th text-right">Рекомендуемая</th>
                <th className="table-th text-right">Δ</th>
                <th className="table-th text-right">Прогноз расхода</th>
                <th className="table-th text-right">Прогноз лидов</th>
                <th className="table-th">Причина</th>
                <th className="table-th text-right">Действие</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ item, rec }) => (
                <tr key={item.id} className="table-row">
                  <td className="table-td">
                    <Link
                      to={`/items/${item.id}`}
                      className="text-white hover:text-accent font-medium"
                    >
                      {item.title}
                    </Link>
                    <div className="text-xs text-ink-400 mt-0.5">
                      {rec.thinData && (
                        <Badge tone="amber">
                          <AlertTriangle className="w-3 h-3" /> Нужно больше данных
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="table-td whitespace-nowrap">{item.category}</td>
                  <td className="table-td text-right whitespace-nowrap">
                    {item.currentBid} ₽
                  </td>
                  <td className="table-td text-right whitespace-nowrap">
                    {rec.recommended} ₽
                  </td>
                  <td className="table-td text-right whitespace-nowrap">
                    <span
                      className={
                        rec.diffPercent > 0
                          ? 'text-emerald-300'
                          : rec.diffPercent < 0
                          ? 'text-rose-300'
                          : 'text-ink-400'
                      }
                    >
                      {rec.diffPercent > 0 ? '+' : ''}
                      {rec.diffPercent}%
                    </span>
                  </td>
                  <td className="table-td text-right whitespace-nowrap">
                    {formatRub(rec.forecastSpend)}
                  </td>
                  <td className="table-td text-right whitespace-nowrap">
                    {formatNumber(rec.forecastContacts)}
                  </td>
                  <td className="table-td max-w-[360px]">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <PriorityBadge priority={rec.priority} />
                      <Badge
                        tone={
                          rec.confidence === 'high'
                            ? 'green'
                            : rec.confidence === 'medium'
                            ? 'blue'
                            : 'amber'
                        }
                      >
                        Уверенность:{' '}
                        {rec.confidence === 'high'
                          ? 'высокая'
                          : rec.confidence === 'medium'
                          ? 'средняя'
                          : 'низкая'}
                      </Badge>
                      {rec.trend === 'up' && <Badge tone="green">тренд ↑</Badge>}
                      {rec.trend === 'down' && <Badge tone="red">тренд ↓</Badge>}
                    </div>
                    <span className="text-xs text-ink-300">{rec.reason}</span>
                  </td>
                  <td className="table-td text-right">
                    <button
                      className="btn-secondary"
                      disabled={rec.diffPercent === 0}
                      onClick={() =>
                        setItemBid(
                          item.id,
                          rec.recommended,
                          `Применена рекомендация: ${rec.reason}`
                        )
                      }
                    >
                      <Check className="w-4 h-4" /> Применить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Применить все рекомендации?"
        description={`Будут применены безопасные изменения ставок: повышения не более чем на ${limit}%, и без увеличения ставок для объявлений без лидов. Все изменения попадут в историю.`}
        confirmText="Применить"
        tone="primary"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          const n = applyAll(limit);
          showAppliedCount(n);
          setConfirmOpen(false);
        }}
      />

      {appliedCount !== null && (
        <div className="fixed bottom-6 right-6 bg-emerald-500 text-white px-4 py-3 rounded-lg shadow-lg text-sm">
          Применено изменений ставок: {appliedCount}
        </div>
      )}
    </Layout>
  );
}
