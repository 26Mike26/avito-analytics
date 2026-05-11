import { useMemo, useRef, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarRange,
  Eye,
  FileSpreadsheet,
  Phone,
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
  type PeriodComparison,
} from '../lib/compare';
import { formatNumber, formatRub, itemsInDateRange } from '../lib/analytics';
import { parseCsvImport } from '../lib/csvImport';
import type { AvitoItem, ItemMetrics } from '../types';

type Mode = 'date' | 'csv';

export default function Compare() {
  const items = useStore((s) => s.items);
  const metrics = useStore((s) => s.metrics);
  const accountCharges = useStore((s) => s.accountCharges);
  const hasPerItemSpend = useStore((s) => s.hasPerItemSpend);
  const spendings = useStore((s) => s.spendings);

  const [mode, setMode] = useState<Mode>('date');

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

  const handleCsv = async (
    file: File,
    setter: (v: { items: AvitoItem[]; metrics: ItemMetrics[]; fileName: string }) => void
  ) => {
    const text = await file.text();
    const res = parseCsvImport(text);
    setter({ items: res.items, metrics: res.metrics, fileName: file.name });
  };

  const getPeriodSpendTotals = useMemo(
    () =>
      (range: { from: string; to: string }) => {
        if (spendings) {
          const inRange = spendings.byDate.filter(
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
    [accountCharges, spendings]
  );

  const comparison = useMemo<PeriodComparison | null>(() => {
    if (mode === 'date') {
      const totalsA = getPeriodSpendTotals(dateA);
      const totalsB = getPeriodSpendTotals(dateB);
      const periodItemsA = itemsInDateRange(
        items,
        metrics,
        dateA.from,
        dateA.to,
        accountCharges,
        hasPerItemSpend,
        totalsA.ads,
        totalsA.other
      );
      const periodItemsB = itemsInDateRange(
        items,
        metrics,
        dateB.from,
        dateB.to,
        accountCharges,
        hasPerItemSpend,
        totalsB.ads,
        totalsB.other
      );
      const hasData = [...periodItemsA, ...periodItemsB].some(hasComparisonActivity);
      if (!hasData) return null;
      return comparePeriods(
        [],
        [],
        periodItemsA,
        periodItemsB,
        `${dateA.from} → ${dateA.to}`,
        `${dateB.from} → ${dateB.to}`
      );
    }
    if (mode === 'csv') {
      if (!csvA || !csvB) return null;
      return comparePeriods([], [], csvA.items, csvB.items, csvA.fileName, csvB.fileName);
    }
    return null;
  }, [
    mode,
    dateA,
    dateB,
    csvA,
    csvB,
    items,
    metrics,
    accountCharges,
    hasPerItemSpend,
    getPeriodSpendTotals,
  ]);

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
              className="chip bg-ink-800 text-ink-200 hover:text-white border border-ink-700"
              onClick={() => {
                setDateA(ranges.prevWeek);
                setDateB(ranges.thisWeek);
              }}
            >
              Прошлая неделя vs текущая
            </button>
            <button
              className="chip bg-ink-800 text-ink-200 hover:text-white border border-ink-700"
              onClick={() => {
                setDateA(ranges.prev30);
                setDateB(ranges.this30);
              }}
            >
              Прошлые 30 дней vs текущие 30
            </button>
          </div>
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
        <ComparisonView c={comparison} />
      )}
    </Layout>
  );
}

function hasComparisonActivity(item: AvitoItem): boolean {
  return item.views > 0 || item.contacts > 0 || item.favorites > 0 || item.spend > 0;
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
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          className="input w-auto"
          value={value.from}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
        />
        <span className="text-ink-500">—</span>
        <input
          type="date"
          className="input w-auto"
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
          <button className="btn-secondary" onClick={onClear}>
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

function ComparisonView({ c }: { c: PeriodComparison }) {
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

      <CityComparison cities={c.cities} />

      {/* Топ-движение по объявлениям */}
      <div className="card p-4 sm:p-5">
        <h2 className="text-lg font-bold text-white mb-3">
          Изменения по объявлениям
        </h2>
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
                  <td className="table-td text-white">{d.title}</td>
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

function CityComparison({ cities }: { cities: CityDiff[] }) {
  return (
    <div className="card p-4 sm:p-5 mb-6">
      <h2 className="text-lg font-bold text-white mb-3">
        Сравнение по городам
      </h2>
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
                    <td className="table-td text-white">{d.region}</td>
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
