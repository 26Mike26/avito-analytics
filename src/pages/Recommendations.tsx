import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Clock, Lightbulb, X } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Badge, PriorityBadge } from '../components/Badge';
import { useStore } from '../store/useStore';
import { recommendationGroups } from '../lib/recommendations';
import { Empty } from '../components/Empty';

const typeLabel: Record<string, string> = {
  bid: 'Ставка',
  budget: 'Бюджет',
  content: 'Контент',
  price: 'Цена',
  kpi: 'KPI',
  account: 'Аккаунт',
};

type StatusFilter = 'new' | 'accepted' | 'postponed' | 'declined' | 'all';

export default function Recommendations() {
  const recommendations = useStore((s) => s.recommendations);
  const acceptRec = useStore((s) => s.applyRecommendation);
  const declineRec = useStore((s) => s.declineRecommendation);
  const postponeRec = useStore((s) => s.postponeRecommendation);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('new');
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'high' | 'medium' | 'low'>(
    'all'
  );
  const [typeFilter, setTypeFilter] = useState<'all' | string>('all');

  const filtered = recommendations.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (priorityFilter !== 'all' && r.priority !== priorityFilter) return false;
    if (typeFilter !== 'all' && r.type !== typeFilter) return false;
    return true;
  });

  const groups = recommendationGroups(filtered);

  return (
    <Layout
      title="Рекомендации"
      subtitle="Приоритизированный список действий, чтобы быстрее достигать KPI"
    >
      <div className="pill-nav mb-4">
        <Link to="/recommendations" className="pill-nav-item active">
          Рекомендации
        </Link>
        <Link to="/insights" className="pill-nav-item">
          Инсайты
        </Link>
      </div>

      <div className="card p-4 mb-4 flex flex-wrap items-center gap-3">
        <div className="pill-nav">
          {(
            [
              ['new', 'Новые'],
              ['accepted', 'Принятые'],
              ['postponed', 'Отложенные'],
              ['declined', 'Отклонённые'],
              ['all', 'Все'],
            ] satisfies Array<[StatusFilter, string]>
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setStatusFilter(k)}
              className={['pill-nav-item', statusFilter === k ? 'active' : ''].join(' ')}
            >
              {l}
            </button>
          ))}
        </div>
        <select
          className="input w-auto"
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as typeof priorityFilter)}
        >
          <option value="all">Любой приоритет</option>
          <option value="high">Высокий</option>
          <option value="medium">Средний</option>
          <option value="low">Низкий</option>
        </select>
        <select
          className="input w-auto"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="all">Любой тип</option>
          {Object.entries(typeLabel).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <div className="ml-auto text-sm text-ink-400">
          Показано {filtered.length} рекомендаций
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty
          title="Рекомендаций нет"
          hint="Попробуйте изменить фильтры или дождаться накопления новой статистики."
        />
      ) : (
        <div className="space-y-6">
          {groups.map(([group, recs]) => (
            <section key={group}>
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb className="w-4 h-4 text-accent" />
                <h2 className="font-semibold text-white">{group}</h2>
                <Badge tone="gray">{recs.length}</Badge>
              </div>
              <div className="space-y-2">
                {recs.map((r) => (
                  <div
                    key={r.id}
                    className={[
                      'card p-4 flex flex-col md:flex-row md:items-start gap-3 md:gap-4',
                      r.status === 'accepted'
                        ? 'opacity-60'
                        : r.status === 'declined'
                        ? 'opacity-50'
                        : '',
                    ].join(' ')}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1.5">
                        <PriorityBadge priority={r.priority} />
                        <Badge tone="blue">{typeLabel[r.type] ?? r.type}</Badge>
                        {r.status === 'accepted' && <Badge tone="green">Принято</Badge>}
                        {r.status === 'declined' && <Badge tone="gray">Отклонено</Badge>}
                        {r.status === 'postponed' && <Badge tone="amber">Отложено</Badge>}
                      </div>
                      <div className="text-sm font-medium text-white">{r.title}</div>
                      <div className="text-sm text-ink-300 mt-1">{r.description}</div>
                      <div className="text-xs text-ink-400 mt-2">
                        Ожидаемый эффект: {r.expectedEffect}
                      </div>
                    </div>
                    <div className="md:shrink-0 flex flex-col md:items-end gap-2">
                      {r.itemId && (
                        <Link
                          to={`/items/${r.itemId}`}
                          className="text-xs text-accent hover:underline"
                        >
                          Открыть объявление →
                        </Link>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          className="btn-secondary"
                          disabled={r.status !== 'new'}
                          onClick={() => postponeRec(r.id)}
                        >
                          <Clock className="w-4 h-4" /> Позже
                        </button>
                        <button
                          className="btn-danger"
                          disabled={r.status !== 'new'}
                          onClick={() => declineRec(r.id)}
                        >
                          <X className="w-4 h-4" /> Отклонить
                        </button>
                        <button
                          className="btn-primary"
                          disabled={r.status !== 'new'}
                          onClick={() => acceptRec(r.id)}
                        >
                          <Check className="w-4 h-4" /> Принять
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Layout>
  );
}
