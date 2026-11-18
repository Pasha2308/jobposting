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
 * Auth client used for password sign-in and token refresh on the server.
 * Sessions are stored in HttpOnly cookies; they are never exposed to the
 * browser as Supabase localStorage sessions.
 *
 * The anon key is preferred. If only the service-role key is configured, it is
 * used as the API key for GoTrue: the key is already server-only, and the user
 * session it returns still carries the normal `authenticated` role, so RLS and
 * the admin allowlist are unchanged. This keeps admin sign-in working in a
 * deployment where the anon key was not copied over.
 */
export function createAuthClient(env: AppEnv): SupabaseClient | null {
  const key = env.supabaseAnonKey || env.supabaseServiceRoleKey;
  if (!env.supabaseUrl || !key) return null;
  return createClient(env.supabaseUrl, key, {
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
