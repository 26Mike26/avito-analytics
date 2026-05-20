import { useEffect, useRef, useState } from 'react';
import { Save, Target } from 'lucide-react';
import { Layout } from '../components/Layout';
import { useStore } from '../store/useStore';
import type { AccountKpi } from '../types';

const strategyLabels: Record<AccountKpi['strategy'], string> = {
  leads: 'Больше лидов',
  cpl: 'Дешевле лид',
  balanced: 'Баланс',
  roi: 'Максимум ROI',
};

const strategyHint: Record<AccountKpi['strategy'], string> = {
  leads: 'Алгоритм будет агрессивнее повышать ставки на эффективных объявлениях.',
  cpl: 'Сильнее снижает ставки при превышении CPL и осторожнее с повышениями.',
  balanced: 'Универсальный режим — компромисс между объёмом лидов и ценой.',
  roi: 'Учитывает выручку и не наращивает расход без подтверждённого возврата.',
};

export default function KpiCenter() {
  const currentAccountId = useStore((s) => s.currentAccountId);
  const kpi = useStore((s) => s.kpi);
  const setKpi = useStore((s) => s.setKpi);
  const [draft, setDraft] = useState<AccountKpi>(kpi);
  const [saved, setSaved] = useState(false);
  const savedResetTimer = useRef<number | null>(null);
  const lastAccountId = useRef(currentAccountId);

  useEffect(() => {
    return () => {
      if (savedResetTimer.current != null) {
        window.clearTimeout(savedResetTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    setDraft(kpi);
    if (lastAccountId.current !== currentAccountId) {
      if (savedResetTimer.current != null) {
        window.clearTimeout(savedResetTimer.current);
        savedResetTimer.current = null;
      }
      setSaved(false);
      lastAccountId.current = currentAccountId;
    }
  }, [currentAccountId, kpi]);

  const onSave = () => {
    setKpi(draft);
    if (savedResetTimer.current != null) {
      window.clearTimeout(savedResetTimer.current);
    }
    setSaved(true);
    savedResetTimer.current = window.setTimeout(() => {
      setSaved(false);
      savedResetTimer.current = null;
    }, 2000);
  };

  return (
    <Layout
      title="KPI-центр"
      subtitle="Задайте цели — рекомендации и аналитика пересчитаются автоматически"
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Section title="Целевые показатели по лидам">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Целевая цена лида (₽)">
                <input
                  type="number"
                  className="input"
                  value={draft.targetCpl}
                  onChange={(e) =>
                    setDraft({ ...draft, targetCpl: +e.target.value })
                  }
                />
              </Field>
              <Field label="Целевое количество лидов в месяц">
                <input
                  type="number"
                  className="input"
                  value={draft.targetLeads}
                  onChange={(e) =>
                    setDraft({ ...draft, targetLeads: +e.target.value })
                  }
                />
              </Field>
              <Field label="Целевая конверсия, %">
                <input
                  type="number"
                  step="0.1"
                  className="input"
                  value={draft.targetConversionRate}
                  onChange={(e) =>
                    setDraft({ ...draft, targetConversionRate: +e.target.value })
                  }
                />
              </Field>
              <Field label="Минимальный ROI, %">
                <input
                  type="number"
                  className="input"
                  value={draft.targetRoi}
                  onChange={(e) =>
                    setDraft({ ...draft, targetRoi: +e.target.value })
                  }
                />
              </Field>
            </div>
          </Section>

          <Section title="Бюджет">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field label="Дневной бюджет, ₽">
                <input
                  type="number"
                  className="input"
                  value={draft.dailyBudget}
                  onChange={(e) =>
                    setDraft({ ...draft, dailyBudget: +e.target.value })
                  }
                />
              </Field>
              <Field label="Недельный бюджет, ₽">
                <input
                  type="number"
                  className="input"
                  value={draft.weeklyBudget}
                  onChange={(e) =>
                    setDraft({ ...draft, weeklyBudget: +e.target.value })
                  }
                />
              </Field>
              <Field label="Месячный бюджет, ₽">
                <input
                  type="number"
                  className="input"
                  value={draft.monthlyBudget}
                  onChange={(e) =>
                    setDraft({ ...draft, monthlyBudget: +e.target.value })
                  }
                />
              </Field>
              <Field label="Допустимый перерасход, %">
                <input
                  type="number"
                  className="input"
                  value={draft.allowedOverspend}
                  onChange={(e) =>
                    setDraft({ ...draft, allowedOverspend: +e.target.value })
                  }
                />
              </Field>
            </div>
          </Section>

          <Section title="Стратегия">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {(Object.keys(strategyLabels) as AccountKpi['strategy'][]).map((s) => (
                <button
                  key={s}
                  onClick={() => setDraft({ ...draft, strategy: s })}
                  className={[
                    'text-left rounded-xl border p-4 transition',
                    draft.strategy === s
                      ? 'border-accent bg-accent/10 shadow-glow'
                      : 'border-ink-700 bg-ink-850 hover:border-ink-600',
                  ].join(' ')}
                >
                  <div className="font-medium text-white">
                    {strategyLabels[s]}
                  </div>
                  <div className="text-xs text-ink-400 mt-1">{strategyHint[s]}</div>
                </button>
              ))}
            </div>
          </Section>

          <div className="flex items-center gap-3">
            <button onClick={onSave} className="btn-primary">
              <Save className="w-4 h-4" /> Сохранить и пересчитать
            </button>
            {saved && (
              <span className="text-sm text-emerald-300">
                Цели сохранены, рекомендации обновлены.
              </span>
            )}
          </div>
        </div>

        <aside className="card p-5 h-fit">
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-4 h-4 text-accent" />
            <h3 className="font-semibold text-white">Как это работает</h3>
          </div>
          <ul className="text-sm text-ink-300 space-y-2 list-disc pl-5">
            <li>Целевые значения используются для оценки каждого объявления.</li>
            <li>
              Стратегия влияет на агрессивность повышения и снижения ставок.
            </li>
            <li>
              Изменения сохраняются мгновенно и применяются ко всем экранам.
            </li>
            <li>
              При допустимом перерасходе предупреждения появятся только при выходе за лимит.
            </li>
          </ul>
        </aside>
      </div>
    </Layout>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h2 className="font-semibold text-white mb-4">{title}</h2>
      {children}
    </div>
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
