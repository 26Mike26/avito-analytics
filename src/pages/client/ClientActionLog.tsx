import { useMemo, useState } from 'react';
import { History } from 'lucide-react';
import { Layout } from '../../components/Layout';
import { Badge } from '../../components/Badge';
import { Empty } from '../../components/Empty';
import { PeriodPicker } from '../../components/PeriodPicker';
import { useStore } from '../../store/useStore';
import { visibleAccountIdsForUser, visibleAccountsForUser } from '../../lib/clientAccess';

type Scope = 'all' | string;

const typeLabel: Record<string, string> = {
  avito_item_published: 'Публикация',
  avito_item_archived: 'Снятие',
  avito_item_edited: 'Изменение',
  avito_promotion_applied: 'Продвижение',
  avito_promotion_stopped: 'Остановка продвижения',
  avito_balance_topup: 'Пополнение',
  avito_balance_charge: 'Списание',
  avito_message_received: 'Сообщение',
  avito_call_received: 'Звонок',
  avito_review_received: 'Отзыв',
  avito_other: 'Прочее',
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ClientActionLog() {
  const user = useStore((s) => s.currentUser);
  const accountsMap = useStore((s) => s.accounts);
  const actionLog = useStore((s) => s.actionLog);
  const period = useStore((s) => s.analyticsPeriod);
  const setPeriod = useStore((s) => s.setAnalyticsPeriod);
  const [scope, setScope] = useState<Scope>('all');

  const accounts = useMemo(() => visibleAccountsForUser(user, accountsMap), [accountsMap, user]);
  const visibleIds = useMemo(() => new Set(visibleAccountIdsForUser(user, accountsMap)), [accountsMap, user]);
  const rows = useMemo(
    () =>
      actionLog
        .filter((entry) => entry.source === 'avito')
        .filter((entry) => !entry.accountId || visibleIds.has(entry.accountId))
        .filter((entry) => scope === 'all' || entry.accountId === scope)
        .filter((entry) => {
          const day = entry.timestamp.slice(0, 10);
          return day >= period.from && day <= period.to;
        })
        .slice(0, 300),
    [actionLog, period.from, period.to, scope, visibleIds]
  );

  return (
    <Layout
      title="Клиентский журнал действий"
      subtitle="Краткая история действий в аккаунтах Авито за выбранный период"
    >
      <div className="card p-4 sm:p-5 mb-5">
        <div className="flex flex-col xl:flex-row xl:items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white">Фильтры журнала</div>
            <div className="text-xs text-ink-400 mt-1">
              В журнал попадают только события аккаунта Авито, без внутренних действий платформы.
            </div>
          </div>
          <select className="input w-full xl:w-72" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">Все доступные аккаунты</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          <PeriodPicker value={period} onChange={setPeriod} className="xl:justify-end" />
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty title="За период действий нет" hint="События появятся после синхронизации аккаунтов с Авито." />
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-ink-700/70 flex items-center gap-2">
            <History className="w-4 h-4 text-accent" />
            <h2 className="font-semibold text-white">События</h2>
            <span className="text-xs text-ink-500">{rows.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="table-th min-w-[120px]">Время</th>
                  <th className="table-th min-w-[180px]">Аккаунт</th>
                  <th className="table-th min-w-[160px]">Тип</th>
                  <th className="table-th min-w-[320px]">Описание</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr key={entry.id} className="table-row">
                    <td className="table-td whitespace-nowrap">{formatDateTime(entry.timestamp)}</td>
                    <td className="table-td text-white">
                      {entry.accountId ? accountsMap[entry.accountId]?.name ?? 'Аккаунт' : '—'}
                    </td>
                    <td className="table-td">
                      <Badge tone="blue">{typeLabel[entry.type] ?? entry.type}</Badge>
                    </td>
                    <td className="table-td">
                      <div className="text-white">{entry.title}</div>
                      {entry.details && <div className="text-xs text-ink-400 mt-1">{entry.details}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Layout>
  );
}
