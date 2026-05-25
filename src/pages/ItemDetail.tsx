import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ExternalLink,
  History,
  Lightbulb,
  StickyNote,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Layout } from '../components/Layout';
import { Badge, StatusBadge } from '../components/Badge';
import { useStore } from '../store/useStore';
import {
  aggregateMetricsByDate,
  calcConversion,
  calcCpl,
  categoryAverages,
  formatNumber,
  formatPercent,
  formatRub,
  subcategoryName,
} from '../lib/analytics';
import { calculateBidRecommendation } from '../lib/recommendations';
import { Empty } from '../components/Empty';

export default function ItemDetail() {
  const { id } = useParams<{ id: string }>();
  const items = useStore((s) => s.items);
  const metrics = useStore((s) => s.metrics);
  const kpi = useStore((s) => s.kpi);
  const initialized = useStore((s) => s.initialized);
  const loading = useStore((s) => s.loading);
  const setItemBid = useStore((s) => s.setItemBid);
  const bidHistory = useStore((s) => s.bidHistory);
  const notes = useStore((s) => s.notes);
  const setNote = useStore((s) => s.setNote);

  // Толерантный поиск: и URL-id, и items[].id могут оказаться числом или
  // строкой в зависимости от источника (демо/CSV/API). Приводим оба к строке.
  const item = items.find((i) => String(i.id) === String(id));
  const itemMetrics = useMemo(
    () => metrics.filter((m) => String(m.itemId) === String(id)),
    [metrics, id]
  );
  const dailySeries = useMemo(
    () => aggregateMetricsByDate(itemMetrics),
    [itemMetrics]
  );
  const categoryStats = useMemo(() => categoryAverages(items), [items]);

  const [bidDraft, setBidDraft] = useState<string>('');
  const itemNote = notes[String(id ?? '')] ?? '';
  const [noteDraft, setNoteDraft] = useState(itemNote);

  useEffect(() => {
    setBidDraft('');
    setNoteDraft(itemNote);
  }, [id, itemNote]);

  // Состояние загрузки: store ещё не подтянул данные → показываем спиннер,
  // а не «не найдено». Это убирает мерцание «отключено», когда на самом деле
  // идёт первый init или обновление через API.
  if (!initialized || loading) {
    return (
      <Layout title="Загрузка объявления…">
        <div className="card p-8 text-center text-ink-300">
          Загружаем данные аккаунта…
        </div>
      </Layout>
    );
  }

  if (!item) {
    return (
      <Layout title="Объявление не найдено">
        <Empty
          title="Не удалось найти объявление"
          hint={`ID «${id}» отсутствует в загруженных данных. Возможно, объявление было снято с публикации, либо данные ещё не подтянулись — нажмите «Обновить» в шапке. Сейчас в аккаунте загружено объявлений: ${items.length}.`}
          action={
            <Link to="/items" className="btn-primary">
              К списку объявлений
            </Link>
          }
        />
      </Layout>
    );
  }

  const cpl = calcCpl(item.spend, item.contacts);
  const cr = calcConversion(item.views, item.contacts);
  const catAvg = categoryStats.get(subcategoryName(item.category));
  const bidRec = calculateBidRecommendation(item, kpi, metrics);
  const itemHistory = bidHistory.filter((h) => h.itemId === item.id);

  const hypotheses: string[] = [];
  if (cpl != null && cpl > kpi.targetCpl)
    hypotheses.push(
      'Снизьте ставку или сократите регионы показа — CPL выше целевого.'
    );
  if (cr != null && catAvg?.conversion != null && cr < catAvg.conversion)
    hypotheses.push(
      'Конверсия ниже среднего по категории. Обновите главное фото и заголовок.'
    );
  if (item.views < 200)
    hypotheses.push(
      'Мало просмотров — попробуйте слегка повысить ставку и проверить ключевые слова в заголовке.'
    );
  if (item.favorites > item.contacts * 3 && item.contacts > 0)
    hypotheses.push(
      'Много добавлений в избранное при малом числе контактов. Проверьте цену и описание условий.'
    );
  if (hypotheses.length === 0)
    hypotheses.push(
      'Серьёзных проблем не выявлено. Продолжайте отслеживать показатели и накапливать статистику.'
    );

  return (
    <Layout
      title={item.title}
      subtitle={`${item.category} · ${item.region} · создано ${item.createdAt}`}
    >
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Link to="/items" className="btn-ghost">
          <ArrowLeft className="w-4 h-4" /> К списку
        </Link>
        <StatusBadge status={item.status} />
        {/* Если из API известна ссылка — открываем сам Авито в новой вкладке.
            Если нет (например данные из CSV) — собираем по ID. */}
        <a
          href={
            item.url
              ? item.url
              : `https://www.avito.ru/items/${encodeURIComponent(item.id)}`
          }
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary w-full sm:w-auto sm:ml-auto"
        >
          <ExternalLink className="w-4 h-4" /> Открыть на Авито
        </a>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Просмотры" value={formatNumber(item.views)} />
        <Stat label="Контакты" value={formatNumber(item.contacts)} />
        <Stat label="Расход" value={formatRub(item.spend)} />
        <Stat
          label="CPL"
          value={cpl != null ? formatRub(cpl) : 'нет лидов'}
          tone={
            cpl == null
              ? 'gray'
              : cpl <= kpi.targetCpl
              ? 'green'
              : cpl > kpi.targetCpl * 1.2
              ? 'red'
              : 'amber'
          }
        />
        <Stat
          label="Конверсия"
          value={cr != null ? formatPercent(cr) : '—'}
          tone={
            cr == null
              ? 'gray'
              : cr >= kpi.targetConversionRate
              ? 'green'
              : 'amber'
          }
        />
        <Stat label="Избранное" value={formatNumber(item.favorites)} />
        <Stat label="Цена" value={formatRub(item.price)} />
        <Stat
          label="Выручка"
          value={item.revenue ? formatRub(item.revenue) : '—'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <ChartCard title="Просмотры и контакты по дням">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={dailySeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#262630" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="views" stroke="#60a5fa" name="Просмотры" dot={false} />
              <Line type="monotone" dataKey="contacts" stroke="#34d399" name="Контакты" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Расход и CPL по дням">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={dailySeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#262630" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Area
                type="monotone"
                dataKey="spend"
                stroke="#FF6A00"
                fill="rgba(255,106,0,0.10)"
                name="Расход, ₽"
              />
              <Line type="monotone" dataKey="cpl" stroke="#f87171" name="CPL, ₽" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-4 h-4 text-accent" />
            <h2 className="font-semibold text-white">Рекомендации</h2>
          </div>
          <RecommendationBlock
            title="По ставке"
            tone={bidRec.diffPercent > 0 ? 'green' : bidRec.diffPercent < 0 ? 'red' : 'gray'}
            description={bidRec.reason}
            extra={
              <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-ink-400">
                <span>Текущая: {item.currentBid} ₽</span>
                <span>Рекомендуем: {item.recommendedBid} ₽</span>
                <span>
                  Прогноз расхода: {formatRub(bidRec.forecastSpend)} · лидов ~
                  {bidRec.forecastContacts}
                </span>
              </div>
            }
            action={
              <button
                className="btn-primary w-full sm:w-auto"
                disabled={bidRec.diffPercent === 0}
                onClick={() =>
                  setItemBid(item.id, item.recommendedBid, `Применена рекомендация по ставке`)
                }
              >
                Применить
              </button>
            }
          />
          <RecommendationBlock
            title="По контенту"
            tone="blue"
            description={
              cr != null && catAvg?.conversion != null && cr < catAvg.conversion
                ? `Конверсия ${formatPercent(cr)} ниже средней по категории «${subcategoryName(item.category)}» (${formatPercent(
                    catAvg.conversion
                  )}). Обновите фото, заголовок и первые строки описания.`
                : 'Контент в норме относительно категории. Можно продолжать без правок.'
            }
          />
          <RecommendationBlock
            title="По цене"
            tone="amber"
            description={
              item.favorites > item.contacts * 3 && item.contacts > 0
                ? 'Объявление часто добавляют в избранное, но не пишут. Проверьте, не завышена ли цена.'
                : 'Цена выглядит адекватно текущему уровню интереса.'
            }
          />
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <History className="w-4 h-4 text-ink-400" />
            <h2 className="font-semibold text-white">История ставок</h2>
          </div>
          {itemHistory.length === 0 ? (
            <div className="text-sm text-ink-400">Изменений ставки пока не было.</div>
          ) : (
            <ul className="space-y-2">
              {itemHistory.slice(0, 8).map((h) => (
                <li key={h.id} className="text-sm border-b border-ink-800 pb-2 last:border-0">
                  <div className="flex items-center justify-between">
                    <span className="text-white font-medium">
                      {h.oldBid} → {h.newBid} ₽
                    </span>
                    <span className="text-xs text-ink-400">
                      {new Date(h.date).toLocaleString('ru-RU')}
                    </span>
                  </div>
                  <div className="text-xs text-ink-400 mt-0.5">{h.reason}</div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <span className="label">Изменить ставку вручную</span>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="number"
                className="input"
                placeholder={`Сейчас: ${item.currentBid} ₽`}
                value={bidDraft}
                onChange={(e) => setBidDraft(e.target.value)}
              />
              <button
                className="btn-primary w-full sm:w-auto"
                onClick={() => {
                  const v = Math.max(1, Math.round(Number(bidDraft)));
                  if (!isNaN(v) && v > 0) {
                    setItemBid(item.id, v, 'Ручное изменение ставки');
                    setBidDraft('');
                  }
                }}
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-5 lg:col-span-2">
          <h2 className="font-semibold text-white mb-3">Сравнение с категорией</h2>
          {catAvg ? (
            <div className="grid grid-cols-3 gap-4 text-sm">
              <Cmp
                label="CPL"
                me={cpl != null ? formatRub(cpl) : '—'}
                avg={catAvg.cpl != null ? formatRub(catAvg.cpl) : '—'}
                meBetter={cpl != null && catAvg.cpl != null && cpl <= catAvg.cpl}
              />
              <Cmp
                label="Конверсия"
                me={cr != null ? formatPercent(cr) : '—'}
                avg={catAvg.conversion != null ? formatPercent(catAvg.conversion) : '—'}
                meBetter={
                  cr != null && catAvg.conversion != null && cr >= catAvg.conversion
                }
              />
              <Cmp
                label="Расход в категории"
                me={formatRub(item.spend)}
                avg={formatRub(catAvg.spend)}
              />
            </div>
          ) : (
            <div className="text-sm text-ink-400">Нет данных по категории.</div>
          )}

          <h3 className="font-semibold text-white mt-6 mb-2">Гипотезы для улучшения</h3>
          <ul className="space-y-2">
            {hypotheses.map((h, i) => (
              <li
                key={i}
                className="text-sm text-ink-100 bg-ink-850 border border-ink-700 rounded-lg p-3"
              >
                {h}
              </li>
            ))}
          </ul>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <StickyNote className="w-4 h-4 text-amber-400" />
            <h2 className="font-semibold text-white">Заметка</h2>
          </div>
          <textarea
            className="input min-h-[120px]"
            placeholder="Запишите контекст по объявлению, договорённости с клиентом и т.д."
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
          />
          <button className="btn-secondary mt-2 w-full sm:w-auto" onClick={() => setNote(item.id, noteDraft)}>
            Сохранить заметку
          </button>
          {itemNote && noteDraft === itemNote && (
            <div className="text-xs text-emerald-300 mt-2">Заметка сохранена.</div>
          )}
        </div>
      </div>
    </Layout>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'green' | 'amber' | 'red' | 'gray';
}) {
  const colors = {
    default: 'text-white',
    green: 'text-emerald-300',
    amber: 'text-amber-300',
    red: 'text-rose-300',
    gray: 'text-ink-400',
  };
  return (
    <div className="card p-4">
      <div className="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">
        {label}
      </div>
      <div className={`text-lg font-semibold mt-1 ${colors[tone]}`}>{value}</div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h3 className="font-semibold text-white mb-3">{title}</h3>
      {children}
    </div>
  );
}

function RecommendationBlock({
  title,
  description,
  tone,
  extra,
  action,
}: {
  title: string;
  description: string;
  tone: 'green' | 'red' | 'amber' | 'blue' | 'gray';
  extra?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="border border-ink-700 rounded-lg p-3 mb-3 last:mb-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge tone={tone}>{title}</Badge>
            {tone === 'green' && <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />}
            {tone === 'red' && <TrendingDown className="w-3.5 h-3.5 text-rose-500" />}
          </div>
          <div className="text-sm text-ink-100">{description}</div>
          {extra}
        </div>
        {action}
      </div>
    </div>
  );
}

function Cmp({
  label,
  me,
  avg,
  meBetter,
}: {
  label: string;
  me: string;
  avg: string;
  meBetter?: boolean;
}) {
  return (
    <div className="border border-ink-700 rounded-lg p-3">
      <div className="text-xs text-ink-400">{label}</div>
      <div className="text-base font-semibold text-white mt-1">{me}</div>
      <div className="text-xs text-ink-400 mt-1">
        В среднем по категории: {avg}{' '}
        {meBetter !== undefined && (
          <span className={meBetter ? 'text-emerald-300' : 'text-rose-300'}>
            {meBetter ? '· лучше' : '· хуже'}
          </span>
        )}
      </div>
    </div>
  );
}
