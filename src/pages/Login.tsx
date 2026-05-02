import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, Mail } from 'lucide-react';
import { useStore } from '../store/useStore';

export default function Login() {
  const navigate = useNavigate();
  const login = useStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      const raw =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
          ? err
          : JSON.stringify(err);
      // Подмешаем человеческие подсказки для частых ошибок Supabase
      let pretty = raw;
      if (/email not confirmed/i.test(raw))
        pretty = 'Email не подтверждён. Откройте письмо от Supabase или отключите «Confirm email» в настройках проекта.';
      if (/invalid login credentials/i.test(raw))
        pretty = 'Неверный email или пароль.';
      if (/network/i.test(raw))
        pretty = 'Не удалось связаться с сервером. Проверьте интернет и значение VITE_SUPABASE_URL в .env.';
      setError(pretty || 'Ошибка входа');
      console.error('[login]', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-ink-900 flex items-center justify-center p-6 relative overflow-hidden silk-bg">
      <div className="orange-orb absolute -top-16 -right-16 w-64 h-64 opacity-30" />
      <div className="orange-orb absolute -bottom-24 -left-20 w-72 h-72 opacity-20" />

      <div className="w-full max-w-md card p-8 relative">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-accent rounded-xl flex items-center justify-center font-extrabold text-white">
            GA
          </div>
          <div>
            <div className="text-sm font-extrabold text-white tracking-wide uppercase">
              Avito · Аналитика
            </div>
            <div className="text-[11px] text-ink-400 uppercase tracking-wider">
              Вход в кабинет
            </div>
          </div>
        </div>

        <h1 className="h-display text-2xl text-white mb-1">
          Управляйте ставками <span className="text-accent">точнее</span>
        </h1>
        <p className="text-sm text-ink-400 mb-6">
          Войдите, чтобы увидеть свои аккаунты и персональные рекомендации.
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="label">Email</span>
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3 top-2.5 text-ink-500" />
              <input
                type="email"
                required
                className="input pl-9"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
          </label>
          <label className="block">
            <span className="label">Пароль</span>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-2.5 text-ink-500" />
              <input
                type="password"
                required
                className="input pl-9"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Не менее 6 символов"
              />
            </div>
          </label>

          {error && (
            <div className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3">
              {error}
            </div>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Входим…' : 'Войти'}
          </button>
        </form>

        <div className="text-sm text-ink-300 mt-5 text-center">
          Ещё нет аккаунта?{' '}
          <Link to="/signup" className="text-accent hover:underline">
            Зарегистрироваться
          </Link>
        </div>

        <div className="text-[11px] text-ink-500 mt-6 bg-ink-850 border border-ink-700 rounded-xl p-3">
          Это прототип: пароли хранятся в localStorage браузера в виде SHA-256 хеша с солью.
          Для продакшена авторизация должна быть на сервере.
        </div>
      </div>
    </div>
  );
}
