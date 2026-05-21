import type { Session, User } from '../types';
import { SUPABASE_ENABLED, supabase } from './supabase';

/**
 * AuthService — единый интерфейс для входа/регистрации.
 *
 * Режимы:
 *  - Если SUPABASE_ENABLED → реальный Supabase Auth (подходит для боевого мульти-юзера).
 *  - Иначе → локальный режим: пароль хешируется SHA-256+соль и хранится в localStorage.
 *    Этот режим существует только для прототипа, чтобы можно было пользоваться без бэкенда.
 */

const USERS_KEY = 'avito-app-users';
const SESSION_KEY = 'avito-app-session';

function genId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

async function sha256(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function genSalt(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export class AuthService {
  // ──────────────── ЛОКАЛЬНЫЙ РЕЖИМ (без Supabase) ────────────────
  loadUsers(): User[] {
    try {
      const raw = localStorage.getItem(USERS_KEY);
      return raw ? (JSON.parse(raw) as User[]) : [];
    } catch {
      return [];
    }
  }

  private saveUsers(users: User[]) {
    try {
      localStorage.setItem(USERS_KEY, JSON.stringify(users));
    } catch (error) {
      console.warn('[storage] Не удалось сохранить пользователей:', error);
      throw new Error('Не удалось сохранить пользователя: память браузера переполнена.');
    }
  }

  loadSession(): Session | null {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  }

  saveSession(s: Session | null) {
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch (error) {
      console.warn('[storage] Не удалось сохранить сессию:', error);
      if (s) throw new Error('Не удалось сохранить вход: память браузера переполнена.');
    }
  }

  updateUser(user: User) {
    if (SUPABASE_ENABLED) return; // в supabase обновление через UI не применимо
    const users = this.loadUsers().map((u) => (u.id === user.id ? user : u));
    this.saveUsers(users);
  }

  // ──────────────── ОБЩИЕ ОПЕРАЦИИ ────────────────

  /** Возвращает текущего пользователя (если залогинен) — синхронно для localStorage,
   *  для Supabase нужен отдельный getCurrentUser() ниже. */
  async getCurrentUser(): Promise<User | null> {
    if (SUPABASE_ENABLED) {
      const { data } = await supabase!.auth.getUser();
      const u = data.user;
      if (!u) return null;
      return {
        id: u.id,
        email: u.email ?? '',
        name: (u.user_metadata?.name as string) ?? (u.email?.split('@')[0] ?? 'Пользователь'),
        role: (u.user_metadata?.role as User['role']) ?? 'admin',
        passwordHash: '',
        passwordSalt: '',
        createdAt: u.created_at ?? new Date().toISOString(),
        accountIds: [], // в supabase-режиме accountIds читаются отдельно из таблицы accounts
        clientAccountIds: (u.user_metadata?.client_account_ids as string[] | undefined) ?? [],
      };
    }
    const session = this.loadSession();
    if (!session) return null;
    return this.loadUsers().find((u) => u.id === session.userId) ?? null;
  }

  async signup(email: string, password: string, name: string): Promise<User> {
    if (SUPABASE_ENABLED) {
      const { data, error } = await supabase!.auth.signUp({
        email,
        password,
        options: { data: { name: name || email.split('@')[0] } },
      });
      if (error) throw new Error(error.message);
      const u = data.user;
      if (!u) throw new Error('Подтвердите email — мы отправили письмо.');
      return {
        id: u.id,
        email: u.email ?? email,
        name: name || email.split('@')[0],
        role: 'admin',
        passwordHash: '',
        passwordSalt: '',
        createdAt: u.created_at ?? new Date().toISOString(),
        accountIds: [],
        clientAccountIds: [],
      };
    }
    // ─── локальный режим
    const users = this.loadUsers();
    if (users.find((u) => u.email.toLowerCase() === email.toLowerCase()))
      throw new Error('Пользователь с таким email уже существует.');
    if (password.length < 6) throw new Error('Пароль должен содержать не менее 6 символов.');
    const salt = genSalt();
    const passwordHash = await sha256(password + salt);
    const user: User = {
      id: genId('user'),
      email: email.trim(),
      name: name.trim() || email.split('@')[0],
      role: 'admin',
      passwordHash,
      passwordSalt: salt,
      createdAt: new Date().toISOString(),
      accountIds: [],
      clientAccountIds: [],
    };
    users.push(user);
    this.saveUsers(users);
    return user;
  }

  async login(email: string, password: string): Promise<User> {
    if (SUPABASE_ENABLED) {
      const { data, error } = await supabase!.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      const u = data.user!;
      return {
        id: u.id,
        email: u.email ?? email,
        name: (u.user_metadata?.name as string) ?? (u.email?.split('@')[0] ?? 'Пользователь'),
        role: (u.user_metadata?.role as User['role']) ?? 'admin',
        passwordHash: '',
        passwordSalt: '',
        createdAt: u.created_at ?? new Date().toISOString(),
        accountIds: [],
        clientAccountIds: (u.user_metadata?.client_account_ids as string[] | undefined) ?? [],
      };
    }
    const users = this.loadUsers();
    const user = users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user) throw new Error('Пользователь с таким email не найден.');
    const hash = await sha256(password + user.passwordSalt);
    if (hash !== user.passwordHash) throw new Error('Неверный пароль.');
    const session: Session = { userId: user.id, startedAt: new Date().toISOString() };
    this.saveSession(session);
    return user;
  }

  async logout() {
    if (SUPABASE_ENABLED) {
      await supabase!.auth.signOut();
      return;
    }
    this.saveSession(null);
  }
}

export const authService = new AuthService();
