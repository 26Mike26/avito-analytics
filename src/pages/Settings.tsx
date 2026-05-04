import { useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileUp,
  Lock,
  Plug,
  RefreshCw,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { useStore } from '../store/useStore';
import { Badge } from '../components/Badge';
import type { IntegrationMode } from '../types';

const TEMPLATE_ITEMS = `item_id,title,status,category,region,price,current_bid,views,contacts,favorites,spend,revenue,created_at
1001,2-к квартира 54 м²,active,Недвижимость,Москва,11500000,75,1842,28,86,8400,,2026-04-01
1002,Toyota Camry 2019,active,Авто,Санкт-Петербург,1850000,120,2310,12,40,11800,,2026-03-15
1003,Ремонт квартир под ключ,paused,Услуги,Казань,0,55,640,3,8,2200,,2026-04-10
`;

const TEMPLATE_METRICS = `item_id,date,views,contacts,favorites,spend,bid
1001,2026-04-25,120,3,9,420,75
1001,2026-04-26,140,2,8,520,75
1001,2026-04-27,180,4,11,610,80
1002,2026-04-25,90,0,4,380,120
1002,2026-04-26,140,1,6,560,120
`;

export default function Settings() {
  const integration = useStore((s) => s.integration);
  const update = useStore((s) => s.updateIntegration);
  const adapter = useStore((s) => s.adapter);
  const reload = useStore((s) => s.reloadFromAdapter);
  const applyImported = useStore((s) => s.applyImportedData);
  const resetToDemo = useStore((s) => s.resetToDemo);

  const [draft, setDraft] = useState(integration);
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const [importTone, setImportTone] = useState<'ok' | 'warn' | 'err'>('ok');
  const [busy, setBusy] = useState(false);

  const onTest = async () => {
    update({ ...draft });
    setBusy(true);
    const res = await adapter.testConnection();
    setBusy(false);
    setCheck(res);
  };

  const onSave = () => {
    update({ ...draft });
  };

  const onImport = async (file: File) => {
    setImportInfo(null);
    if (file.name.toLowerCase().endsWith('.xlsx')) {
      setImportTone('warn');
      setImportInfo(
        'XLSX пока поддерживается только через сохранение листа как CSV: откройте файл в Excel/Numbers и выберите Файл → Сохранить как → CSV.'
      );
      return;
    }
    const text = await file.text();
    const res = await adapter.importCsv(text);
    if (res.items.length === 0 && res.metrics.length === 0) {
      setImportTone('err');
      setImportInfo(
        `Импорт не выполнен. ${res.warnings.join(' ') || 'Проверьте формат файла.'}`
      );
      return;
    }
    applyImported(res.items, res.metrics);
    setImportTone(res.warnings.length > 0 ? 'warn' : 'ok');
    setImportInfo(
      `Готово. Формат: ${res.detectedFormat === 'metrics' ? 'отчёт по дням' : 'сводный отчёт'}. ` +
        `Объявлений: ${res.items.length}. Записей метрик: ${res.metrics.length}. ` +
        (res.warnings.length > 0 ? 'Замечания: ' + res.warnings.join(' ') : 'Замечаний нет.')
    );
  };

  const downloadTemplate = (kind: 'items' | 'metrics') => {
    const text = kind === 'items' ? TEMPLATE_ITEMS : TEMPLATE_METRICS;
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = kind === 'items' ? 'avito-items-template.csv' : 'avito-metrics-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Layout
      title="Настройки интеграции"
      subtitle="Подключение к Avito API, демо-режим и импорт CSV"
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Plug className="w-4 h-4 text-accent" />
              <h2 className="font-semibold text-white">Режим работы</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(['demo', 'api', 'csv'] as IntegrationMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setDraft({ ...draft, mode: m })}
                  className={[
                    'rounded-xl border p-4 text-left transition',
                    draft.mode === m
                      ? 'border-accent bg-accent/10 shadow-glow'
                      : 'border-ink-700 bg-ink-850 hover:border-ink-600',
                  ].join(' ')}
                >
                  <div className="font-medium text-white">
                    {m === 'demo' ? 'Demo' : m === 'api' ? 'Avito API' : 'CSV / XLSX'}
                  </div>
                  <div className="text-xs text-ink-400 mt-1">
                    {m === 'demo'
                      ? 'Все данные генерируются локально для демонстрации.'
                      : m === 'api'
                      ? 'Подключение к публичному Avito API через серверный прокси.'
                      : 'Импорт статистики из выгрузки личного кабинета.'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Lock className="w-4 h-4 text-ink-400" />
              <h2 className="font-semibold text-white">Учётные данные Avito API</h2>
            </div>
            <p className="text-sm text-ink-300 mb-4">
              Зарегистрируйте приложение на{' '}
              <a
                className="text-accent hover:underline"
                href="https://developers.avito.ru/"
                target="_blank"
                rel="noreferrer"
              >
                developers.avito.ru
              </a>{' '}
              и получите Client ID / Client Secret. Включите scope <code>items:info</code>,{' '}
              <code>stats:read</code>, <code>user_balance:read</code>,{' '}
              <code>user_operations:read</code>. После заполнения трёх полей и нажатия
              «Сохранить» аккаунт автоматически зарегистрируется на серверном прокси,
              правка <code>backend/.env</code> вручную не требуется.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Client ID">
                <input
                  className="input"
                  value={draft.clientId}
                  onChange={(e) => setDraft({ ...draft, clientId: e.target.value })}
                />
              </Field>
              <Field label="Client Secret">
                <input
                  type="password"
                  className="input"
                  value={draft.clientSecret}
                  onChange={(e) => setDraft({ ...draft, clientSecret: e.target.value })}
                />
              </Field>
              <Field label="Access Token">
                <input
                  type="password"
                  className="input"
                  value={draft.accessToken}
                  onChange={(e) => setDraft({ ...draft, accessToken: e.target.value })}
                />
              </Field>
              <Field label="User ID">
                <input
                  className="input"
                  value={draft.userId}
                  onChange={(e) => setDraft({ ...draft, userId: e.target.value })}
                />
              </Field>
            </div>
            <div className="mt-3 text-xs text-ink-400 bg-ink-850 border border-ink-700 rounded-lg p-3">
              Внимание: секреты не должны храниться во фронтенде в открытом виде. В демо-режиме они
              сохраняются только в localStorage с пометкой «демо». Для боевого подключения
              используйте серверный прокси.
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-4">
              <button className="btn-primary" onClick={onSave}>
                Сохранить
              </button>
              <button className="btn-secondary" onClick={onTest} disabled={busy}>
                <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
                Проверить подключение
              </button>
              {check && (
                <span
                  className={`inline-flex items-center gap-1 text-sm ${
                    check.ok ? 'text-emerald-300' : 'text-rose-300'
                  }`}
                >
                  {check.ok ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <XCircle className="w-4 h-4" />
                  )}
                  {check.message}
                </span>
              )}
            </div>
          </div>

          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <FileUp className="w-4 h-4 text-accent" />
              <h2 className="font-semibold text-white">
                Импорт статистики (CSV)
              </h2>
            </div>
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-sm text-ink-200 leading-relaxed mb-3">
              <div className="font-semibold text-white mb-1">
                Если нужно сверить расходы по объявлениям —
              </div>
              сервис подтягивает per-item расход через Avito API stats/v2. CSV
              остаётся полезен для ручной сверки или когда API временно недоступен.
              <ol className="mt-2 ml-5 list-decimal space-y-0.5 text-ink-300">
                <li>Авито Pro → раздел <b>Статистика</b></li>
                <li>Вкладка <b>Детализация</b> → выберите период</li>
                <li>Кнопка <b>«Скачать отчёт»</b> справа сверху</li>
                <li>Загрузите полученный CSV ниже — суммы расхода по объявлениям применятся автоматически</li>
              </ol>
            </div>
            <p className="text-sm text-ink-300 mb-3">
              Также распознаётся ручная выгрузка по объявлениям и шаблон «по дням»
              (если есть колонка <code>date</code>).
            </p>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <button
                className="btn-secondary"
                onClick={() => downloadTemplate('items')}
              >
                <Download className="w-4 h-4" /> Шаблон: сводный отчёт
              </button>
              <button
                className="btn-secondary"
                onClick={() => downloadTemplate('metrics')}
              >
                <Download className="w-4 h-4" /> Шаблон: отчёт по дням
              </button>
            </div>
            <input
              type="file"
              accept=".csv,.tsv,.xlsx"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImport(f);
                e.target.value = '';
              }}
              className="text-sm"
            />
            {importInfo && (
              <div
                className={[
                  'mt-3 text-sm rounded-lg p-3 border',
                  importTone === 'ok'
                    ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200'
                    : importTone === 'warn'
                    ? 'bg-amber-500/10 border-amber-500/40 text-amber-200'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-200',
                ].join(' ')}
              >
                {importInfo}
              </div>
            )}
            <div className="mt-4 text-xs text-ink-400">
              Поддерживаемые колонки: <code>item_id, title, status, category, region, price, current_bid, views, contacts, favorites, spend, revenue, created_at, date, bid</code>.
              Разделитель — запятая, точка с запятой или табуляция. Заголовки могут быть на русском или английском.
            </div>
          </div>
        </div>

        <aside className="card p-5 h-fit space-y-3">
          <div className="text-sm text-ink-400">Текущий режим</div>
          <div>
            {integration.mode === 'demo' && <Badge tone="amber">Демо-режим</Badge>}
            {integration.mode === 'api' && <Badge tone="blue">Avito API</Badge>}
            {integration.mode === 'csv' && <Badge tone="violet">CSV импорт</Badge>}
          </div>
          <div className="text-sm text-ink-400 mt-3">Последняя синхронизация</div>
          <div className="text-sm text-white">
            {integration.lastSyncAt
              ? new Date(integration.lastSyncAt).toLocaleString('ru-RU')
              : 'Никогда'}
          </div>
          <button className="btn-secondary w-full mt-2" onClick={() => reload()}>
            <RefreshCw className="w-4 h-4" /> Синхронизировать сейчас
          </button>
          <button
            className="btn-ghost w-full"
            onClick={() => resetToDemo()}
            title="Сбросить к демо-данным"
          >
            <RotateCcw className="w-4 h-4" /> Сбросить к демо
          </button>
          <div className="text-xs text-ink-400 mt-3 leading-relaxed">
            Подключение к реальному Avito API ещё не реализовано во фронтенде —
            см. <code>backend/</code> в проекте для запуска прокси-сервера. До этого момента
            проще всего загрузить выгрузку CSV из личного кабинета.
          </div>
        </aside>
      </div>
    </Layout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
