import { SupabaseStore } from '../store/supabase-store';
import type { Store } from '../store/types';
import { createServiceClient, DatabaseUnavailableError } from '../supabase';
import type { AppEnv } from '../env';

const cache = new Map<string, SupabaseStore>();

export function getStore(env: AppEnv): Store | null {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) return null;
  const key = `${env.supabaseUrl}:${env.supabaseServiceRoleKey.slice(-8)}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const client = createServiceClient(env);
  if (!client) return null;
  const store = new SupabaseStore(client);
  cache.set(key, store);
  return store;
}

export function requireStore(env: AppEnv): Store {
  const store = getStore(env);
  if (!store) {
    throw new DatabaseUnavailableError(
      'Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to the environment.',
    );
  }
  return store;
}
