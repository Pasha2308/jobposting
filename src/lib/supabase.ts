import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppEnv } from './env';

const DATABASE_REQUEST_TIMEOUT_MS = 20_000;

/** Bound a stalled database request so a background discovery run can report
 * an error and retry from its last complete source checkpoint. */
const databaseFetch: typeof fetch = (input, init = {}) => {
  const timeout = AbortSignal.timeout(DATABASE_REQUEST_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};

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
      fetch: databaseFetch,
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
