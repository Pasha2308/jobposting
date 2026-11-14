import type { AstroCookies } from 'astro';
import { createAuthClient } from './supabase';
import type { AppEnv } from './env';
import type { AdminProfile } from './domain/types';
import { getStore } from './services/context';
import { ServiceError } from './services/errors';

export const ACCESS_COOKIE = 'hc_admin_access';
export const REFRESH_COOKIE = 'hc_admin_refresh';

export type AdminSession = {
  userId: string;
  email: string;
  profile: AdminProfile;
};

type CookieWriter = Pick<AstroCookies, 'get' | 'set' | 'delete'>;

function cookieOptions(secure: boolean, maxAge: number) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

export function setSessionCookies(
  cookies: CookieWriter,
  session: { access_token: string; refresh_token: string },
  secure: boolean,
): void {
  cookies.set(ACCESS_COOKIE, session.access_token, cookieOptions(secure, 60 * 60));
  cookies.set(REFRESH_COOKIE, session.refresh_token, cookieOptions(secure, 60 * 60 * 24 * 30));
}

export function clearSessionCookies(cookies: CookieWriter, secure: boolean): void {
  cookies.delete(ACCESS_COOKIE, { path: '/' });
  cookies.delete(REFRESH_COOKIE, { path: '/' });
  void secure;
}

/**
 * Verifies the HttpOnly session cookies against Supabase Auth and then checks
 * the admin_profiles allowlist. A valid Supabase user without an active admin
 * profile is rejected. Expired access tokens are refreshed transparently and
 * the new tokens are written back as HttpOnly cookies.
 */
export async function resolveAdminSession(
  env: AppEnv,
  cookies: CookieWriter,
  secure: boolean,
): Promise<AdminSession | null> {
  const auth = createAuthClient(env);
  const store = getStore(env);
  if (!auth || !store) return null;

  const accessToken = cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = cookies.get(REFRESH_COOKIE)?.value;
  if (!accessToken && !refreshToken) return null;

  let userId: string | null = null;
  let email = '';

  if (accessToken) {
    const { data, error } = await auth.auth.getUser(accessToken);
    if (!error && data.user) {
      userId = data.user.id;
      email = data.user.email ?? '';
    }
  }

  if (!userId && refreshToken) {
    const { data, error } = await auth.auth.refreshSession({ refresh_token: refreshToken });
    if (!error && data.session && data.user) {
      userId = data.user.id;
      email = data.user.email ?? '';
      setSessionCookies(cookies, data.session, secure);
    }
  }

  if (!userId) {
    clearSessionCookies(cookies, secure);
    return null;
  }

  const profile = await store.getProfile(userId);
  if (!profile || !profile.is_active) return null;

  return { userId, email: email || profile.email, profile };
}

export async function signInAdmin(
  env: AppEnv,
  email: string,
  password: string,
): Promise<{ session: AdminSession; tokens: { access_token: string; refresh_token: string } }> {
  const auth = createAuthClient(env);
  const store = getStore(env);
  if (!auth || !store) {
    throw new ServiceError(
      'not_configured',
      'Supabase is not configured yet. Follow the setup steps in the README before signing in.',
      503,
    );
  }
  const { data, error } = await auth.auth.signInWithPassword({ email: email.trim(), password });
  if (error || !data.session || !data.user) {
    throw new ServiceError('invalid_credentials', 'Email or password is incorrect.', 401);
  }
  const profile = await store.getProfile(data.user.id);
  if (!profile || !profile.is_active) {
    await auth.auth.signOut().catch(() => undefined);
    throw new ServiceError('not_authorised', 'This account is not authorised for the admin workspace.', 403);
  }
  return {
    session: { userId: data.user.id, email: data.user.email ?? profile.email, profile },
    tokens: { access_token: data.session.access_token, refresh_token: data.session.refresh_token },
  };
}

export async function signOutAdmin(env: AppEnv): Promise<void> {
  const auth = createAuthClient(env);
  await auth?.auth.signOut().catch(() => undefined);
}
