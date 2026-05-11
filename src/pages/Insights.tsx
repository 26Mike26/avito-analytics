import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Lightbulb,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Sparkles,
  ListChecks,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { Empty } from '../components/Empty';
import { Badge, PriorityBadge } from '../components/Badge';
import { useStore } from '../store/useStore';
import {
  buildChecklistRecommendations,
  buildInsights,
  compareWords,
  scoreItems,
  summarizeBucket,
  type ChecklistRecommendation,
  type ItemScore,
} from '../lib/insights';
import { formatNumber, formatPercent, formatRub, itemsInDateRange } from '../lib/analytics';

const BUCKET_LABELS = {
  top: 'Успешные (топ 33%)',
  mid: 'Средние',
  bottom: 'Неуспешные (низ 33%)',
};

export default function Insights() {
  const allItems = useStore((s) => s.items);
  const metrics = useStore((s) => s.metrics);
  const accountCharges = useStore((s) => s.accountCharges);
  const hasPerItemSpend = useStore((s) => s.hasPerItemSpend);
  const spendings = useStore((s) => s.spendings);
  const period = useStore((s) => s.analyticsPeriod);
  const kpi = useStore((s) => s.kpi);

  const adsTotalFromSpendings = useMemo(() => {
    if (!spendings) return null;
    const inRange = spendings.byDate.filter(
      (d) => d.date >= period.from && d.date <= period.to
    );
    return inRange.reduce((sum, day) => sum + day.ads, 0);
  }, [spendings, period.from, period.to]);

  const otherTotalInPeriod = useMemo(() => {
    if (spendings) {
      const inRange = spendings.byDate.filter(
        (d) => d.date >= period.from && d.date <= period.to
      );
      return inRange.reduce((sum, day) => sum + Math.max(0, day.total - day.ads), 0);
    }
    return accountCharges
      .filter((charge) => charge.date >= period.from && charge.date <= period.to)
      .filter((charge) => charge.kind === 'account_other')
      .reduce((sum, charge) => sum + charge.amount, 0);
  }, [spendings, accountCharges, period.from, period.to]);

  const items = useMemo(
    () =>
      itemsInDateRange(
        allItems,
        metrics,
        period.from,
        period.to,
        accountCharges,
        hasPerItemSpend,
        adsTotalFromSpendings,
        otherTotalInPeriod
      ),
    [
      allItems,
      metrics,
      period.from,
      period.to,
      accountCharges,
      hasPerItemSpend,
      adsTotalFromSpendings,
      otherTotalInPeriod,
    ]
  );

  const scored = useMemo(() => scoreItems(items, kpi), [items, kpi]);
  const successfulWithImages = useMemo(
    () => scored.filter((score) => score.bucket === 'top' && score.item.imageUrl).slice(0, 6),
    [scored]
  );
  const topSummary = useMemo(() => summarizeBucket(scored, 'top'), [scored]);
  const bottomSummary = useMemo(() => summarizeBucket(scored, 'bottom'), [scored]);
  const words = useMemo(() => compareWords(scored), [scored]);
  const insights = useMemo(
    () => buildInsights(topSummary, bottomSummary, words),
    [topSummary, bottomSummary, words]
  );
  const checklistRecommendations = useMemo(
    () => buildChecklistRecommendations(scored, kpi),
    [scored, kpi]
  );

  const [bucket, setBucket] = useState<'top' | 'bottom' | 'all'>('all');

  if (scored.length === 0) {
    return (
      <Layout
        title="Инсайты по объявлениям"
        subtitle={`Сравнение успешных и неуспешных объявлений за период ${period.from} — ${period.to}`}
      >
        <Empty
          title="Недостаточно данных"
          hint="Нужны активные объявления с просмотрами, показами, избранным или расходом. Подождите 5–7 дней или импортируйте выгрузку."
        />
      </Layout>
    );
  }

  const wordsTop = words.filter((w) => w.signal > 0).slice(0, 8);
  const wordsBottom = words.filter((w) => w.signal < 0).slice(0, 8);

  const visible: ItemScore[] = scored.filter((s) => {
    if (bucket === 'all') return true;
    return s.bucket === bucket;
  });

  return (
    <Layout
      title="Инсайты по объявлениям"
      subtitle={`Что общего у успешных объявлений и где провисают неудачные за период ${period.from} — ${period.to}`}
    >
      {/* Сравнение бакетов */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <BucketCard
          tone="green"
          title="Успешные объявления"
          icon={<TrendingUp className="w-5 h-5" />}
          summary={topSummary}
          highlight={
            scored.find((s) => s.bucket === 'top')?.item.title ?? '—'
          }
        />
        <BucketCard
          tone="red"
          title="Неуспешные объявления"
          icon={<TrendingDown className="w-5 h-5" />}
          summary={bottomSummary}
          highlight={
            scored.filter((s) => s.bucket === 'bottom').slice(-1)[0]?.item.title ?? '—'
          }
        />
      </div>

      {/* Инсайты — словесные выводы */}
      {insights.length > 0 && (
        <div className="card p-4 sm:p-5 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-bold text-white">Что мы видим</h2>
          </div>
          <ul className="space-y-2">
            {insights.map((ins, i) => (
              <li
                key={i}
                className={[
                  'flex items-start gap-3 text-sm rounded-lg p-3 border',
                  ins.level === 'good'
                    ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-100'
                    : ins.level === 'warn'
                    ? 'bg-amber-500/5 border-amber-500/20 text-amber-100'
                    : 'bg-rose-500/5 border-rose-500/20 text-rose-100',
                ].join(' ')}
              >
                {ins.level === 'good' ? (
                  <Sparkles className="w-4 h-4 mt-0.5 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                )}
                <span>{ins.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {checklistRecommendations.length > 0 && (
        <ChecklistRecommendations recommendations={checklistRecommendations} />
      )}

      {successfulWithImages.length > 0 && (
        <SuccessfulImages items={successfulWithImages} />
      )}

      {/* Слова */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="card p-4 sm:p-5">
          <div className="text-sm font-semibold text-white mb-3">
            Слова, чаще встречающиеся в УСПЕШНЫХ заголовках
          </div>
          {wordsTop.length === 0 ? (
            <div className="text-sm text-ink-400">Недостаточно повторяющихся слов.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {wordsTop.map((w) => (
                <Badge key={w.word} tone="green">
                  {w.word} · +{Math.round(w.signal * 100)}%
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="card p-4 sm:p-5">
          <div className="text-sm font-semibold text-white mb-3">
            Слова, чаще встречающиеся в НЕУСПЕШНЫХ заголовках
          </div>
          {wordsBottom.length === 0 ? (
            <div className="text-sm text-ink-400">Недостаточно повторяющихся слов.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {wordsBottom.map((w) => (
                <Badge key={w.word} tone="red">
                  {w.word} · {Math.round(w.signal * 100)}%
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Таблица — какие именно объявления попали в каждый бакет */}
      <div className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <h2 className="text-lg font-bold text-white">Объявления по бакетам</h2>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setBucket('all')}
              className={[
                'chip',
                bucket === 'all'
                  ? 'bg-accent/15 text-accent border border-accent/30'
                  : 'bg-ink-800 text-ink-300 border border-ink-700',
              ].join(' ')}
            >
              Все
            </button>
            <button
              onClick={() => setBucket('top')}
              className={[
                'chip',
                bucket === 'top'
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                  : 'bg-ink-800 text-ink-300 border border-ink-700',
              ].join(' ')}
            >
              Топ
            </button>
            <button
              onClick={() => setBucket('bottom')}
              className={[
                'chip',
                bucket === 'bottom'
                  ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                  : 'bg-ink-800 text-ink-300 border border-ink-700',
              ].join(' ')}
            >
              Низ
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-th">Название</th>
                <th className="table-th">Категория</th>
                <th className="table-th text-right">Score</th>
                <th className="table-th text-right">CPL</th>
                <th className="table-th text-right">Конверсия</th>
                <th className="table-th text-right">Контактов</th>
                <th className="table-th">Бакет</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ item, bucket, score, cpl, conversion }) => (
                <tr key={item.id} className="table-row">
                  <td className="table-td">
                    <Link
                      to={`/items/${item.id}`}
                      className="text-white hover:text-accent"
                    >
                      {item.title}
                    </Link>
                  </td>
                  <td className="table-td text-ink-400">{item.category}</td>
                  <td className="table-td text-right text-white font-semibold">
                    {score}
                  </td>
                  <td className="table-td text-right">
                    {cpl != null ? formatRub(cpl) : '—'}
                  </td>
                  <td className="table-td text-right">
                    {conversion != null ? formatPercent(conversion) : '—'}
                  </td>
                  <td className="table-td text-right">{item.contacts}</td>
                  <td className="table-td">
                    {bucket === 'top' ? (
                      <Badge tone="green">Топ</Badge>
                    ) : bucket === 'bottom' ? (
                      <Badge tone="red">Низ</Badge>
                    ) : (
                      <Badge tone="gray">Средние</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}

function SuccessfulImages({ items }: { items: ItemScore[] }) {
  return (
    <div className="card p-4 sm:p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-5 h-5 text-emerald-300" />
        <h2 className="text-lg font-bold text-white">Первые фото успешных объявлений</h2>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {items.map(({ item, cpl, conversion }) => (
          <Link
            key={item.id}
            to={`/items/${item.id}`}
            className="group rounded-xl border border-ink-700 bg-ink-900/50 overflow-hidden hover:border-emerald-500/50 transition-colors"
          >
            <div className="aspect-[4/3] bg-ink-800 overflow-hidden">
              <img
                src={item.imageUrl}
                alt={item.title}
                loading="lazy"
                className="h-full w-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
              />
            </div>
            <div className="p-3">
              <div className="text-sm text-white font-medium line-clamp-2 min-h-10">
                {item.title}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone="green">CPL {cpl != null ? formatRub(cpl) : '—'}</Badge>
                <Badge tone="gray">CR {conversion != null ? formatPercent(conversion) : '—'}</Badge>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function ChecklistRecommendations({
  recommendations,
}: {
  recommendations: ChecklistRecommendation[];
}) {
  return (
    <div className="card p-4 sm:p-5 mb-6">
      <div className="flex flex-wrap items-start gap-3 mb-4">
        <div className="text-accent mt-0.5">
          <ListChecks className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white">
            Рекомендации по неуспешным объявлениям
          </h2>
          <div className="text-sm text-ink-400 mt-1">
            Автоматическая проверка по чек-листу: заголовки, параметры, фото/видео,
            текст, цена и продвижение.
          </div>
        </div>
      </div>

      <div className="divide-y divide-ink-700/70">
        {recommendations.map((rec) => (
          <article key={rec.item.id} className="py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <Link
                  to={`/items/${rec.item.id}`}
                  className="text-white font-semibold hover:text-accent"
                >
                  {rec.item.title}
                </Link>
                <div className="text-xs text-ink-400 mt-1">
                  {[rec.item.category, rec.item.region].filter(Boolean).join(' · ')}
                </div>
              </div>
              <PriorityBadge priority={rec.priority} />
            </div>

            <div className="flex flex-wrap gap-2 mt-3">
              <Badge tone="gray">Score {rec.score}</Badge>
              <Badge tone={rec.cpl == null ? 'red' : 'gray'}>
                CPL {rec.cpl != null ? formatRub(rec.cpl) : 'нет лидов'}
              </Badge>
              <Badge tone={rec.conversion != null && rec.conversion < 1 ? 'amber' : 'gray'}>
                CR {rec.conversion != null ? formatPercent(rec.conversion) : '—'}
              </Badge>
              <Badge tone={rec.ctr != null && rec.ctr < 1 ? 'amber' : 'gray'}>
                CTR {rec.ctr != null ? formatPercent(rec.ctr) : '—'}
              </Badge>
              <Badge tone="gray">Просмотры {formatNumber(rec.item.views)}</Badge>
              <Badge tone="gray">Контакты {formatNumber(rec.item.contacts)}</Badge>
            </div>

            <div className="mt-3 text-sm text-ink-300">
              {(rec.reasons.length > 0
                ? rec.reasons
                : ['объявление попало в нижнюю группу по эффективности']
              ).join('; ')}
            </div>

            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
              {rec.checks.map((check) => (
                <div
                  key={`${check.group}-${check.title}`}
                  className={[
                    'rounded-xl border p-3',
                    check.severity === 'bad'
                      ? 'bg-rose-500/5 border-rose-500/20'
                      : 'bg-amber-500/5 border-amber-500/20',
                  ].join(' ')}
                >
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <Badge tone={check.severity === 'bad' ? 'red' : 'amber'}>
                      {check.group}
                    </Badge>
                    <div className="text-sm font-semibold text-white">{check.title}</div>
                  </div>
                  <div className="text-xs text-ink-400 leading-relaxed">{check.detail}</div>
                  <div className="text-sm text-ink-200 mt-2">{check.action}</div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function BucketCard({
  tone,
  title,
  icon,
  summary,
  highlight,
}: {
  tone: 'green' | 'red';
  title: string;
  icon: React.ReactNode;
  summary: ReturnType<typeof summarizeBucket>;
  highlight: string;
}) {
  const cls =
    tone === 'green'
      ? 'border-emerald-500/30 bg-emerald-500/5'
      : 'border-rose-500/30 bg-rose-500/5';
  return (
    <div className={`card border ${cls} p-4 sm:p-5`}>
      <div className="flex items-center gap-2 mb-3">
        <div
          className={
            tone === 'green'
              ? 'text-emerald-300'
              : 'text-rose-300'
          }
        >
          {icon}
        </div>
        <h3 className="font-semibold text-white">{title}</h3>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <Stat label="Объявлений" value={String(summary.count)} />
        <Stat
          label="Средний CPL"
          value={summary.averageCpl != null ? formatRub(summary.averageCpl) : '—'}
        />
        <Stat
          label="Конверсия"
          value={
            summary.averageConversion != null
              ? formatPercent(summary.averageConversion)
              : '—'
          }
        />
        <Stat
          label="Длина заголовка"
          value={`${summary.averageTitleLength} симв.`}
        />
        <Stat label="Сред. цена" value={formatRub(summary.averagePrice)} />
        <Stat label="Сред. ставка" value={formatRub(summary.averageBid)} />
        <Stat label="Контактов" value={String(summary.totalContacts)} />
        <Stat label="Расход" value={formatRub(summary.totalSpend)} />
      </div>
      <div className="mt-4 pt-3 border-t border-ink-700 text-xs text-ink-400">
        Пример: <span className="text-white">«{highlight}»</span>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-ink-400">
        {label}
      </div>
      <div className="text-white font-semibold">{value}</div>
    </div>
  );
}
