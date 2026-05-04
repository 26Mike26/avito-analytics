import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Coins,
  Eye,
  Gift,
  Heart,
  Phone,
  PiggyBank,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { KpiCard } from '../components/KpiCard';
import { ProgressBar } from '../components/ProgressBar';
import { Badge, PriorityBadge } from '../components/Badge';
import { PeriodPicker } from '../components/PeriodPicker';
import { useStore } from '../store/useStore';
import {
  calculateAccountStats,
  classifyItem,
  formatNumber,
  formatPercent,
  formatRub,
  calcCpl,
  itemsInDateRange,
  lastNDaysRange,
  regionAverages,
} from '../lib/analytics';
import { MapPin } from 'lucide-react';

export default function Dashboard() {
  const allItems = useStore((s) => s.items);
  const metrics = useStore((s) => s.metrics);
  const kpi = useStore((s) => s.kpi);
  const recommendations = useStore((s) => s.recommendations);
  const balance = useStore((s) => s.balance);
  const accountCharges = useStore((s) => s.accountCharges);

  const [period, setPeriod] = useState(() => lastNDaysRange(30));

  // Items с реальными суммами за выбранный период
  const items = useMemo(
    () => itemsInDateRange(allItems, metrics, period.from, period.to),
    [allItems, metrics, period.from, period.to]
  );
  // Общие расходы аккаунта (рассылки, прочие услуги без itemId) за период
  const accountSpendInPeriod = useMemo(
    () =>
      accountCharges
        .filter((c) => c.date >= period.from && c.date <= period.to)
        .reduce((s, c) => s + c.amount, 0),
    [accountCharges, period.from, period.to]
  );
  const stats = calculateAccountStats(items, kpi);
  const totalSpendWithAccount = stats.totalSpend + accountSpendInPeriod;

  const sortedByEfficiency = [...items]
    .filter((i) => i.contacts > 0)
    .sort((a, b) => {
      const ca = calcCpl(a.spend, a.contacts) ?? Infinity;
      const cb = calcCpl(b.spend, b.contacts) ?? Infinity;
      return ca - cb;
    });
  const top5 = sortedByEfficiency.slice(0, 5);
  const overspend = [...items]
    .filter((i) => classifyItem(i, kpi) === 'overspend' || classifyItem(i, kpi) === 'noLeads')
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 5);

  const todayRecs = recommendations
    .filter((r) => r.status === 'new')
    .slice(0, 6);

  // Города с перерасходом (CPL > target). Сортируем по сумме расхода вниз,
  // чтобы дорогие города были вверху.
  const cityStats = useMemo(() => {
    const list = regionAverages(items);
    return list
      .map((r) => ({
        ...r,
        overspend:
          r.cpl != null && r.cpl > kpi.targetCpl
            ? r.cpl - kpi.targetCpl
            : 0,
      }))
      .sort((a, b) => b.spend - a.spend);
  }, [items, kpi]);
  const overspendCities = cityStats.filter((c) => c.overspend > 0).slice(0, 5);

  const balanceTotal = balance ? balance.real + balance.bonus : null;

  return (
    <Layout
      title="Дашборд аккаунта"
      subtitle={`Сводка за период ${period.from} — ${period.to}`}
    >
      {/* ─── Выбор периода ─── */}
      <div className="card p-3 sm:p-4 mb-4">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {/* ─── Баланс кошелька (только если режим API и баланс получен) ─── */}
      {balance && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <BalanceCard
            label="Реальный баланс"
            icon={<Wallet className="w-4 h-4" />}
            value={formatRub(balance.real)}
            hint="Доступные деньги на счёте Авито"
            tone="white"
          />
          <BalanceCard
            label="Бонусные средства"
            icon={<Gift className="w-4 h-4" />}
            value={formatRub(balance.bonus)}
            hint="Промо-баллы / бонусы Авито"
            tone="violet"
          />
          <BalanceCard
            label="CPA-аванс"
            icon={<PiggyBank className="w-4 h-4" />}
            value={balance.advance > 0 ? formatRub(balance.advance) : '—'}
            hint={
              balance.advance > 0
                ? 'Зарезервировано под целевые действия'
                : 'CPA-программа к аккаунту не подключена'
            }
            tone="orange"
          />
          {balanceTotal != null && (
            <div className="sm:col-span-3 text-xs text-ink-400 -mt-1">
              Всего на аккаунте:{' '}
              <span className="text-white font-semibold">
                {formatRub(balanceTotal + balance.advance)}
              </span>
              {' · '}
              обновлено {new Date(balance.fetchedAt).toLocaleString('ru-RU')}
            </div>
          )}
        </div>
      )}

      {/* Когда есть общие расходы (рассылки и пр.) — показываем разбивку отдельным блоком */}
      {accountSpendInPeriod > 0 && (
        <div className="card border border-amber-500/30 bg-amber-500/5 p-3 mb-4 flex flex-wrap items-center gap-3 text-sm">
          <Coins className="w-4 h-4 text-amber-300" />
          <span className="text-ink-300">За период {period.from} — {period.to}:</span>
          <span className="text-white font-semibold">
            расход на объявления {formatRub(stats.totalSpend)}
          </span>
          <span className="text-ink-500">+</span>
          <span className="text-white font-semibold">
            общие (рассылки/пр.) {formatRub(accountSpendInPeriod)}
          </span>
          <span className="text-ink-500">=</span>
          <span className="text-amber-200 font-bold">
            {formatRub(totalSpendWithAccount)}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Расход"
          value={formatRub(totalSpendWithAccount)}
          icon={Coins}
          hint={
            accountSpendInPeriod > 0
              ? `Объявления ${formatRub(stats.totalSpend)} + общие ${formatRub(accountSpendInPeriod)}`
              : `${formatPercent(stats.budgetUsage, 0)} от месячного бюджета`
          }
          tone={stats.budgetUsage > 100 ? 'bad' : stats.budgetUsage > 85 ? 'warn' : 'default'}
        />
        <KpiCard
          label="Просмотры"
          value={formatNumber(stats.totalViews)}
          icon={Eye}
          hint={`${items.length} объявлений в работе`}
        />
        <KpiCard
          label="Контакты / лиды"
          value={formatNumber(stats.totalContacts)}
          icon={Phone}
          hint={
            stats.averageConversion != null
              ? `Конверсия: ${formatPercent(stats.averageConversion)}`
              : 'Недостаточно данных'
          }
        />
        <KpiCard
          label="Избранное"
          value={formatNumber(stats.totalFavorites)}
          icon={Heart}
          hint="Сигнал интереса покупателей"
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Средний CPL"
          value={stats.averageCpl != null ? formatRub(stats.averageCpl) : '—'}
          hint={`Цель: ${formatRub(kpi.targetCpl)}`}
          tone={
            stats.averageCpl == null
              ? 'default'
              : stats.averageCpl <= kpi.targetCpl
              ? 'good'
              : stats.averageCpl > kpi.targetCpl * 1.2
              ? 'bad'
              : 'warn'
          }
        />
        <KpiCard
          label="Конверсия"
          value={
            stats.averageConversion != null ? formatPercent(stats.averageConversion) : '—'
          }
          hint={`Цель: ${formatPercent(kpi.targetConversionRate)}`}
          tone={
            stats.averageConversion == null
              ? 'default'
              : stats.averageConversion >= kpi.targetConversionRate
              ? 'good'
              : 'warn'
          }
        />
        <KpiCard
          label="Выручка"
          value={stats.totalRevenue > 0 ? formatRub(stats.totalRevenue) : '—'}
          hint={
            stats.totalRevenue > 0
              ? 'Указана вручную в карточках'
              : 'Заполните выручку для расчёта ROI'
          }
        />
        <KpiCard
          label="ROI / ROAS"
          value={
            stats.roi != null
              ? `${formatPercent(stats.roi, 0)} / ${stats.roas?.toFixed(2)}`
              : '—'
          }
          hint={`Цель ROI: ${formatPercent(kpi.targetRoi, 0)}`}
          tone={
            stats.roi == null
              ? 'default'
              : stats.roi >= kpi.targetRoi
              ? 'good'
              : stats.roi >= 0
              ? 'warn'
              : 'bad'
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white">Выполнение KPI</h2>
            <Link to="/kpi" className="text-sm text-accent hover:underline">
              Изменить цели →
            </Link>
          </div>
          <KpiProgress
            label="Лиды"
            current={`${formatNumber(stats.totalContacts)} / ${formatNumber(kpi.targetLeads)}`}
            value={stats.leadsProgress}
          />
          <KpiProgress
            label="CPL"
            current={
              stats.averageCpl != null
                ? `${formatRub(stats.averageCpl)} → цель ${formatRub(kpi.targetCpl)}`
                : 'Нет данных'
            }
            value={stats.cplProgress ?? 0}
            inverse={stats.averageCpl != null && stats.averageCpl > kpi.targetCpl}
          />
          <KpiProgress
            label="Конверсия"
            current={
              stats.averageConversion != null
                ? `${formatPercent(stats.averageConversion)} → цель ${formatPercent(
                    kpi.targetConversionRate
                  )}`
                : 'Нет данных'
            }
            value={stats.conversionProgress ?? 0}
          />
          <KpiProgress
            label="Бюджет месяца"
            current={`${formatRub(stats.totalSpend)} / ${formatRub(kpi.monthlyBudget)}`}
            value={stats.budgetUsage}
            inverse={stats.budgetUsage > 100}
          />
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <h2 className="font-semibold text-white">Предупреждения</h2>
          </div>
          {stats.warnings.length === 0 ? (
            <div className="flex items-start gap-2 text-sm text-emerald-300 bg-emerald-500/10 rounded-lg p-3">
              <CheckCircle2 className="w-4 h-4 mt-0.5" />
              Серьёзных проблем не обнаружено. Аккаунт работает в пределах KPI.
            </div>
          ) : (
            <ul className="space-y-2">
              {stats.warnings.map((w, i) => (
                <li
                  key={i}
                  className="text-sm text-ink-100 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3"
                >
                  {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <TopList
          title="Топ-5 лучших объявлений"
          icon={<TrendingUp className="w-4 h-4 text-emerald-300" />}
          tone="green"
          items={top5}
        />
        <TopList
          title="Топ-5 с перерасходом"
          icon={<TrendingDown className="w-4 h-4 text-rose-300" />}
          tone="red"
          items={overspend}
        />
      </div>

      {/* Города с перерасходом */}
      {cityStats.length > 0 && (
        <div className="card p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <MapPin className="w-4 h-4 text-accent" />
            <h2 className="font-semibold text-white">Статистика по городам</h2>
            {overspendCities.length > 0 && (
              <Badge tone="red">
                {overspendCities.length} с перерасходом
              </Badge>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="table-th">Город</th>
                  <th className="table-th text-right">Расход</th>
                  <th className="table-th text-right">Контактов</th>
                  <th className="table-th text-right">CPL</th>
                  <th className="table-th text-right">Конверсия</th>
                  <th className="table-th">Статус</th>
                </tr>
              </thead>
              <tbody>
                {cityStats.slice(0, 10).map((c) => {
                  const isOverspend = c.overspend > 0;
                  return (
                    <tr key={c.region} className="table-row">
                      <td className="table-td font-medium text-white">{c.region}</td>
                      <td className="table-td text-right">{formatRub(c.spend)}</td>
                      <td className="table-td text-right">
                        {formatNumber(c.contacts)}
                      </td>
                      <td
                        className={`table-td text-right ${
                          isOverspend ? 'text-rose-300 font-semibold' : ''
                        }`}
                      >
                        {c.cpl != null ? formatRub(c.cpl) : '—'}
                      </td>
                      <td className="table-td text-right">
                        {c.conversion != null
                          ? formatPercent(c.conversion)
                          : '—'}
                      </td>
                      <td className="table-td">
                        {isOverspend ? (
                          <Badge tone="red">
                            +{formatRub(c.overspend)} к цели
                          </Badge>
                        ) : c.cpl != null && c.cpl <= kpi.targetCpl ? (
                          <Badge tone="green">в норме</Badge>
                        ) : (
                          <Badge tone="gray">нет лидов</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {cityStats.length > 10 && (
            <div className="text-xs text-ink-400 mt-2">
              Показано 10 из {cityStats.length} городов. Полная разбивка — на
              странице «Аналитика».
            </div>
          )}
        </div>
      )}

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-white">Рекомендации на сегодня</h2>
          <Link to="/recommendations" className="text-sm text-accent hover:underline">
            Все рекомендации →
          </Link>
        </div>
        {todayRecs.length === 0 ? (
          <div className="text-sm text-ink-400">
            Новых рекомендаций нет. Рекомендации обновятся после изменения KPI или загрузки новых данных.
          </div>
        ) : (
          <div className="space-y-2">
            {todayRecs.map((r) => (
              <div
                key={r.id}
                className="flex items-start justify-between gap-4 border-b border-ink-800 last:border-0 pb-3 last:pb-0"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <PriorityBadge priority={r.priority} />
                    <Badge tone="blue">{groupLabel(r.type)}</Badge>
                  </div>
                  <div className="text-sm font-medium text-white">{r.title}</div>
                  <div className="text-xs text-ink-400 mt-0.5 truncate">
                    {r.description}
                  </div>
                </div>
                <Link
                  to={r.itemId ? `/items/${r.itemId}` : '/recommendations'}
                  className="btn-secondary shrink-0"
                >
                  Открыть
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

function KpiProgress({
  label,
  current,
  value,
  inverse,
}: {
  label: string;
  current: string;
  value: number;
  inverse?: boolean;
}) {
  const tone =
    value >= 95 && !inverse ? 'green' : value >= 70 && !inverse ? 'blue' : inverse ? 'rose' : 'amber';
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center justify-between text-sm mb-1.5">
        <div className="text-ink-300">{label}</div>
        <div className="text-white font-medium">{current}</div>
      </div>
      <ProgressBar value={value} tone={tone} />
    </div>
  );
}

function TopList({
  title,
  icon,
  items,
  tone,
}: {
  title: string;
  icon: React.ReactNode;
  items: { id: string; title: string; spend: number; contacts: number }[];
  tone: 'green' | 'red';
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h2 className="font-semibold text-white">{title}</h2>
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-ink-400">Подходящих объявлений нет.</div>
      ) : (
        <ul className="divide-y divide-ink-800">
          {items.map((it) => {
            const cpl = calcCpl(it.spend, it.contacts);
            return (
              <li key={it.id} className="py-2.5 flex items-center justify-between gap-3">
                <Link
                  to={`/items/${it.id}`}
                  className="text-sm text-white hover:text-accent truncate"
                >
                  {it.title}
                </Link>
                <div className="flex items-center gap-3 shrink-0 text-xs">
                  <span className="text-ink-400">
                    {formatNumber(it.contacts)} лидов · {formatRub(it.spend)}
                  </span>
                  <Badge tone={tone === 'green' ? 'green' : 'red'}>
                    {cpl != null ? formatRub(cpl) : 'нет лидов'}
                  </Badge>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function groupLabel(t: string) {
  switch (t) {
    case 'bid':
      return 'Ставка';
    case 'budget':
      return 'Бюджет';
    case 'content':
      return 'Контент';
    case 'price':
      return 'Цена';
    case 'kpi':
      return 'KPI';
    default:
      return 'Аккаунт';
  }
}

function BalanceCard({
  label,
  icon,
  value,
  hint,
  tone,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  hint: string;
  tone: 'white' | 'violet' | 'orange';
}) {
  const accent =
    tone === 'orange'
      ? 'text-accent border-accent/30 bg-accent/5'
      : tone === 'violet'
      ? 'text-violet-300 border-violet-500/30 bg-violet-500/5'
      : 'text-white border-ink-700 bg-ink-850';
  return (
    <div className={`card border ${accent} p-4`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-ink-400">
        <span className={tone === 'white' ? 'text-ink-300' : ''}>{icon}</span>
        {label}
      </div>
      <div className="text-2xl font-extrabold mt-2">{value}</div>
      <div className="text-xs text-ink-400 mt-1">{hint}</div>
    </div>
  );
}
