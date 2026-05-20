import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, Mail, User as UserIcon } from 'lucide-react';
import { useStore } from '../store/useStore';

export default function Signup() {
  const navigate = useNavigate();
  const signup = useStore((s) => s.signup);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signup(email, password, name);
      navigate('/', { replace: true });
    } catch (err) {
      const raw =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
          ? err
          : JSON.stringify(err);
      let pretty = raw;
      if (/already registered|already been registered|user already/i.test(raw))
        pretty = 'Пользователь с таким email уже зарегистрирован. Войдите по ссылке ниже.';
      if (/password.*(short|weak|6)/i.test(raw))
        pretty = 'Пароль слишком короткий. Минимум 6 символов.';
      if (/email.*invalid/i.test(raw))
        pretty = 'Email указан в неверном формате.';
      if (/network/i.test(raw))
        pretty = 'Не удалось связаться с Supabase. Проверьте интернет и значение VITE_SUPABASE_URL в .env.';
      if (/confirmation/i.test(raw) || /подтверждение/i.test(raw))
        pretty = raw; // оставляем как есть — это уже наше сообщение
      setError(pretty || 'Ошибка регистрации');
      console.warn('[signup]', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-ink-900 flex items-center justify-center p-6 relative overflow-hidden silk-bg">
      <div className="orange-orb absolute -top-12 -left-12 w-56 h-56 opacity-30" />
      <div className="orange-orb absolute -bottom-20 -right-16 w-72 h-72 opacity-20" />

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
              Создание профиля
            </div>
          </div>
        </div>

        <h1 className="h-display text-2xl text-white mb-1">
          Создайте профиль <span className="text-accent">за минуту</span>
        </h1>
        <p className="text-sm text-ink-400 mb-6">
          К одному профилю можно подключить несколько аккаунтов Авито.
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="label">Имя</span>
            <div className="relative">
              <UserIcon className="w-4 h-4 absolute left-3 top-2.5 text-ink-500" />
              <input
                className="input pl-9"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Как к вам обращаться"
              />
            </div>
          </label>
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
                minLength={6}
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
            {busy ? 'Создаём профиль…' : 'Зарегистрироваться'}
          </button>
        </form>

        <div className="text-sm text-ink-300 mt-5 text-center">
          Уже есть профиль?{' '}
          <Link to="/login" className="text-accent hover:underline">
            Войти
          </Link>
        </div>
      </div>
    </div>
  );
}
