import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Coins,
  Eye,
  Gift,
  Heart,
  Loader2,
  Phone,
  PiggyBank,
  TrendingDown,
  TrendingUp,
  Wallet,
  Wand2,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { KpiCard } from '../components/KpiCard';
import { ProgressBar } from '../components/ProgressBar';
import { Badge, PriorityBadge } from '../components/Badge';
import { PeriodPicker } from '../components/PeriodPicker';
import { useStore } from '../store/useStore';
import {
  calculateAccountStats,
  formatNumber,
  formatPercent,
  formatRub,
  calcCpl,
  calcCtr,
  itemsInDateRange,
  regionAverages,
  scaleKpiForPeriod,
} from '../lib/analytics';
import { MapPin } from 'lucide-react';

type PreciseStats = {
  spend: number;
  contacts: number;
  views: number;
  impressions: number;
  favorites: number;
};

type PreciseCityStats = PreciseStats;
type PreciseItemStats = PreciseStats;

export default function Dashboard() {
  const allItems = useStore((s) => s.items);
  const metrics = useStore((s) => s.metrics);
  const kpi = useStore((s) => s.kpi);
  const recommendations = useStore((s) => s.recommendations);
  const balance = useStore((s) => s.balance);
  const accountCharges = useStore((s) => s.accountCharges);
  const hasPerItemSpend = useStore((s) => s.hasPerItemSpend);
  const spendings = useStore((s) => s.spendings);
  const adapter = useStore((s) => s.adapter);
  const currentAccountId = useStore((s) => s.currentAccountId);
  const period = useStore((s) => s.analyticsPeriod);
  const setPeriod = useStore((s) => s.setAnalyticsPeriod);
  const periodKpi = useMemo(
    () => scaleKpiForPeriod(kpi, period.from, period.to),
    [kpi, period.from, period.to]
  );
  const [preciseCityStats, setPreciseCityStats] = useState<Map<string, PreciseCityStats>>(new Map());
  const [preciseCitiesProgress, setPreciseCitiesProgress] = useState({
    busy: false,
    done: 0,
    total: 0,
    nextEta: undefined as number | undefined,
    error: undefined as string | undefined,
  });
  const [preciseItemStats, setPreciseItemStats] = useState<Map<string, PreciseItemStats>>(new Map());
  const [preciseItemsProgress, setPreciseItemsProgress] = useState({
    busy: false,
    done: 0,
    total: 0,
    nextEta: undefined as number | undefined,
    error: undefined as string | undefined,
  });

  useEffect(() => {
    setPreciseCityStats(new Map());
    setPreciseCitiesProgress({
      busy: false,
      done: 0,
      total: 0,
      nextEta: undefined,
      error: undefined,
    });
    setPreciseItemStats(new Map());
    setPreciseItemsProgress({
      busy: false,
      done: 0,
      total: 0,
      nextEta: undefined,
      error: undefined,
    });
  }, [currentAccountId, period.from, period.to]);

  // Разбиваем расходы из operations_history на 3 группы за выбранный период:
  //  - promotion_pool: пополнения CPA/CPx-аванса = расход на рекламу
  //  - account_other: подписки/инструменты/прочие услуги
  //  - refund: сторно (вычитается из рекламного пула)
  const chargesInPeriod = useMemo(
    () => accountCharges.filter((c) => c.date >= period.from && c.date <= period.to),
    [accountCharges, period.from, period.to]
  );
  const promotionPoolSpend = useMemo(
    () =>
      // Если v2 уже дал точные per-item spend — CPx-пул учтён в items.spend,
      // в плашке его повторно не показываем.
      hasPerItemSpend
        ? 0
        : chargesInPeriod
            .filter((c) => c.kind === 'promotion_pool' || c.kind === 'refund')
            .reduce((s, c) => s + c.amount, 0),
    [chargesInPeriod, hasPerItemSpend]
  );
  const accountOtherSpend = useMemo(
    () =>
      chargesInPeriod
        .filter((c) => c.kind === 'account_other')
        .reduce((s, c) => s + c.amount, 0),
    [chargesInPeriod]
  );
  // Разбивка из /stats/v2/spendings (если доступно) — для отображения деталей
  // и включения commission/rest в полный CPL.
  const spendingsInPeriod = useMemo(() => {
    if (!spendings) return null;
    const inRange = spendings.byDate.filter(
      (d) => d.date >= period.from && d.date <= period.to
    );
    const promo = inRange.reduce((s, d) => s + d.promotion, 0);
    const pres = inRange.reduce((s, d) => s + d.presence, 0);
    const tot = inRange.reduce((s, d) => s + d.total, 0);
    const ads = promo + pres;
    return { ads, promotion: promo, presence: pres, other: tot - ads, total: tot };
  }, [spendings, period.from, period.to]);

  // Точная сумма расхода на рекламу за период из /stats/v2/spendings.
  // Считаем ДО useMemo для items, чтобы передать ads в распределение.
  const adsTotalFromSpendings = useMemo(() => {
    if (!spendings) return null;
    const inRange = spendings.byDate.filter(
      (d) => d.date >= period.from && d.date <= period.to
    );
    return inRange.reduce((s, d) => s + d.ads, 0);
  }, [spendings, period.from, period.to]);
  const otherSpend = spendingsInPeriod
    ? spendingsInPeriod.other
    : Math.max(0, accountOtherSpend);

  // Items с реальными суммами за выбранный период.
  // Если /stats/v2/spendings доступен — распределяем точное ads (promotion+presence)
  // и commission/rest пропорционально показам. Иначе fallback на operations_history.
  const periodItems = useMemo(
    () =>
      itemsInDateRange(
        allItems,
        metrics,
        period.from,
        period.to,
        accountCharges,
        hasPerItemSpend,
        adsTotalFromSpendings,
        otherSpend
      ),
    [
      allItems,
      metrics,
      period.from,
      period.to,
      accountCharges,
      hasPerItemSpend,
      adsTotalFromSpendings,
      otherSpend,
    ]
  );
  const items = useMemo(
    () =>
      periodItems.map((item) => {
        const precise = preciseItemStats.get(String(item.id));
        if (!precise) return item;
        return {
          ...item,
          views: precise.views,
          impressions: precise.impressions || undefined,
          contacts: precise.contacts,
          favorites: precise.favorites,
          spend: Math.round(precise.spend),
        };
      }),
    [periodItems, preciseItemStats]
  );
  const stats = calculateAccountStats(items, periodKpi);
  const totalSpendWithAccount = stats.totalSpend;
  const adsSpend = Math.max(0, totalSpendWithAccount - otherSpend);

  const itemsWithSpend = [...items].filter((item) => item.spend > 0);
  const successfulItems = itemsWithSpend
    .filter((item) => {
      const cpl = calcCpl(item.spend, item.contacts);
      return cpl != null && cpl <= kpi.targetCpl;
    })
    .sort((a, b) => (calcCpl(a.spend, a.contacts) ?? Infinity) - (calcCpl(b.spend, b.contacts) ?? Infinity));
  const ineffectiveItems = itemsWithSpend
    .filter((item) => {
      const cpl = calcCpl(item.spend, item.contacts);
      return cpl == null || cpl > kpi.targetCpl;
    })
    .sort((a, b) => {
      const ac = calcCpl(a.spend, a.contacts);
      const bc = calcCpl(b.spend, b.contacts);
      if (ac == null && bc != null) return -1;
      if (bc == null && ac != null) return 1;
      return (bc ?? 0) - (ac ?? 0);
    });

  const todayRecs = recommendations
    .filter((r) => r.status === 'new')
    .slice(0, 6);

  // Города с перерасходом (CPL > target). Если город уточнён через Avito,
  // подставляем реальные расходы и реальные показы/просмотры для CTR.
  const cityStats = useMemo(() => {
    const list = regionAverages(items);
    return list
      .map((r) => {
        const precise = preciseCityStats.get(r.region);
        const row = precise
          ? {
              ...r,
              ...precise,
              cpl: precise.contacts > 0 ? Math.round(precise.spend / precise.contacts) : null,
              conversion:
                precise.views > 0
                  ? +((precise.contacts / precise.views) * 100).toFixed(1)
                  : null,
              ctr: calcCtr(precise.views, precise.impressions),
              precise: true,
            }
          : { ...r, precise: false };
        return {
          ...row,
          overspend:
            row.cpl != null && row.cpl > kpi.targetCpl
              ? row.cpl - kpi.targetCpl
              : 0,
        };
      })
      .sort((a, b) => b.spend - a.spend);
  }, [items, kpi.targetCpl, preciseCityStats]);
  const overspendCities = cityStats.filter((c) => c.overspend > 0);

  const runPreciseIneffectiveCities = async () => {
    if (preciseCitiesProgress.busy) return;
    const targets = cityStats
      .filter((city) => city.overspend > 0 || (city.spend > 0 && city.contacts === 0))
      .filter((city) => !preciseCityStats.has(city.region))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 10);
    if (targets.length === 0) return;

    const idsByCity = new Map<string, number[]>();
    for (const city of targets) {
      const ids = periodItems
        .filter((item) => item.region === city.region)
        .map((item) => Number(item.id))
        .filter((id) => Number.isFinite(id) && id > 0);
      if (ids.length > 0) idsByCity.set(city.region, ids);
    }
    const allIds = Array.from(new Set(Array.from(idsByCity.values()).flat()));
    if (allIds.length === 0) return;

    setPreciseCitiesProgress({
      busy: true,
      done: 0,
      total: targets.length,
      nextEta: undefined,
      error: undefined,
    });

    const apiMetrics = await adapter.fetchItemTotals({
      dateFrom: period.from,
      dateTo: period.to,
      itemIds: allIds,
    });
    const metricsByItem = new Map((apiMetrics ?? []).map((row) => [String(row.itemId), row]));
    const itemById = new Map(periodItems.map((item) => [String(item.id), item]));
    const next = new Map(preciseCityStats);
    let failed = 0;

    for (let i = 0; i < targets.length; i++) {
      const city = targets[i];
      const ids = idsByCity.get(city.region) ?? [];
      const metricTotals = ids.reduce(
        (acc, id) => {
          const key = String(id);
          const api = metricsByItem.get(key);
          const fallback = itemById.get(key);
          const source = api ?? fallback;
          if (!source) return acc;
          return {
            views: acc.views + Number(source.views ?? 0),
            impressions: acc.impressions + Number(source.impressions ?? 0),
            contacts: acc.contacts + Number(source.contacts ?? 0),
            favorites: acc.favorites + Number(source.favorites ?? 0),
          };
        },
        { views: 0, impressions: 0, contacts: 0, favorites: 0 }
      );

      const spend = await adapter.fetchAdsForItems({
        dateFrom: period.from,
        dateTo: period.to,
        itemIds: ids,
      });
      if (spend) {
        next.set(city.region, {
          ...metricTotals,
          spend: Math.round(spend.total),
        });
        setPreciseCityStats(new Map(next));
      } else {
        failed += 1;
      }

      setPreciseCitiesProgress({
        busy: true,
        done: i + 1,
        total: targets.length,
        nextEta: undefined,
        error:
          failed > 0
            ? `Не удалось уточнить ${failed} из ${targets.length}; остальные города продолжаются.`
            : undefined,
      });
      if (i < targets.length - 1) {
        const eta = Date.now() + 65_000;
        setPreciseCitiesProgress((p) => ({ ...p, nextEta: eta }));
        await new Promise((resolve) => setTimeout(resolve, 65_000));
      }
    }

    setPreciseCitiesProgress({
      busy: false,
      done: targets.length,
      total: targets.length,
      nextEta: undefined,
      error: failed > 0 ? `Уточнено городов: ${targets.length - failed}. Не удалось: ${failed}.` : undefined,
    });
  };

  const preciseItemCandidates = useMemo(() => {
    const seen = new Set<string>();
    return [...ineffectiveItems, ...successfulItems]
      .map((item) => ({ id: Number(item.id), key: String(item.id) }))
      .filter((item) => {
        if (!Number.isFinite(item.id) || item.id <= 0 || seen.has(item.key)) return false;
        seen.add(item.key);
        return true;
      });
  }, [ineffectiveItems, successfulItems]);
  const preciseItemCandidateKeys = useMemo(
    () => new Set(preciseItemCandidates.map((item) => item.key)),
    [preciseItemCandidates]
  );

  const runPrecisePeriodItems = async () => {
    if (preciseItemsProgress.busy) return;
    const ids = Array.from(new Set(preciseItemCandidates.map((item) => item.id)));
    if (ids.length === 0) return;

    setPreciseItemsProgress({
      busy: true,
      done: 0,
      total: ids.length,
      nextEta: undefined,
      error: undefined,
    });

    const apiMetrics = await adapter.fetchItemTotals({
      dateFrom: period.from,
      dateTo: period.to,
      itemIds: ids,
    });

    const fallbackById = new Map(periodItems.map((item) => [String(item.id), item]));
    const metricRows = apiMetrics ?? ids.map((id) => {
      const fallback = fallbackById.get(String(id));
      return {
        itemId: String(id),
        views: Number(fallback?.views ?? 0),
        impressions: Number(fallback?.impressions ?? 0),
        contacts: Number(fallback?.contacts ?? 0),
        favorites: Number(fallback?.favorites ?? 0),
        spend: 0,
      };
    });
    const metricsById = new Map(metricRows.map((row) => [String(row.itemId), row]));
    const next = new Map(preciseItemStats);
    let failedSpend = 0;

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const key = String(id);
      const fallback = fallbackById.get(key);
      const row = metricsById.get(key);
      const exactSpend = await adapter.fetchAdsForItems({
        dateFrom: period.from,
        dateTo: period.to,
        itemIds: [id],
      });
      if (!exactSpend) failedSpend += 1;

      next.set(key, {
        views: Number(row?.views ?? fallback?.views ?? 0),
        impressions: Number(row?.impressions ?? fallback?.impressions ?? 0),
        contacts: Number(row?.contacts ?? fallback?.contacts ?? 0),
        favorites: Number(row?.favorites ?? fallback?.favorites ?? 0),
        spend: exactSpend ? Math.round(exactSpend.total) : Number(fallback?.spend ?? 0),
      });
      setPreciseItemStats(new Map(next));
      setPreciseItemsProgress({
        busy: true,
        done: i + 1,
        total: ids.length,
        nextEta: undefined,
        error:
          failedSpend > 0
            ? 'Не удалось уточнить точный расход по ' + failedSpend + ' из ' + ids.length + ' объявлений; остальные продолжаются.'
            : undefined,
      });

      if (i < ids.length - 1) {
        const eta = Date.now() + 65_000;
        setPreciseItemsProgress((progress) => ({ ...progress, nextEta: eta }));
        await new Promise((resolve) => setTimeout(resolve, 65_000));
      }
    }

    setPreciseItemsProgress({
      busy: false,
      done: ids.length,
      total: ids.length,
      nextEta: undefined,
      error: failedSpend > 0
        ? 'Точный расход и CPL обновлены для ' + (ids.length - failedSpend) + ' из ' + ids.length + ' объявлений. По остальным оставлен расход периода.'
        : 'Точный расход и CPL обновлены по всем объявлениям периода.',
    });
  };

  const balanceTotal = balance ? balance.real + balance.bonus : null;

  // Сумма пополнений CPA/CPx-аванса за выбранный период (включая сторно).
  // Это то, сколько денег пользователь пополнил на CPA-баланс ЗА ВЫБРАННЫЙ
  // ПЕРИОД (а не накопленный остаток).
  const cpxTopups = useMemo(
    () =>
      chargesInPeriod
        .filter((c) => c.kind === 'promotion_pool' || c.kind === 'refund')
        .reduce((s, c) => s + c.amount, 0),
    [chargesInPeriod]
  );

  return (
    <Layout
      title="Дашборд аккаунта"
      subtitle={`Сводка за период ${period.from} — ${period.to}`}
    >
      {/* ─── Выбор периода ─── */}
      <div className="card p-3 sm:p-4 mb-4">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {/* ─── Баланс кошелька + динамика CPA-аванса ─── */}
      {balance && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <BalanceCard
            label="Реальный баланс"
            icon={<Wallet className="w-4 h-4" />}
            value={formatRub(balance.real)}
            hint="Доступные деньги на счёте Авито (текущий остаток)"
            tone="white"
          />
          <BalanceCard
            label="Бонусные средства"
            icon={<Gift className="w-4 h-4" />}
            value={formatRub(balance.bonus)}
            hint="Промо-баллы / бонусы Авито"
            tone="violet"
          />
          {/* Третья карточка: разница пополнений CPA-аванса и расхода
              на рекламу за выбранный период. Если за период пополнили больше
              чем потратили — баланс CPA вырос (положительное число).
              Если потратили больше — пользовались остатком прошлого периода. */}
          {(() => {
            // Аванс = пополнения CPA минус расход на рекламу за тот же период.
            // Если есть точные spendings — используем их (presence = CPx-расход).
            // Иначе fallback на cpxTopups из operations_history.
            const realSpend = adsSpend;
            const realTopups = cpxTopups;
            const advanceDelta = realTopups - realSpend;
            const sign = advanceDelta > 0 ? '+' : '';
            const isPositive = advanceDelta > 0;
            const isNegative = advanceDelta < 0;
            return (
              <BalanceCard
                label="Изменение аванса за период"
                icon={<PiggyBank className="w-4 h-4" />}
                value={
                  realTopups === 0 && realSpend === 0
                    ? '—'
                    : `${sign}${formatRub(advanceDelta)}`
                }
                hint={
                  realTopups === 0 && realSpend === 0
                    ? 'За период не было ни пополнений, ни расхода'
                    : `Пополнено ${formatRub(realTopups)} − израсходовано ${formatRub(
                        realSpend
                      )} = ${
                        isPositive
                          ? 'аванс вырос'
                          : isNegative
                          ? 'тратили остаток с прошлого периода'
                          : 'без изменений'
                      }`
                }
                tone="orange"
              />
            );
          })()}
          {balanceTotal != null && (
            <div className="sm:col-span-3 text-xs text-ink-400 -mt-1">
              На счёте сейчас:{' '}
              <span className="text-white font-semibold">
                {formatRub(balanceTotal + balance.advance)}
              </span>
              {' · '}
              обновлено {new Date(balance.fetchedAt).toLocaleString('ru-RU')}
            </div>
          )}
        </div>
      )}

      {/* Разбивка расхода: на рекламу (promotion+presence) и прочее (commission+rest) */}
      {(adsSpend > 0 || otherSpend > 0) && (
        <div className="card border border-amber-500/30 bg-amber-500/5 p-3 mb-4 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <Coins className="w-4 h-4 text-amber-300" />
            <span className="text-ink-300">
              За период {period.from} — {period.to}:
            </span>
            <span className="text-white font-semibold">
              на рекламу {formatRub(adsSpend)}
            </span>
            {otherSpend > 0 && (
              <>
                <span className="text-ink-500">+</span>
                <span className="text-white font-semibold">
                  комиссии/прочее {formatRub(otherSpend)}
                </span>
              </>
            )}
            <span className="text-ink-500">=</span>
            <span className="text-amber-200 font-bold">
              {formatRub(totalSpendWithAccount)}
            </span>
          </div>
          {spendingsInPeriod ? (
            <div className="mt-2 text-xs text-emerald-300/80 leading-relaxed">
              ✓ Точные суммы из Avito Pro: продвижение{' '}
              {formatRub(spendingsInPeriod.promotion)} + тариф{' '}
              {formatRub(spendingsInPeriod.presence)} + комиссии и прочее{' '}
              {formatRub(spendingsInPeriod.other)}.
            </div>
          ) : (
            promotionPoolSpend > 0 && (
              <div className="mt-2 text-xs text-ink-400 leading-relaxed">
                CPx-тариф: суммы распределены по объявлениям пропорционально
                просмотрам за период (приближение). Точная разбивка — в Авито Pro
                → Статистика → Расходы.
              </div>
            )
          )}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Расход на объявления"
          value={formatRub(totalSpendWithAccount)}
          icon={Coins}
          hint={
            spendingsInPeriod
              ? `Реклама ${formatRub(adsSpend)} + комиссии/прочее ${formatRub(otherSpend)}`
              : `С учётом подписок/инструментов · ${formatPercent(stats.budgetUsage, 0)} от бюджета периода`
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
            current={`${formatNumber(stats.totalContacts)} / ${formatNumber(periodKpi.targetLeads)}`}
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
            label="Бюджет периода"
            current={`${formatRub(stats.totalSpend)} / ${formatRub(periodKpi.monthlyBudget)}`}
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

      <div className="card p-4 mb-4">
        <PrecisePeriodItemsBar
          preciseCount={preciseItemStats.size}
          totalCount={preciseItemCandidates.length}
          progress={preciseItemsProgress}
          onRun={runPrecisePeriodItems}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <TopList
          title={'Успешные объявления (' + successfulItems.length + ')'}
          icon={<TrendingUp className="w-4 h-4 text-emerald-300" />}
          tone="green"
          items={successfulItems}
          preciseItemStats={preciseItemStats}
          preciseCandidateKeys={preciseItemCandidateKeys}
          preciseBusy={preciseItemsProgress.busy}
        />
        <TopList
          title={'Неуспешные объявления (' + ineffectiveItems.length + ')'}
          icon={<TrendingDown className="w-4 h-4 text-rose-300" />}
          tone="red"
          items={ineffectiveItems}
          preciseItemStats={preciseItemStats}
          preciseCandidateKeys={preciseItemCandidateKeys}
          preciseBusy={preciseItemsProgress.busy}
        />
      </div>

      {/* Города с перерасходом */}
      {cityStats.length > 0 && (
        <div className="card p-5 mb-6">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <MapPin className="w-4 h-4 text-accent" />
            <h2 className="font-semibold text-white">Статистика по городам</h2>
            {overspendCities.length > 0 && (
              <Badge tone="red">
                {overspendCities.length} с перерасходом
              </Badge>
            )}
          </div>
          <PreciseItemsBar
            preciseCount={preciseCityStats.size}
            progress={preciseCitiesProgress}
            onRun={runPreciseIneffectiveCities}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="table-th">Город</th>
                  <th className="table-th text-right">Расход</th>
                  <th className="table-th text-right">Контактов</th>
                  <th className="table-th text-right">CPL</th>
                  <th className="table-th text-right">CTR</th>
                  <th className="table-th text-right">Конверсия</th>
                  <th className="table-th">Статус</th>
                </tr>
              </thead>
              <tbody>
                {cityStats.slice(0, 10).map((c) => {
                  const isOverspend = c.overspend > 0;
                  return (
                    <tr key={c.region} className="table-row">
                      <td className="table-td font-medium text-white">
                        {c.region}
                        {c.precise && (
                          <span className="ml-2 text-[10px] uppercase tracking-wider text-emerald-500 font-bold">
                            точно
                          </span>
                        )}
                      </td>
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
                        {c.ctr != null ? formatPercent(c.ctr) : '—'}
                      </td>
                      <td className="table-td text-right">
                        {c.conversion != null
                          ? formatPercent(c.conversion)
                          : '—'}
                      </td>
                      <td className="table-td">
                        {isOverspend ? (
                          <Badge tone="red">
                            +{formatRub(c.overspend)} от целевого CPL
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

function PrecisePeriodItemsBar({
  preciseCount,
  totalCount,
  progress,
  onRun,
}: {
  preciseCount: number;
  totalCount: number;
  progress: { busy: boolean; done: number; total: number; nextEta?: number; error?: string };
  onRun: () => void;
}) {
  const hasItems = totalCount > 0;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!progress.busy) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [progress.busy]);
  const secLeft = progress.nextEta
    ? Math.max(0, Math.round((progress.nextEta - now) / 1000))
    : 0;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <button
        onClick={onRun}
        disabled={progress.busy || !hasItems}
        className="btn-secondary !px-3 !py-1.5 !min-h-0 disabled:opacity-50"
        title="Точные метрики и точный расход по каждому объявлению через Avito API. Расход уточняется последовательно из-за лимита Avito примерно 1 запрос в минуту."
      >
        {progress.busy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Wand2 className="w-3.5 h-3.5" />
        )}
        {progress.busy
          ? 'Уточняю расходы ' + progress.done + '/' + progress.total + (secLeft > 0 ? ' · ' + secLeft + ' c' : '')
          : preciseCount > 0
          ? 'Обновить точные данные (' + preciseCount + ' объявлений)'
          : 'Уточнить все объявления за период'}
      </button>
      {progress.error ? (
        <span className="text-amber-600">{progress.error}</span>
      ) : !hasItems ? (
        <span className="text-ink-400">За выбранный период нет объявлений с данными.</span>
      ) : !progress.busy ? (
        <span className="text-ink-400">
          Уточнит точный расход и CPL по каждому объявлению периода. Из-за лимита Avito процесс идет последовательно.
        </span>
      ) : null}
    </div>
  );
}

function PreciseItemsBar({
  preciseCount,
  progress,
  onRun,
}: {
  preciseCount: number;
  progress: { busy: boolean; done: number; total: number; nextEta?: number; error?: string };
  onRun: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!progress.busy) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [progress.busy]);
  const secLeft = progress.nextEta
    ? Math.max(0, Math.round((progress.nextEta - now) / 1000))
    : 0;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
      <button
        onClick={onRun}
        disabled={progress.busy}
        className="btn-secondary !px-3 !py-1.5 !min-h-0 disabled:opacity-50"
        title="Точные расходы и метрики по топ-10 неэффективных городов через Avito API. Ограничение расходов Avito — примерно 1 запрос в минуту."
      >
        {progress.busy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Wand2 className="w-3.5 h-3.5" />
        )}
        {progress.busy
          ? `Уточняю города ${progress.done}/${progress.total}${secLeft > 0 ? ` · ${secLeft} c` : ``}`
          : preciseCount > 0
          ? `Уточнить ещё (точных городов: ${preciseCount})`
          : 'Уточнить топ-10 неэффективных городов'}
      </button>
      {progress.error ? (
        <span className="text-amber-600">{progress.error}</span>
      ) : !progress.busy && preciseCount === 0 ? (
        <span className="text-ink-400">
          После уточнения таблица пересчитается по реальным расходам, контактам, просмотрам и CTR из Avito.
        </span>
      ) : null}
    </div>
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
  preciseItemStats,
  preciseCandidateKeys,
  preciseBusy,
}: {
  title: string;
  icon: React.ReactNode;
  items: { id: string; title: string; spend: number; contacts: number }[];
  tone: 'green' | 'red';
  preciseItemStats: Map<string, PreciseItemStats>;
  preciseCandidateKeys: Set<string>;
  preciseBusy: boolean;
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
        <ul className="divide-y divide-ink-800 max-h-[430px] overflow-y-auto pr-1">
          {items.map((it) => {
            const cpl = calcCpl(it.spend, it.contacts);
            const key = String(it.id);
            const precise = preciseItemStats.has(key);
            const awaitingPrecise = preciseBusy && preciseCandidateKeys.has(key) && !precise;
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
                  {precise ? (
                    <Badge tone="blue">уточнено</Badge>
                  ) : awaitingPrecise ? (
                    <Badge tone="gray">ожидает уточнения</Badge>
                  ) : null}
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
