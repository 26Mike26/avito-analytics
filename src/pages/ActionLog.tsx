import { useMemo, useState } from 'react';
import { Download, FileText, RefreshCw, Trash2 } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Badge } from '../components/Badge';
import { Empty } from '../components/Empty';
import { PeriodPicker, type PeriodValue } from '../components/PeriodPicker';
import { lastNDaysRange } from '../lib/analytics';
import { useStore } from '../store/useStore';
import type { ActionLogEntry, ActionSource, ActionType } from '../types';

const TYPE_LABELS: Record<ActionType, string> = {
  login: 'Вход',
  logout: 'Выход',
  signup: 'Регистрация',
  account_created: 'Аккаунт создан',
  account_renamed: 'Переименование',
  account_removed: 'Аккаунт удалён',
  account_switched: 'Переключение',
  kpi_changed: 'KPI изменены',
  item_bid_changed: 'Ставка изменена',
  item_bid_bulk_applied: 'Массовое применение',
  recommendation_accepted: 'Рекомендация принята',
  recommendation_declined: 'Рекомендация отклонена',
  recommendation_postponed: 'Рекомендация отложена',
  csv_imported: 'Импорт CSV',
  integration_updated: 'Интеграция',
  item_note_set: 'Заметка',
  data_reloaded: 'Синхронизация',
  reset_to_demo: 'Сброс к демо',
  avito_item_published: 'Объявление опубликовано',
  avito_item_archived: 'Объявление снято',
  avito_item_edited: 'Объявление отредактировано',
  avito_promotion_applied: 'Продвижение активировано',
  avito_promotion_stopped: 'Продвижение остановлено',
  avito_balance_topup: 'Пополнение баланса',
  avito_balance_charge: 'Списание баланса',
  avito_message_received: 'Сообщение в чат',
  avito_call_received: 'Входящий звонок',
  avito_review_received: 'Новый отзыв',
  avito_other: 'Прочее (Авито)',
};

const TYPE_TONES: Partial<Record<ActionType, 'green' | 'red' | 'amber' | 'blue' | 'gray' | 'violet'>> = {
  login: 'green',
  logout: 'gray',
  signup: 'green',
  account_created: 'blue',
  account_renamed: 'blue',
  account_removed: 'red',
  account_switched: 'blue',
  kpi_changed: 'amber',
  item_bid_changed: 'amber',
  item_bid_bulk_applied: 'amber',
  recommendation_accepted: 'green',
  recommendation_declined: 'gray',
  recommendation_postponed: 'amber',
  csv_imported: 'violet',
  integration_updated: 'blue',
  item_note_set: 'gray',
  data_reloaded: 'blue',
  reset_to_demo: 'amber',
  avito_item_published: 'green',
  avito_item_archived: 'gray',
  avito_item_edited: 'blue',
  avito_promotion_applied: 'violet',
  avito_promotion_stopped: 'gray',
  avito_balance_topup: 'green',
  avito_balance_charge: 'amber',
  avito_message_received: 'blue',
  avito_call_received: 'blue',
  avito_review_received: 'green',
  avito_other: 'gray',
};

const SOURCE_LABELS: Record<ActionSource, string> = {
  platform: 'Платформа',
  avito: 'Авито',
};

type WorkReportSection = {
  key: string;
  title: string;
  summary: string;
  items: string[];
  tone: 'green' | 'red' | 'amber' | 'blue' | 'gray' | 'violet';
};

type WorkReport = {
  accountName: string;
  period: PeriodValue;
  total: number;
  sections: WorkReportSection[];
  text: string;
};

const BID_TYPES: ActionType[] = ['item_bid_changed'];
const BULK_BID_TYPES: ActionType[] = ['item_bid_bulk_applied'];
const TOPUP_TYPES: ActionType[] = ['avito_balance_topup'];
const PUBLISH_TYPES: ActionType[] = ['avito_item_published'];
const ITEM_CHANGE_TYPES: ActionType[] = ['avito_item_archived', 'avito_item_edited'];
const COMM_TYPES: ActionType[] = ['avito_message_received', 'avito_call_received', 'avito_review_received'];

function isAvitoBidChange(entry: ActionLogEntry) {
  if (entry.type === 'item_bid_changed' || entry.type === 'item_bid_bulk_applied') {
    return true;
  }
  if (entry.type !== 'avito_item_edited') return false;
  const beforeBid = (entry.before as { currentBid?: unknown } | undefined)?.currentBid;
  const afterBid = (entry.after as { currentBid?: unknown } | undefined)?.currentBid;
  return beforeBid !== afterBid || /ставк/i.test(entry.title + ' ' + (entry.details ?? ''));
}

function inPeriod(entry: ActionLogEntry, period: PeriodValue) {
  const day = entry.timestamp.slice(0, 10);
  return day >= period.from && day <= period.to;
}

function fmtTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDateTime(timestamp: string) {
  return new Date(timestamp).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function timeSummary(entries: ActionLogEntry[], limit = 8) {
  const times = entries.slice(0, limit).map((e) => fmtTime(e.timestamp));
  const suffix = entries.length > limit ? ' и ещё ' + (entries.length - limit) : '';
  return times.length > 0 ? times.join(', ') + suffix : '—';
}

function detailLine(entry: ActionLogEntry) {
  const details = entry.details ? ' — ' + entry.details : '';
  return fmtDateTime(entry.timestamp) + ': ' + entry.title + details;
}

function isPromotionLike(entry: ActionLogEntry) {
  const text = (entry.title + ' ' + (entry.details ?? '')).toLowerCase();
  return /xl|x-l|премиум|premium|выдел|подня|продвиж|vas|услуг|размещ|пакет/.test(text);
}

function section(
  key: string,
  title: string,
  summary: string,
  entries: ActionLogEntry[],
  tone: WorkReportSection['tone']
): WorkReportSection | null {
  if (entries.length === 0) return null;
  return {
    key,
    title,
    summary,
    items: entries.slice(0, 6).map(detailLine),
    tone,
  };
}

function buildWorkReport(entries: ActionLogEntry[], accountName: string, period: PeriodValue): WorkReport {
  const sorted = [...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const bidChanges = sorted.filter((e) => isAvitoBidChange(e) && !BULK_BID_TYPES.includes(e.type));
  const bulkBidChanges = sorted.filter((e) => BULK_BID_TYPES.includes(e.type));
  const topups = sorted.filter((e) => TOPUP_TYPES.includes(e.type));
  const promotions = sorted.filter(
    (e) =>
      e.type === 'avito_promotion_applied' ||
      e.type === 'avito_promotion_stopped' ||
      (e.type === 'avito_balance_charge' && isPromotionLike(e))
  );
  const charges = sorted.filter(
    (e) => e.type === 'avito_balance_charge' && !promotions.some((p) => p.id === e.id)
  );
  const itemPublishes = sorted.filter((e) => PUBLISH_TYPES.includes(e.type));
  const itemChanges = sorted.filter((e) => ITEM_CHANGE_TYPES.includes(e.type) && !isAvitoBidChange(e));
  const communications = sorted.filter((e) => COMM_TYPES.includes(e.type));

  const bidSummary = [
    bidChanges.length > 0 ? 'Ставку меняли ' + bidChanges.length + ' раз: ' + timeSummary(bidChanges) : '',
    bulkBidChanges.length > 0
      ? 'Массово применяли ставки ' + bulkBidChanges.length + ' раз: ' + timeSummary(bulkBidChanges)
      : '',
  ]
    .filter(Boolean)
    .join('. ');

  const sections = [
    section(
      'bids',
      'Ставки',
      bidSummary,
      [...bidChanges, ...bulkBidChanges].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
      'amber'
    ),
    section(
      'topups',
      'Баланс и аванс',
      'Пополняли баланс или аванс ' + topups.length + ' раз: ' + timeSummary(topups),
      topups,
      'green'
    ),
    section(
      'promotions',
      'Продвижение и услуги',
      'Подключали или списывали услуги продвижения ' + promotions.length + ' раз: ' + timeSummary(promotions),
      promotions,
      'violet'
    ),
    section(
      'charges',
      'Прочие списания',
      'Были прочие списания ' + charges.length + ' раз: ' + timeSummary(charges),
      charges,
      'amber'
    ),
    section(
      'publishes',
      'Выкладка объявлений',
      'Новые объявления выложены ' + itemPublishes.length + ' раз: ' + timeSummary(itemPublishes),
      itemPublishes,
      'green'
    ),
    section(
      'items',
      'Изменения объявлений',
      'Редактировали или меняли статус объявлений ' + itemChanges.length + ' раз: ' + timeSummary(itemChanges),
      itemChanges,
      'blue'
    ),
    section(
      'communications',
      'Обращения',
      'Сообщения, звонки или отзывы: ' + communications.length + ' событий: ' + timeSummary(communications),
      communications,
      'blue'
    ),
  ].filter(Boolean) as WorkReportSection[];

  const header = [
    'Отчет по работе с аккаунтом: ' + accountName,
    'Период: ' + period.from + ' — ' + period.to,
    'Всего событий: ' + sorted.length,
  ].join('\n');
  const body = sections.length
    ? sections
        .map((s) => [s.title + ': ' + s.summary, ...s.items.map((i) => '  - ' + i)].join('\n'))
        .join('\n\n')
    : 'За выбранный период событий не найдено.';

  return {
    accountName,
    period,
    total: sorted.length,
    sections,
    text: header + '\n\n' + body,
  };
}

export default function ActionLog() {
  const log = useStore((s) => s.actionLog);
  const accounts = useStore((s) => s.accounts);
  const currentId = useStore((s) => s.currentAccountId);
  const clearLog = useStore((s) => s.clearLog);
  const reloadFromAdapter = useStore((s) => s.reloadFromAdapter);
  const loading = useStore((s) => s.loading);

  const [accountFilter, setAccountFilter] = useState<string>(currentId ?? 'all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [reportPeriod, setReportPeriod] = useState<PeriodValue>(() => lastNDaysRange(7));

  const avitoLog = useMemo(() => log.filter((entry) => entry.source === 'avito'), [log]);
  const types = useMemo(() => Array.from(new Set(avitoLog.map((l) => l.type))), [avitoLog]);

  const filtered = avitoLog.filter((l) => {
    if (accountFilter !== 'all' && l.accountId !== accountFilter) return false;
    if (typeFilter !== 'all' && l.type !== typeFilter) return false;
    if (
      search &&
      !(l.title.toLowerCase().includes(search.toLowerCase()) ||
        (l.details ?? '').toLowerCase().includes(search.toLowerCase()))
    )
      return false;
    return true;
  });

  const reportEntries = useMemo(
    () =>
      avitoLog.filter((entry) => {
        if (accountFilter !== 'all' && entry.accountId !== accountFilter) return false;
        return inPeriod(entry, reportPeriod);
      }),
    [accountFilter, avitoLog, reportPeriod]
  );
  const reportAccountName =
    accountFilter === 'all' ? 'все аккаунты' : accounts[accountFilter]?.name ?? 'аккаунт';
  const report = useMemo(
    () => buildWorkReport(reportEntries, reportAccountName, reportPeriod),
    [reportAccountName, reportEntries, reportPeriod]
  );

  const exportCsv = () => {
    const headers = ['timestamp', 'source', 'type', 'account', 'title', 'details'];
    const rows = filtered.map((l) => [
      l.timestamp,
      l.source,
      l.type,
      l.accountId ? accounts[l.accountId]?.name ?? l.accountId : '',
      l.title.replace(/"/g, '""'),
      (l.details ?? '').replace(/"/g, '""'),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map((v) => '"' + v + '"').join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'action-log-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportReport = () => {
    const blob = new Blob([report.text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'account-work-report-' + report.period.from + '-' + report.period.to + '.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Layout
      title="Журнал действий"
      subtitle="События из аккаунта Авито: операции, продвижение, публикации, сообщения и изменения объявлений"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-ink-400">Авито</div>
          <div className="text-2xl font-extrabold text-white mt-1">{avitoLog.length}</div>
          <div className="text-[11px] text-ink-500 mt-1">только события из аккаунта Авито</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-ink-400">Отфильтровано</div>
          <div className="text-2xl font-extrabold text-white mt-1">{filtered.length}</div>
          <div className="text-[11px] text-ink-500 mt-1">с учётом аккаунта, типа и поиска</div>
        </div>
      </div>

      <div className="card p-4 mb-4 flex flex-wrap items-center gap-3">
        <select
          className="input w-auto"
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
        >
          <option value="all">Все аккаунты</option>
          {Object.values(accounts).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          className="input w-auto"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="all">Любой тип</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t] ?? t}
            </option>
          ))}
        </select>
        <input
          className="input w-64"
          placeholder="Поиск по описанию"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <button
            className="btn-secondary"
            onClick={() => reloadFromAdapter()}
            disabled={loading}
            title="Подтянуть события из Авито (история операций, чаты, звонки)"
          >
            <RefreshCw className={['w-4 h-4', loading ? 'animate-spin' : ''].join(' ')} />
            Подтянуть из Авито
          </button>
          <button className="btn-secondary" onClick={exportCsv}>
            <Download className="w-4 h-4" /> Экспорт CSV
          </button>
          <button
            className="btn-danger"
            onClick={() => {
              if (confirm('Очистить журнал действий? Это нельзя отменить.')) clearLog();
            }}
          >
            <Trash2 className="w-4 h-4" /> Очистить
          </button>
        </div>
      </div>

      <div className="card p-4 sm:p-5 mb-4">
        <div className="flex flex-col xl:flex-row xl:items-start gap-4 mb-4">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-white">Отчет по работе с аккаунтом</h2>
              <p className="text-sm text-ink-400 mt-1">
                Краткая характеристика действий за период: ставки, пополнения, выкладка новых объявлений, изменения карточек, продвижение и обращения.
              </p>
              <div className="text-xs text-ink-500 mt-2">
                Аккаунт: {report.accountName}. Найдено событий: {report.total}.
              </div>
            </div>
          </div>
          <div className="flex flex-col sm:items-end gap-3">
            <PeriodPicker value={reportPeriod} onChange={setReportPeriod} className="xl:justify-end" />
            <button className="btn-secondary w-fit" onClick={exportReport}>
              <Download className="w-4 h-4" /> Экспорт отчета
            </button>
          </div>
        </div>

        {report.sections.length === 0 ? (
          <div className="rounded-xl border border-ink-700 bg-ink-900/50 p-4 text-sm text-ink-400">
            За выбранный период событий по выбранному аккаунту нет. Нажмите «Подтянуть из Авито», если нужно обновить операции аккаунта.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {report.sections.map((s) => (
              <div key={s.key} className="rounded-xl border border-ink-700 bg-ink-900/50 p-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <Badge tone={s.tone}>{s.title}</Badge>
                  <span className="text-sm text-white font-semibold">{s.summary}</span>
                </div>
                {s.items.length > 0 && (
                  <ul className="space-y-1.5 text-xs text-ink-400 leading-relaxed">
                    {s.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <Empty
          title="Записей нет"
          hint="Подключите аккаунт Авито или нажмите «Подтянуть из Авито» — здесь появятся пополнения баланса, продвижение, входящие чаты и изменения объявлений. Действия внутри платформы здесь больше не показываются."
        
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="table-th">Дата и время</th>
                  <th className="table-th">Источник</th>
                  <th className="table-th">Тип</th>
                  <th className="table-th">Аккаунт</th>
                  <th className="table-th">Описание</th>
                  <th className="table-th">Детали</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <LogRow
                    key={entry.id}
                    entry={entry}
                    accountName={entry.accountId ? accounts[entry.accountId]?.name ?? '—' : '—'}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Layout>
  );
}

function LogRow({ entry, accountName }: { entry: ActionLogEntry; accountName: string }) {
  const tone = TYPE_TONES[entry.type] ?? 'gray';
  const sourceTone: 'violet' | 'blue' = entry.source === 'avito' ? 'violet' : 'blue';
  return (
    <tr className="table-row align-top">
      <td className="table-td whitespace-nowrap text-ink-400">
        {new Date(entry.timestamp).toLocaleString('ru-RU')}
      </td>
      <td className="table-td whitespace-nowrap">
        <Badge tone={sourceTone}>{SOURCE_LABELS[entry.source]}</Badge>
      </td>
      <td className="table-td">
        <Badge tone={tone}>{TYPE_LABELS[entry.type] ?? entry.type}</Badge>
      </td>
      <td className="table-td whitespace-nowrap">{accountName}</td>
      <td className="table-td">{entry.title}</td>
      <td className="table-td text-ink-400">
        {entry.details}
        {(entry.before !== undefined || entry.after !== undefined) && (
          <details className="mt-1">
            <summary className="text-xs text-accent hover:underline cursor-pointer">
              Подробнее
            </summary>
            <pre className="text-[11px] bg-ink-850 border border-ink-700 rounded-md p-2 mt-1 max-w-[420px] overflow-auto">
{JSON.stringify({ before: entry.before, after: entry.after }, null, 2)}
            </pre>
          </details>
        )}
      </td>
    </tr>
  );
}
