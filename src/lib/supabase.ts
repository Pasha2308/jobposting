import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppEnv } from './env';

/**
 * Service-role client. This module is imported only by server code: pages and
 * API routes. It must never be imported from a React island.
 */
export function createServiceClient(env: AppEnv): SupabaseClient | null {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) return null;
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { 'x-application-name': 'hustler-community-opportunities' },
    },
  });
}

/**
 * Anon-key client used only for password sign-in and token refresh on the
 * server. Sessions are stored in HttpOnly cookies; they are never exposed to
 * the browser as Supabase localStorage sessions.
 */
export function createAuthClient(env: AppEnv): SupabaseClient | null {
  if (!env.supabaseUrl || !env.supabaseAnonKey) return null;
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export class DatabaseUnavailableError extends Error {
  constructor(message = 'The database is not configured.') {
    super(message);
    this.name = 'DatabaseUnavailableError';
  }
}
