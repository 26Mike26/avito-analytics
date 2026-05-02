import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Если в .env заданы VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY —
 * включаем режим Supabase (мульти-юзер, синхронизация).
 * Иначе приложение остаётся в локальном демо-режиме (localStorage).
 */
export const SUPABASE_ENABLED = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = SUPABASE_ENABLED
  ? createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;
