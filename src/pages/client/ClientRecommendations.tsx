import { useMemo, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import { Layout } from '../../components/Layout';
import { Badge, PriorityBadge } from '../../components/Badge';
import { Empty } from '../../components/Empty';
import { PeriodPicker } from '../../components/PeriodPicker';
import { useStore } from '../../store/useStore';
import { useClientScope } from '../../lib/clientScope';
import { accountViewForPeriod } from '../../lib/clientAnalytics';
import type { Recommendation } from '../../types';

const typeLabel: Record<string, string> = {
  bid: 'Ставка',
  budget: 'Бюджет',
  content: 'Контент',
  price: 'Цена',
  kpi: 'KPI',
  account: 'Аккаунт',
};

export default function ClientRecommendations() {
  const user = useStore((s) => s.currentUser);
  const accountsMap = useStore((s) => s.accounts);
  const period = useStore((s) => s.analyticsPeriod);
  const setPeriod = useStore((s) => s.setAnalyticsPeriod);
  const { scope, setScope, visibleAccounts, scopedAccounts } = useClientScope(user, accountsMap);
  const [priority, setPriority] = useState<'all' | Recommendation['priority']>('all');

  const rows = useMemo(
    () =>
      scopedAccounts
        .flatMap((account) =>
          accountViewForPeriod(account, period).recommendations.map((recommendation) => ({
            account,
            recommendation,
          }))
        )
        .filter(({ recommendation }) => recommendation.status === 'new')
        .filter(({ recommendation }) => priority === 'all' || recommendation.priority === priority)
        .sort((a, b) => {
          const rank = { high: 0, medium: 1, low: 2 };
          return rank[a.recommendation.priority] - rank[b.recommendation.priority];
        }),
    [period, priority, scopedAccounts]
  );

  return (
    <Layout
      title="Рекомендации и инсайты"
      subtitle="Read-only список проблем и гипотез по доступным аккаунтам"
    >
      <div className="card p-4 sm:p-5 mb-5">
        <div className="space-y-3">
          <div>
            <div className="text-sm font-semibold text-white">Фильтры рекомендаций</div>
            <div className="text-xs text-ink-400 mt-1">
              Клиент видит рекомендации, но не может применять действия из платформы.
            </div>
          </div>
          <div className="flex flex-col xl:flex-row xl:items-center gap-3">
            <select className="input w-full xl:w-72 xl:shrink-0" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all">Все доступные аккаунты</option>
              {visibleAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
            <select className="input w-full xl:w-48 xl:shrink-0" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
              <option value="all">Любой приоритет</option>
              <option value="high">Высокий</option>
              <option value="medium">Средний</option>
              <option value="low">Низкий</option>
            </select>
            <PeriodPicker value={period} onChange={setPeriod} className="xl:flex-1 xl:justify-end" />
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty title="Новых рекомендаций нет" hint="За выбранный период критичных инсайтов не найдено." />
      ) : (
        <div className="space-y-3">
          {rows.map(({ account, recommendation }) => (
            <div key={`${account.id}:${recommendation.id}`} className="card p-4">
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0">
                  <Lightbulb className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <PriorityBadge priority={recommendation.priority} />
                    <Badge tone="blue">{typeLabel[recommendation.type] ?? recommendation.type}</Badge>
                    <Badge tone="gray">{account.name}</Badge>
                  </div>
                  <div className="font-semibold text-white">{recommendation.title}</div>
                  <div className="text-sm text-ink-300 mt-1">{recommendation.description}</div>
                  <div className="text-xs text-ink-400 mt-2">
                    Ожидаемый эффект: {recommendation.expectedEffect}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
