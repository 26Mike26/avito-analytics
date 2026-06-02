import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarRange,
  Eye,
  FileSpreadsheet,
  Loader2,
  Phone,
  Wand2,
  Wallet,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { Empty } from '../components/Empty';
import { Badge } from '../components/Badge';
import { useStore } from '../store/useStore';
import {
  comparePeriods,
  defaultRanges,
  type CityDiff,
  type ItemDiff,
  type PeriodComparison,
} from '../lib/compare';
import { calcCpl, formatNumber, formatRub, itemsInDateRange } from '../lib/analytics';
import { parseCsvImport } from '../lib/csvImport';
import type { AvitoItem, ItemMetrics } from '../types';
import type { SpendingsBreakdown } from '../services/AvitoAdapter';
import { itemDailyStatsFromExactSpendRows } from '../services/StatsCacheService';

type Mode = 'date' | 'csv';
type DateRange = { from: string; to: string };
type PrecisePair = { a: number; b: number };
type PreciseProgress = {
  busy: boolean;
  done: number;
  total: number;
  nextEta?: number;
  label?: string;
  error?: string;
  kind?: 'city' | 'item';
};

export default function Compare() {
  const items = useStore((s) => s.items);
  const metrics = useStore((s) => s.metrics);
  const accountCharges = useStore((s) => s.accountCharges);
  const hasPerItemSpend = useStore((s) => s.hasPerItemSpend);
  const spendings = useStore((s) => s.spendings);
  const adapter = useStore((s) => s.adapter);
  const currentAccountId = useStore((s) => s.currentAccountId);
  const currentAccountMode = useStore((s) =>
    s.currentAccountId ? s.accounts[s.currentAccountId]?.integration.mode : undefined
  );
  const saveExactItemDailyStats = useStore((s) => s.saveExactItemDailyStats);

  const [mode, setMode] = useState<Mode>('date');

  // Данные, загруженные специально под выбранные периоды сравнения.
  // Стор хранит метрики только за analyticsPeriod (последняя синхронизация),
  // поэтому период вне этого окна давал нули. Здесь догружаем union-диапазон.
  const [rangeMetrics, setRangeMetrics] = useState<ItemMetrics[] | null>(null);
  const [rangeSpendings, setRangeSpendings] = useState<SpendingsBreakdown | null>(null);
  const [rangeHasPerItemSpend, setRangeHasPerItemSpend] = useState(false);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const rangeKeyRef = useRef('');

  // ─── Режим «по датам»
  const ranges = useMemo(() => defaultRanges(), []);
  const [dateA, setDateA] = useState({ from: ranges.prevWeek.from, to: ranges.prevWeek.to });
  const [dateB, setDateB] = useState({ from: ranges.thisWeek.from, to: ranges.thisWeek.to });

  // ─── Режим «два CSV»
  const [csvA, setCsvA] = useState<{
    items: AvitoItem[];
    metrics: ItemMetrics[];
    fileName: string;
  } | null>(null);
  const [csvB, setCsvB] = useState<{
    items: AvitoItem[];
    metrics: ItemMetrics[];
    fileName: string;
  } | null>(null);
  const inputARef = useRef<HTMLInputElement>(null);
  const inputBRef = useRef<HTMLInputElement>(null);
  const preciseRunId = useRef(0);
  const [preciseCities, setPreciseCities] = useState<Map<string, PrecisePair>>(new Map());
  const [preciseItems, setPreciseItems] = useState<Map<string, PrecisePair>>(new Map());
  const [preciseProgress, setPreciseProgress] = useState<PreciseProgress>({
    busy: false,
    done: 0,
    total: 0,
  });

  const handleCsv = async (
    file: File,
    setter: (v: { items: AvitoItem[]; metrics: ItemMetrics[]; fileName: string }) => void
  ) => {
    const text = await file.text();
    const res = parseCsvImport(text);
    setter({ items: res.items, metrics: res.metrics, fileName: file.name });
  };

  // Полный диапазон, охватывающий оба периода.
  const unionFrom = useMemo(() => minDate(dateA.from, dateB.from), [dateA.from, dateB.from]);
  const unionTo = useMemo(() => maxDate(dateA.to, dateB.to), [dateA.to, dateB.to]);

  // Догружаем метрики и расходы за выбранные периоды (только API-аккаунт, режим «по датам»).
  // Без этого сравнение видит лишь окно последней синхронизации (analyticsPeriod).
  useEffect(() => {
    if (mode !== 'date' || currentAccountMode !== 'api') {
      setRangeMetrics(null);
      setRangeSpendings(null);
      setRangeHasPerItemSpend(false);
      setRangeError(null);
      setRangeLoading(false);
      return;
    }
    if (!unionFrom || !unionTo || unionFrom > unionTo || items.length === 0) return;
    const key = `${currentAccountId ?? ''}:${unionFrom}:${unionTo}`;
    rangeKeyRef.current = key;
    let cancelled = false;
    setRangeLoading(true);
    setRangeError(null);
    (async () => {
      try {
        const m = await adapter.fetchMetrics(items, { dateFrom: unionFrom, dateTo: unionTo });
        const perItem = !!adapter.lastMetricsHadV2Spend;
        let sp: SpendingsBreakdown | null = null;
        try {
          sp = await adapter.fetchSpendings({ dateFrom: unionFrom, dateTo: unionTo });
        } catch {
          sp = null;
        }
        if (cancelled || rangeKeyRef.current !== key) return;
        setRangeMetrics(m);
        setRangeSpendings(sp);
        setRangeHasPerItemSpend(perItem);
      } catch {
        if (!cancelled && rangeKeyRef.current === key) {
          setRangeError('Не удалось загрузить данные за выбранные периоды из Avito.');
          setRangeMetrics(null);
          setRangeSpendings(null);
        }
      } finally {
        if (!cancelled && rangeKeyRef.current === key) setRangeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, currentAccountMode, currentAccountId, unionFrom, unionTo, items, adapter]);

  // Источники данных: догруженные под период (если есть) либо стор.
  const usingRange = mode === 'date' && rangeMetrics != null;
  const effectiveMetrics = usingRange ? rangeMetrics : metrics;
  const effectiveSpendings = usingRange ? rangeSpendings : spendings;
  const effectiveHasPerItemSpend = usingRange ? rangeHasPerItemSpend : hasPerItemSpend;

  const getPeriodSpendTotals = useMemo(
    () =>
      (range: DateRange) => {
        if (effectiveSpendings) {
          const inRange = effectiveSpendings.byDate.filter(
            (d) => d.date >= range.from && d.date <= range.to
          );
          const ads = inRange.reduce((s, d) => s + d.ads, 0);
          const total = inRange.reduce((s, d) => s + d.total, 0);
          return { ads, other: Math.max(0, total - ads) };
        }

        const other = accountCharges
          .filter((c) => c.date >= range.from && c.date <= range.to)
          .filter((c) => c.kind === 'account_other')
          .reduce((s, c) => s + c.amount, 0);
        return { ads: null, other: Math.max(0, other) };
      },
    [accountCharges, effectiveSpendings]
  );

  const datePeriodItems = useMemo(() => {
    if (mode !== 'date') return null;
    const totalsA = getPeriodSpendTotals(dateA);
    const totalsB = getPeriodSpendTotals(dateB);
    return {
      a: itemsInDateRange(
        items,
        effectiveMetrics,
        dateA.from,
        dateA.to,
        accountCharges,
        effectiveHasPerItemSpend,
        totalsA.ads,
        totalsA.other
      ),
      b: itemsInDateRange(
        items,
        effectiveMetrics,
        dateB.from,
        dateB.to,
        accountCharges,
        effectiveHasPerItemSpend,
        totalsB.ads,
        totalsB.other
      ),
    };
  }, [
    mode,
    dateA,
    dateB,
    items,
    effectiveMetrics,
    accountCharges,
    effectiveHasPerItemSpend,
    getPeriodSpendTotals,
  ]);

  const baseComparison = useMemo<PeriodComparison | null>(() => {
    if (mode === 'date') {
      if (!datePeriodItems) return null;
      const hasData = [...datePeriodItems.a, ...datePeriodItems.b].some(hasComparisonActivity);
      if (!hasData) return null;
      return comparePeriods(
        [],
        [],
        datePeriodItems.a,
        datePeriodItems.b,
        `${dateA.from} → ${dateA.to}`,
        `${dateB.from} → ${dateB.to}`
      );
    }
    if (mode === 'csv') {
      if (!csvA || !csvB) return null;
      return comparePeriods([], [], csvA.items, csvB.items, csvA.fileName, csvB.fileName);
    }
    return null;
  }, [mode, dateA, dateB, csvA, csvB, datePeriodItems]);

  const comparison = useMemo(
    () =>
      baseComparison
        ? applyPreciseComparison(baseComparison, preciseCities, preciseItems)
        : null,
    [baseComparison, preciseCities, preciseItems]
  );

  useEffect(() => {
    preciseRunId.current += 1;
    setPreciseCities(new Map());
    setPreciseItems(new Map());
    setPreciseProgress({ busy: false, done: 0, total: 0 });
  }, [mode, dateA.from, dateA.to, dateB.from, dateB.to]);

  /**
   * Уточняет точный расход через Avito API по одному виду строк:
   * `kind === 'city'` — по всем городам, `kind === 'item'` — по всем объявлениям.
   * Срезов нет: уточняются все ещё не уточнённые строки (сортировка по расходу,
   * чтобы крупные суммы появились первыми). Лимит Avito ~1 запрос/мин.
   */
  const runPrecise = async (kind: 'city' | 'item') => {
    if (mode !== 'date' || !baseComparison || !datePeriodItems || preciseProgress.busy) return;

    const allPeriodItems = [...datePeriodItems.a, ...datePeriodItems.b];
    const targets: Array<{
      type: 'city' | 'item';
      key: string;
      label: string;
      itemIds: number[];
    }> =
      kind === 'city'
        ? [...baseComparison.cities]
            .filter((c) => !preciseCities.has(c.region))
            .sort((a, b) => Math.max(b.a.spend, b.b.spend) - Math.max(a.a.spend, a.b.spend))
            .map((city) => ({
              type: 'city' as const,
              key: city.region,
              label: `город ${city.region}`,
              itemIds: uniqueNumbers(
                allPeriodItems
                  .filter((it) => cleanRegionName(it.region) === city.region)
                  .map((it) => numericItemId(it.id))
              ),
            }))
            .filter((t) => t.itemIds.length > 0)
        : [...baseComparison.items]
            .filter((i) => !preciseItems.has(i.itemId))
            .filter((i) => numericItemId(i.itemId) != null)
            .sort((a, b) => Math.max(b.a.spend, b.b.spend) - Math.max(a.a.spend, a.b.spend))
            .map((item) => ({
              type: 'item' as const,
              key: item.itemId,
              label: item.title,
              itemIds: uniqueNumbers([numericItemId(item.itemId)]),
            }))
            .filter((t) => t.itemIds.length > 0);

    if (targets.length === 0) return;

    const runId = preciseRunId.current + 1;
    preciseRunId.current = runId;
    const dateFrom = minDate(dateA.from, dateB.from);
    const dateTo = maxDate(dateA.to, dateB.to);
    setPreciseProgress({ busy: true, done: 0, total: targets.length, label: targets[0].label, kind });

    const cityMap = new Map(preciseCities);
    const itemMap = new Map(preciseItems);
    let applied = 0;
    let failed = 0;

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      if (runId !== preciseRunId.current) return;
      setPreciseProgress((p) => ({ ...p, label: target.label }));
      const rows = await adapter.fetchAdsForItemsByDate({
        dateFrom,
        dateTo,
        itemIds: target.itemIds,
      });
      if (runId !== preciseRunId.current) return;
      if (rows) {
        const pair = {
          a: sumRowsForRange(rows, dateA),
          b: sumRowsForRange(rows, dateB),
        };
        if (target.type === 'city') {
          cityMap.set(target.key, pair);
          setPreciseCities(new Map(cityMap));
        } else {
          itemMap.set(target.key, pair);
          setPreciseItems(new Map(itemMap));
          if (currentAccountId) {
            void saveExactItemDailyStats(
              itemDailyStatsFromExactSpendRows(currentAccountId, target.key, metrics, rows),
              { from: dateFrom, to: dateTo }
            );
          }
        }
        applied += 1;
      } else {
        failed += 1;
      }
      setPreciseProgress({
        busy: true,
        done: i + 1,
        total: targets.length,
        kind,
        error: failed > 0 ? `Не удалось уточнить ${failed} из ${targets.length}; остальные запросы продолжаются.` : undefined,
      });
      if (i < targets.length - 1) {
        const eta = Date.now() + 65_000;
        setPreciseProgress((p) => ({ ...p, nextEta: eta, label: targets[i + 1].label }));
        await new Promise((res) => setTimeout(res, 65_000));
        if (runId !== preciseRunId.current) return;
      }
    }

    setPreciseProgress({
      busy: false,
      done: targets.length,
      total: targets.length,
      kind,
      error:
        failed === 0
          ? undefined
          : applied > 0
          ? `Уточнено: ${applied}. Не удалось: ${failed}.`
          : 'Avito не вернул точные расходы. Я подождал лимит и попробовал альтернативный формат фильтра; проверьте доступ тарифа к /stats/v2/spendings.',
    });
  };

  return (
    <Layout
      title="Сравнение периодов"
      subtitle="Какие изменения произошли в метриках за два разных промежутка времени"
    >
      {/* Переключатель режима */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={() => setMode('date')}
          className={[
            'btn',
            mode === 'date' ? '' : 'btn-secondary',
          ].join(' ')}
        >
          <CalendarRange className="w-4 h-4" />
          По датам (текущие данные)
        </button>
        <button
          onClick={() => setMode('csv')}
          className={[
            'btn',
            mode === 'csv' ? '' : 'btn-secondary',
          ].join(' ')}
        >
          <FileSpreadsheet className="w-4 h-4" />
          Две CSV-выгрузки
        </button>
      </div>

      {/* Форма для дат */}
      {mode === 'date' && (
        <div className="card p-4 sm:p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DateRangeInput label="Период A" value={dateA} onChange={setDateA} />
            <DateRangeInput label="Период Б" value={dateB} onChange={setDateB} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <button
              className="chip min-h-[32px] px-3 py-1 bg-ink-800 text-ink-200 hover:text-white border border-ink-700"
              onClick={() => {
                setDateA(ranges.prevWeek);
                setDateB(ranges.thisWeek);
              }}
            >
              Прошлая неделя vs текущая
            </button>
            <button
              className="chip min-h-[32px] px-3 py-1 bg-ink-800 text-ink-200 hover:text-white border border-ink-700"
              onClick={() => {
                setDateA(ranges.prev30);
                setDateB(ranges.this30);
              }}
            >
              Прошлые 30 дней vs текущие 30
            </button>
          </div>
          {(rangeLoading || rangeError) && (
            <div className="mt-3 flex items-center gap-2 text-xs">
              {rangeLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                  <span className="text-ink-300">
                    Загружаю данные за выбранные периоды из Avito…
                  </span>
                </>
              ) : (
                <span className="text-rose-300">{rangeError}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Форма для двух CSV */}
      {mode === 'csv' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <CsvSlot
            label="Период A — выгрузка"
            data={csvA}
            inputRef={inputARef}
            onPickFile={(f) => handleCsv(f, setCsvA)}
            onClear={() => setCsvA(null)}
          />
          <CsvSlot
            label="Период Б — выгрузка"
            data={csvB}
            inputRef={inputBRef}
            onPickFile={(f) => handleCsv(f, setCsvB)}
            onClear={() => setCsvB(null)}
          />
        </div>
      )}

      {/* Результат */}
      {!comparison ? (
        <Empty
          title="Загрузите данные для сравнения"
          hint={
            mode === 'date'
              ? 'Выберите два диапазона дат. Метрики берутся из текущего аккаунта (демо или импорта).'
              : 'Загрузите две CSV-выгрузки из ЛК Авито — по одной на каждый период.'
          }
        />
      ) : (
        <ComparisonView
          c={comparison}
          precise={
            mode === 'date'
              ? {
                  progress: preciseProgress,
                  cityCount: preciseCities.size,
                  itemCount: preciseItems.size,
                  onRefineCities: () => runPrecise('city'),
                  onRefineItems: () => runPrecise('item'),
                }
              : undefined
          }
        />
      )}
    </Layout>
  );
}

function hasComparisonActivity(item: AvitoItem): boolean {
  return item.views > 0 || item.contacts > 0 || item.favorites > 0 || item.spend > 0;
}

function cleanRegionName(region: string): string {
  const s = (region ?? '').trim();
  if (!s) return '—';
  return s.split(',')[0].replace(/^г\.?\s*/i, '').trim() || '—';
}

function numericItemId(id: string): number | null {
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function uniqueNumbers(values: Array<number | null>): number[] {
  return Array.from(new Set(values.filter((v): v is number => v != null)));
}

function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}

function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

function diffPercent(a: number, b: number): number {
  if (a === 0) return b === 0 ? 0 : 100;
  return ((b - a) / Math.abs(a)) * 100;
}

function sumRowsForRange(
  rows: Array<{ date: string; ads: number; total: number }>,
  range: DateRange
): number {
  return Math.round(
    rows
      .filter((r) => r.date >= range.from && r.date <= range.to)
      .reduce((s, r) => s + r.total, 0)
  );
}

function withPreciseSpend<T extends CityDiff | ItemDiff>(row: T, pair: PrecisePair): T {
  const aCpl = calcCpl(pair.a, row.a.contacts);
  const bCpl = calcCpl(pair.b, row.b.contacts);
  return {
    ...row,
    precise: true,
    a: { ...row.a, spend: pair.a, cpl: aCpl },
    b: { ...row.b, spend: pair.b, cpl: bCpl },
    deltaSpend: pair.b - pair.a,
    cplChangePercent:
      aCpl != null && bCpl != null ? +diffPercent(aCpl, bCpl).toFixed(1) : null,
  };
}

function applyPreciseComparison(
  comparison: PeriodComparison,
  preciseCities: Map<string, PrecisePair>,
  preciseItems: Map<string, PrecisePair>
): PeriodComparison {
  return {
    ...comparison,
    cities: comparison.cities.map((city) => {
      const pair = preciseCities.get(city.region);
      return pair ? withPreciseSpend(city, pair) : city;
    }),
    items: comparison.items.map((item) => {
      const pair = preciseItems.get(item.itemId);
      return pair ? withPreciseSpend(item, pair) : item;
    }),
  };
}

function DateRangeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: { from: string; to: string };
  onChange: (v: { from: string; to: string }) => void;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1">
        {label}
      </div>
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
        <input
          type="date"
          className="input w-full sm:w-auto"
          value={value.from}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
        />
        <span className="hidden sm:inline text-ink-500">—</span>
        <input
          type="date"
          className="input w-full sm:w-auto"
          value={value.to}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
        />
      </div>
    </div>
  );
}

function CsvSlot({
  label,
  data,
  inputRef,
  onPickFile,
  onClear,
}: {
  label: string;
  data: { items: AvitoItem[]; metrics: ItemMetrics[]; fileName: string } | null;
  inputRef: React.RefObject<HTMLInputElement>;
  onPickFile: (f: File) => void;
  onClear: () => void;
}) {
  return (
    <div className="card p-4 sm:p-5">
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-2">
        {label}
      </div>
      {data ? (
        <div className="space-y-2">
          <div className="text-sm text-white truncate">{data.fileName}</div>
          <div className="text-xs text-ink-400">
            Объявлений: {data.items.length} · Дневных метрик: {data.metrics.length}
          </div>
          <button className="btn-secondary w-full sm:w-auto" onClick={onClear}>
            Заменить файл
          </button>
        </div>
      ) : (
        <button
          className="btn w-full"
          onClick={() => inputRef.current?.click()}
        >
          <FileSpreadsheet className="w-4 h-4" />
          Выбрать CSV
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.tsv,.txt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPickFile(f);
          if (inputRef.current) inputRef.current.value = '';
        }}
      />
    </div>
  );
}

type PreciseControl = {
  progress: PreciseProgress;
  cityCount: number;
  itemCount: number;
  onRefineCities: () => void;
  onRefineItems: () => void;
};

function ComparisonView({
  c,
  precise,
}: {
  c: PeriodComparison;
  precise?: PreciseControl;
}) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <DeltaCard
          icon={<Eye className="w-4 h-4" />}
          label="Просмотры"
          aValue={c.a.views}
          bValue={c.b.views}
          deltaAbs={c.delta.views.abs}
          deltaPercent={c.delta.views.percent}
          formatter={(v) => v.toLocaleString('ru-RU')}
        />
        <DeltaCard
          icon={<Phone className="w-4 h-4" />}
          label="Контакты"
          aValue={c.a.contacts}
          bValue={c.b.contacts}
          deltaAbs={c.delta.contacts.abs}
          deltaPercent={c.delta.contacts.percent}
          formatter={(v) => v.toLocaleString('ru-RU')}
          // больше — лучше
          higherIsBetter
        />
        <DeltaCard
          icon={<Wallet className="w-4 h-4" />}
          label="Расход"
          aValue={c.a.spend}
          bValue={c.b.spend}
          deltaAbs={c.delta.spend.abs}
          deltaPercent={c.delta.spend.percent}
          formatter={formatRub}
          // больше — хуже
          higherIsBetter={false}
        />
        <DeltaCard
          icon={<ArrowDownRight className="w-4 h-4" />}
          label="CPL"
          aValue={c.a.cpl ?? 0}
          bValue={c.b.cpl ?? 0}
          deltaAbs={c.delta.cpl.abs ?? 0}
          deltaPercent={c.delta.cpl.percent ?? 0}
          formatter={(v) => formatRub(v)}
          higherIsBetter={false}
          unavailable={c.a.cpl == null || c.b.cpl == null}
        />
      </div>

      {/* Заметка про задержку биллинга Avito: есть активность, но расход = 0 */}
      {((c.a.spend === 0 && (c.a.views > 0 || c.a.contacts > 0)) ||
        (c.b.spend === 0 && (c.b.views > 0 || c.b.contacts > 0))) && (
        <div className="card p-3 sm:p-4 mb-6 border border-amber-500/30 bg-amber-500/5 text-xs text-amber-200/90">
          В одном из периодов есть просмотры и контакты, но расход = 0. Avito
          обновляет данные о списаниях с задержкой 1–3 дня, поэтому за самые свежие
          дни расход и CPL могут быть пустыми. Когда суммы появятся в Avito, нажмите
          «Уточнить расходы» — они подтянутся точно.
        </div>
      )}

      {/* Подзаголовок периодов */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <div className="card p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-400">
            Период A
          </div>
          <div className="text-sm text-white">{c.a.label}</div>
          <div className="text-xs text-ink-400 mt-1">
            Объявлений с активностью: {c.a.itemCount}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-400">
            Период Б
          </div>
          <div className="text-sm text-white">{c.b.label}</div>
          <div className="text-xs text-ink-400 mt-1">
            Объявлений с активностью: {c.b.itemCount}
          </div>
        </div>
      </div>

      <CityComparison
        cities={c.cities}
        refine={
          precise
            ? {
                count: precise.cityCount,
                progress: precise.progress,
                onRun: precise.onRefineCities,
              }
            : undefined
        }
      />

      {/* Топ-движение по объявлениям */}
      <div className="card p-4 sm:p-5">
        <h2 className="text-lg font-bold text-white mb-3">
          Изменения по объявлениям
        </h2>
        {precise && (
          <PreciseButton
            kind="item"
            count={precise.itemCount}
            progress={precise.progress}
            onRun={precise.onRefineItems}
          />
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-th">Название</th>
                <th className="table-th text-right">Контакты A → Б</th>
                <th className="table-th text-right">Расход A → Б</th>
                <th className="table-th text-right">CPL A → Б</th>
                <th className="table-th text-right">Δ контактов</th>
                <th className="table-th text-right">Δ CPL %</th>
              </tr>
            </thead>
            <tbody>
              {c.items.slice(0, 50).map((d) => (
                <tr key={d.itemId} className="table-row">
                  <td className="table-td text-white">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{d.title}</span>
                      {d.precise && <Badge tone="green">точно</Badge>}
                    </div>
                  </td>
                  <td className="table-td text-right whitespace-nowrap">
                    {d.a.contacts} → {d.b.contacts}
                  </td>
                  <td className="table-td text-right whitespace-nowrap">
                    {formatRub(d.a.spend)} → {formatRub(d.b.spend)}
                  </td>
                  <td className="table-td text-right whitespace-nowrap">
                    {d.a.cpl != null ? formatRub(d.a.cpl) : '—'} →{' '}
                    {d.b.cpl != null ? formatRub(d.b.cpl) : '—'}
                  </td>
                  <td className="table-td text-right">
                    <DeltaPill value={d.deltaContacts} higherIsBetter />
                  </td>
                  <td className="table-td text-right">
                    {d.cplChangePercent != null ? (
                      <DeltaPill
                        value={d.cplChangePercent}
                        higherIsBetter={false}
                        suffix="%"
                      />
                    ) : (
                      <span className="text-ink-500">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {c.items.length > 50 && (
          <div className="text-xs text-ink-400 mt-2">
            Показаны 50 объявлений с самыми большими изменениями.
          </div>
        )}
      </div>
    </>
  );
}

function CityComparison({
  cities,
  refine,
}: {
  cities: CityDiff[];
  refine?: { count: number; progress: PreciseProgress; onRun: () => void };
}) {
  return (
    <div className="card p-4 sm:p-5 mb-6">
      <h2 className="text-lg font-bold text-white mb-3">
        Сравнение по городам
      </h2>
      {refine && (
        <PreciseButton
          kind="city"
          count={refine.count}
          progress={refine.progress}
          onRun={refine.onRun}
        />
      )}
      {cities.length === 0 ? (
        <div className="text-sm text-ink-400">
          За выбранные периоды нет городов с активностью.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="table-th">Город</th>
                  <th className="table-th text-right">Просмотры A → Б</th>
                  <th className="table-th text-right">Контакты A → Б</th>
                  <th className="table-th text-right">Расход A → Б</th>
                  <th className="table-th text-right">CPL A → Б</th>
                  <th className="table-th text-right">Δ контактов</th>
                  <th className="table-th text-right">Δ CPL %</th>
                </tr>
              </thead>
              <tbody>
                {cities.slice(0, 50).map((d) => (
                  <tr key={d.region} className="table-row">
                    <td className="table-td text-white">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{d.region}</span>
                        {d.precise && <Badge tone="green">точно</Badge>}
                      </div>
                    </td>
                    <td className="table-td text-right whitespace-nowrap">
                      {formatNumber(d.a.views)} → {formatNumber(d.b.views)}
                    </td>
                    <td className="table-td text-right whitespace-nowrap">
                      {formatNumber(d.a.contacts)} → {formatNumber(d.b.contacts)}
                    </td>
                    <td className="table-td text-right whitespace-nowrap">
                      {formatRub(d.a.spend)} → {formatRub(d.b.spend)}
                    </td>
                    <td className="table-td text-right whitespace-nowrap">
                      {d.a.cpl != null ? formatRub(d.a.cpl) : '—'} →{' '}
                      {d.b.cpl != null ? formatRub(d.b.cpl) : '—'}
                    </td>
                    <td className="table-td text-right">
                      <DeltaPill value={d.deltaContacts} higherIsBetter />
                    </td>
                    <td className="table-td text-right">
                      {d.cplChangePercent != null ? (
                        <DeltaPill
                          value={d.cplChangePercent}
                          higherIsBetter={false}
                          suffix="%"
                        />
                      ) : (
                        <span className="text-ink-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cities.length > 50 && (
            <div className="text-xs text-ink-400 mt-2">
              Показаны 50 городов с самыми большими изменениями.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PreciseButton({
  kind,
  count,
  progress,
  onRun,
}: {
  kind: 'city' | 'item';
  count: number;
  progress: PreciseProgress;
  onRun: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!progress.busy) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [progress.busy]);

  // Прогресс показываем только у той кнопки, чей вид сейчас уточняется.
  const isThis = progress.kind === kind;
  const isBusyHere = progress.busy && isThis;
  const secLeft =
    isBusyHere && progress.nextEta
      ? Math.max(0, Math.round((progress.nextEta - now) / 1000))
      : 0;
  const donePlural = kind === 'city' ? 'городов' : 'объявлений';

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <button
        onClick={onRun}
        disabled={progress.busy}
        className="btn-secondary !px-3 !py-1.5 !min-h-0 disabled:opacity-50"
        title="Точный расход через Avito API: /stats/v2/spendings с filter.itemIds. Ограничение Avito — примерно 1 запрос в минуту, строки уточняются последовательно."
      >
        {isBusyHere ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Wand2 className="w-3.5 h-3.5" />
        )}
        {isBusyHere
          ? `Уточняю ${progress.done}/${progress.total}${secLeft > 0 ? ` · ${secLeft} c` : ''}`
          : count > 0
          ? `Уточнить ещё (точных: ${count})`
          : 'Уточнить расходы'}
      </button>
      <span className="text-xs text-ink-400">
        {isBusyHere
          ? `Сейчас: ${progress.label ?? 'запрос к Avito'}`
          : isThis && progress.error
          ? progress.error
          : count > 0
          ? `Уточнено ${donePlural}: ${count}.`
          : 'Текущие суммы — приближение; кнопка подтянет точный расход из Avito.'}
      </span>
    </div>
  );
}

function DeltaCard({
  icon,
  label,
  aValue,
  bValue,
  deltaAbs,
  deltaPercent,
  formatter,
  higherIsBetter = true,
  unavailable,
}: {
  icon: React.ReactNode;
  label: string;
  aValue: number;
  bValue: number;
  deltaAbs: number;
  deltaPercent: number;
  formatter: (v: number) => string;
  higherIsBetter?: boolean;
  unavailable?: boolean;
}) {
  const isPositive = deltaAbs >= 0;
  const goodDirection = higherIsBetter ? isPositive : !isPositive;
  const tone: 'green' | 'red' | 'gray' = unavailable
    ? 'gray'
    : Math.abs(deltaAbs) < 0.001
    ? 'gray'
    : goodDirection
    ? 'green'
    : 'red';
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between text-ink-400 text-xs uppercase tracking-wider">
        <span className="flex items-center gap-2">
          {icon}
          {label}
        </span>
        <Badge tone={tone}>
          {unavailable
            ? '—'
            : `${isPositive ? '+' : ''}${deltaPercent}%`}
        </Badge>
      </div>
      <div className="mt-2 text-2xl font-extrabold text-white">
        {unavailable ? '—' : formatter(bValue)}
      </div>
      <div className="text-xs text-ink-400 mt-1 flex items-center gap-1">
        {unavailable ? (
          <>Нет данных в одном из периодов</>
        ) : (
          <>
            было {formatter(aValue)}{' '}
            {isPositive ? (
              <ArrowUpRight className="w-3 h-3 text-emerald-300 inline" />
            ) : (
              <ArrowDownRight className="w-3 h-3 text-rose-300 inline" />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function DeltaPill({
  value,
  higherIsBetter = true,
  suffix = '',
}: {
  value: number;
  higherIsBetter?: boolean;
  suffix?: string;
}) {
  const sign = value > 0 ? '+' : '';
  const good = higherIsBetter ? value >= 0 : value <= 0;
  const tone: 'green' | 'red' | 'gray' =
    Math.abs(value) < 0.001 ? 'gray' : good ? 'green' : 'red';
  // Округляем до 1 знака для дробных, целочисленные оставляем как есть.
  const display = Number.isInteger(value)
    ? String(value)
    : value.toFixed(1).replace('.', ',');
  return (
    <Badge tone={tone}>
      {sign}
      {display}
      {suffix}
    </Badge>
  );
}
