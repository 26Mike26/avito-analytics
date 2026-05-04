import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Filter,
  Pencil,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { Badge, StatusBadge } from '../components/Badge';
import { PeriodPicker } from '../components/PeriodPicker';
import { useStore } from '../store/useStore';
import {
  calcConversion,
  calcCpl,
  classifyItem,
  formatNumber,
  formatPercent,
  formatRub,
  itemsInDateRange,
  lastNDaysRange,
} from '../lib/analytics';
import { Empty } from '../components/Empty';
import type { AvitoItem } from '../types';

type EfficiencyFilter =
  | 'all'
  | 'effective'
  | 'overspend'
  | 'lowConversion'
  | 'noLeads'
  | 'noData'
  | 'requiresAction';

const efficiencyLabels: Record<EfficiencyFilter, string> = {
  all: 'Все',
  effective: 'Эффективные',
  overspend: 'Перерасход',
  lowConversion: 'Низкая конверсия',
  noLeads: 'Без лидов',
  noData: 'Без данных',
  requiresAction: 'Требуется действие',
};

export default function Items() {
  const items = useStore((s) => s.items);
  const metrics = useStore((s) => s.metrics);
  const accountCharges = useStore((s) => s.accountCharges);
  const hasPerItemSpend = useStore((s) => s.hasPerItemSpend);
  const kpi = useStore((s) => s.kpi);
  const setItemBid = useStore((s) => s.setItemBid);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [region, setRegion] = useState('all');
  const [status, setStatus] = useState<'all' | 'active' | 'paused' | 'archived'>('all');
  const [efficiency, setEfficiency] = useState<EfficiencyFilter>('all');
  const [period, setPeriod] = useState(() => lastNDaysRange(270));
  const [sortBy, setSortBy] = useState<string>('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Расходы аккаунта за период — отделяем рассылки от CPA-пула
  const chargesInPeriod = useMemo(
    () => accountCharges.filter((c) => c.date >= period.from && c.date <= period.to),
    [accountCharges, period.from, period.to]
  );
  const promotionPoolSpend = useMemo(
    () =>
      chargesInPeriod
        .filter((c) => c.kind === 'promotion_pool' || c.kind === 'refund')
        .reduce((s, c) => s + c.amount, 0),
    [chargesInPeriod]
  );
  const accountOtherSpend = useMemo(
    () =>
      chargesInPeriod
        .filter((c) => c.kind === 'account_other')
        .reduce((s, c) => s + c.amount, 0),
    [chargesInPeriod]
  );

  // Пересчитываем items: суммы метрик за выбранный период.
  // Если /stats/v2 дал точные per-item spend — используем их.
  // Иначе CPx-аванс распределяется пропорционально просмотрам.
  const itemsForPeriod = useMemo(
    () =>
      itemsInDateRange(
        items,
        metrics,
        period.from,
        period.to,
        accountCharges,
        hasPerItemSpend
      ),
    [items, metrics, period.from, period.to, accountCharges, hasPerItemSpend]
  );

  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category))).sort(),
    [items]
  );
  const regions = useMemo(
    () => Array.from(new Set(items.map((i) => i.region))).sort(),
    [items]
  );

  const filtered = useMemo(() => {
    const list = itemsForPeriod.filter((it) => {
      if (search && !it.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (category !== 'all' && it.category !== category) return false;
      if (region !== 'all' && it.region !== region) return false;
      if (status !== 'all' && it.status !== status) return false;
      if (efficiency !== 'all') {
        const e = classifyItem(it, kpi);
        if (efficiency === 'requiresAction') {
          if (!['overspend', 'noLeads', 'lowConversion'].includes(e)) return false;
        } else if (e !== efficiency) {
          return false;
        }
      }
      return true;
    });
    list.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      const get = (it: typeof a): number => {
        switch (sortBy) {
          case 'views':
            return it.views;
          case 'contacts':
            return it.contacts;
          case 'favorites':
            return it.favorites;
          case 'spend':
            return it.spend;
          case 'cpl':
            return calcCpl(it.spend, it.contacts) ?? Infinity;
          case 'conversion':
            return calcConversion(it.views, it.contacts) ?? -Infinity;
          case 'price':
            return it.price;
          case 'currentBid':
            return it.currentBid;
          default:
            return 0;
        }
      };
      return (get(a) - get(b)) * dir;
    });
    return list;
  }, [itemsForPeriod, kpi, search, category, region, status, efficiency, sortBy, sortDir]);

  return (
    <Layout
      title="Объявления"
      subtitle={`Найдено ${filtered.length} из ${items.length}. Период: ${period.from} — ${period.to}.`}
    >
      {/* Подсказка: на CPx-тарифе расход распределён по просмотрам. */}
      {promotionPoolSpend > 0 && (
        <div className="card border border-blue-500/30 bg-blue-500/5 p-3 mb-4 text-sm flex flex-wrap items-start gap-3">
          <Filter className="w-4 h-4 text-blue-300 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-white font-semibold mb-1">
              Расход за просмотры распределён пропорционально показам
            </div>
            <div className="text-ink-300 leading-relaxed">
              За период списано{' '}
              <span className="text-white">{formatRub(promotionPoolSpend)}</span> на
              продвижение (CPx-тариф, оплата за просмотры). Avito API
              эту сумму не делит по объявлениям — мы делим её
              пропорционально количеству просмотров каждого объявления за тот же период.
              Это близко к реальному распределению, но может отличаться от детализации
              в Авито Pro. Для точных цифр —{' '}
              <Link to="/settings" className="text-accent hover:underline">
                импортируйте CSV
              </Link>{' '}
              из Авито Pro → Статистика → Детализация.
            </div>
            {accountOtherSpend > 0 && (
              <div className="mt-1 text-ink-400 text-xs">
                Рассылки (без объявления): {formatRub(accountOtherSpend)} — не включены
                в колонку «Расход».
              </div>
            )}
          </div>
        </div>
      )}
      <div className="card p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-ink-400" />
          <h2 className="font-semibold text-white text-sm">Период и фильтры</h2>
        </div>
        <PeriodPicker value={period} onChange={setPeriod} className="mb-3" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <input
            placeholder="Поиск по названию"
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="all">Все категории</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
          >
            <option value="all">Все регионы</option>
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option value="all">Любой статус</option>
            <option value="active">Активные</option>
            <option value="paused">Приостановленные</option>
            <option value="archived">В архиве</option>
          </select>
          <select
            className="input"
            value={efficiency}
            onChange={(e) => setEfficiency(e.target.value as EfficiencyFilter)}
          >
            {Object.entries(efficiencyLabels).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty
          title="Объявления не найдены"
          hint="Попробуйте изменить фильтры или сбросить условия поиска."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th onClick={() => toggleSort('title')}>Название</Th>
                  <Th>Статус</Th>
                  <Th>Категория</Th>
                  <Th>Регион</Th>
                  <Th right onClick={() => toggleSort('price')}>
                    Цена
                  </Th>
                  <Th right onClick={() => toggleSort('views')}>
                    Просмотры
                  </Th>
                  <Th right onClick={() => toggleSort('contacts')}>
                    Контакты
                  </Th>
                  <Th right onClick={() => toggleSort('favorites')}>
                    Избранное
                  </Th>
                  <Th right onClick={() => toggleSort('spend')}>
                    Расход
                  </Th>
                  <Th right onClick={() => toggleSort('cpl')}>
                    CPL
                  </Th>
                  <Th right onClick={() => toggleSort('conversion')}>
                    CR
                  </Th>
                  <Th right onClick={() => toggleSort('currentBid')}>
                    Ставка
                  </Th>
                  <Th right>Реком.</Th>
                  <Th>Статус реком.</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((it) => (
                  <Row
                    key={it.id}
                    item={it}
                    onSetBid={(b) => setItemBid(it.id, b)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Layout>
  );

  function toggleSort(field: string) {
    if (sortBy === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortBy(field);
      setSortDir('desc');
    }
  }
}

function Th({
  children,
  right,
  onClick,
}: {
  children?: React.ReactNode;
  right?: boolean;
  onClick?: () => void;
}) {
  return (
    <th
      onClick={onClick}
      className={`table-th cursor-${onClick ? 'pointer' : 'default'} ${
        right ? 'text-right' : 'text-left'
      } whitespace-nowrap`}
    >
      {children}
    </th>
  );
}

function Row({
  item,
  onSetBid,
}: {
  item: AvitoItem;
  onSetBid: (b: number) => void;
}) {
  const cpl = calcCpl(item.spend, item.contacts);
  const cr = calcConversion(item.views, item.contacts);
  const diff = item.recommendedBid - item.currentBid;
  const diffPercent = item.currentBid
    ? Math.round((diff / item.currentBid) * 100)
    : 0;
  const eff = classifyItemBadge(item.recommendedBid, item.currentBid);

  return (
    <tr className="table-row">
      <td className="table-td">
        <Link
          to={`/items/${item.id}`}
          className="text-white hover:text-accent font-medium"
        >
          {item.title}
        </Link>
      </td>
      <td className="table-td">
        <StatusBadge status={item.status} />
      </td>
      <td className="table-td whitespace-nowrap">{item.category}</td>
      <td className="table-td whitespace-nowrap">{item.region}</td>
      <td className="table-td text-right whitespace-nowrap">{formatRub(item.price)}</td>
      <td className="table-td text-right">{formatNumber(item.views)}</td>
      <td className="table-td text-right">{formatNumber(item.contacts)}</td>
      <td className="table-td text-right">{formatNumber(item.favorites)}</td>
      <td className="table-td text-right whitespace-nowrap">{formatRub(item.spend)}</td>
      <td className="table-td text-right whitespace-nowrap">
        {cpl != null ? formatRub(cpl) : <span className="text-ink-500">нет лидов</span>}
      </td>
      <td className="table-td text-right whitespace-nowrap">
        {cr != null ? formatPercent(cr) : '—'}
      </td>
      <td className="table-td text-right">
        <BidInput value={item.currentBid} onChange={onSetBid} />
      </td>
      <td className="table-td text-right whitespace-nowrap">
        <span
          className={
            diff > 0 ? 'text-emerald-300' : diff < 0 ? 'text-rose-300' : 'text-ink-400'
          }
        >
          {item.recommendedBid} ₽ {diff !== 0 && `(${diff > 0 ? '+' : ''}${diffPercent}%)`}
        </span>
      </td>
      <td className="table-td">{eff}</td>
      <td className="table-td">
        <Link to={`/items/${item.id}`} className="btn-ghost">
          <ArrowRight className="w-4 h-4" />
        </Link>
      </td>
    </tr>
  );
}

function BidInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(String(value));
  if (!edit) {
    return (
      <button
        onClick={() => {
          setDraft(String(value));
          setEdit(true);
        }}
        className="inline-flex items-center gap-1 text-white hover:text-accent"
      >
        {value} ₽ <Pencil className="w-3 h-3 text-ink-500" />
      </button>
    );
  }
  return (
    <div className="inline-flex items-center gap-1">
      <input
        autoFocus
        className="input w-20 py-1 text-right"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const v = Math.max(1, Math.round(Number(draft) || value));
          onChange(v);
          setEdit(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEdit(false);
        }}
      />
    </div>
  );
}

function classifyItemBadge(rec: number, cur: number) {
  if (rec === cur) return <Badge tone="gray">Без изменений</Badge>;
  if (rec > cur)
    return (
      <Badge tone="green">
        <ArrowUpRight className="w-3 h-3" /> Повысить
      </Badge>
    );
  return (
    <Badge tone="red">
      <ArrowDownRight className="w-3 h-3" /> Снизить
    </Badge>
  );
}
