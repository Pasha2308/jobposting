import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminProfile } from '../../src/lib/domain/types';

const createAuthClient = vi.fn();
const createServiceClient = vi.fn();
const getStore = vi.fn();

vi.mock('../../src/lib/supabase', () => ({
  createAuthClient: (...args: unknown[]) => createAuthClient(...args),
  createServiceClient: (...args: unknown[]) => createServiceClient(...args),
}));

vi.mock('../../src/lib/services/context', () => ({
  getStore: (...args: unknown[]) => getStore(...args),
}));

const { ACCESS_COOKIE, REFRESH_COOKIE, resolveAdminSession, signInAdmin } = await import(
  '../../src/lib/auth'
);
const { testEnv } = await import('../helpers');

function profile(overrides: Partial<AdminProfile> = {}): AdminProfile {
  return {
    user_id: 'user-1',
    email: 'admin@example.com',
    display_name: 'Admin',
    role: 'owner',
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fakeCookies(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const writes: { name: string; value: string; options?: Record<string, unknown> }[] = [];
  const deletes: string[] = [];
  return {
    values,
    writes,
    deletes,
    get(name: string) {
      const value = values.get(name);
      return value ? { value } : undefined;
    },
    set(name: string, value: string, options?: Record<string, unknown>) {
      values.set(name, value);
      writes.push({ name, value, options });
    },
    delete(name: string) {
      values.delete(name);
      deletes.push(name);
    },
  } as unknown as import('astro').AstroCookies & {
    values: Map<string, string>;
    writes: { name: string; value: string; options?: Record<string, unknown> }[];
    deletes: string[];
  };
}

function authStub(overrides: Record<string, unknown> = {}) {
  return {
    auth: {
      signInWithPassword: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      getUser: vi.fn(),
      refreshSession: vi.fn(),
      ...overrides,
    },
  };
}

describe('admin sign-in and session resolution', () => {
  beforeEach(() => {
    createAuthClient.mockReset();
    createServiceClient.mockReset();
    getStore.mockReset();
  });

  it('rejects invalid credentials without revealing which field was wrong', async () => {
    createAuthClient.mockReturnValue(
      authStub({ signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: { message: 'Invalid login' } }) }),
    );
    getStore.mockReturnValue({ getProfile: vi.fn() });

    await expect(signInAdmin(testEnv(), 'admin@example.com', 'wrong')).rejects.toMatchObject({
      code: 'invalid_credentials',
      status: 401,
      message: 'Email or password is incorrect.',
    });
  });

  it('rejects a valid Supabase user who is not on the admin allowlist', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    createAuthClient.mockReturnValue(
      authStub({
        signInWithPassword: vi.fn().mockResolvedValue({
          data: {
            user: { id: 'user-1', email: 'admin@example.com' },
            session: { access_token: 'a', refresh_token: 'r' },
          },
          error: null,
        }),
        signOut,
      }),
    );
    getStore.mockReturnValue({ getProfile: vi.fn().mockResolvedValue(profile({ is_active: false })) });

    await expect(signInAdmin(testEnv(), 'admin@example.com', 'pw')).rejects.toMatchObject({
      code: 'not_authorised',
      status: 403,
    });
    expect(signOut).toHaveBeenCalled();
  });

  it('returns a session for an active admin profile', async () => {
    createAuthClient.mockReturnValue(
      authStub({
        signInWithPassword: vi.fn().mockResolvedValue({
          data: {
            user: { id: 'user-1', email: 'admin@example.com' },
            session: { access_token: 'access', refresh_token: 'refresh' },
          },
          error: null,
        }),
      }),
    );
    getStore.mockReturnValue({ getProfile: vi.fn().mockResolvedValue(profile()) });

    const result = await signInAdmin(testEnv(), ' admin@example.com ', 'pw');
    expect(result.session.email).toBe('admin@example.com');
    expect(result.tokens).toEqual({ access_token: 'access', refresh_token: 'refresh' });
  });

  it('reports configuration problems instead of pretending sign-in worked', async () => {
    createAuthClient.mockReturnValue(null);
    getStore.mockReturnValue(null);
    await expect(signInAdmin(testEnv(), 'admin@example.com', 'pw')).rejects.toMatchObject({
      code: 'not_configured',
      status: 503,
    });
  });

  it('resolves an active session from the access cookie', async () => {
    createAuthClient.mockReturnValue(
      authStub({ getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'admin@example.com' } }, error: null }) }),
    );
    getStore.mockReturnValue({ getProfile: vi.fn().mockResolvedValue(profile()) });
    const cookies = fakeCookies({ [ACCESS_COOKIE]: 'token' });

    const session = await resolveAdminSession(testEnv(), cookies, true);
    expect(session?.userId).toBe('user-1');
    expect(session?.profile.role).toBe('owner');
  });

  it('returns null for an unauthenticated request and clears stale cookies', async () => {
    createAuthClient.mockReturnValue(
      authStub({
        getUser: vi.fn().mockResolvedValue({ data: {}, error: { message: 'expired' } }),
        refreshSession: vi.fn().mockResolvedValue({ data: {}, error: { message: 'expired' } }),
      }),
    );
    getStore.mockReturnValue({ getProfile: vi.fn() });
    const cookies = fakeCookies({ [ACCESS_COOKIE]: 'old', [REFRESH_COOKIE]: 'old-refresh' });

    expect(await resolveAdminSession(testEnv(), cookies, true)).toBeNull();
    expect(cookies.deletes).toEqual([ACCESS_COOKIE, REFRESH_COOKIE]);
  });

  it('refreshes an expired access token and rewrites both cookies', async () => {
    const auth = authStub({
      getUser: vi.fn().mockResolvedValue({ data: {}, error: { message: 'expired' } }),
      refreshSession: vi.fn().mockResolvedValue({
        data: {
          user: { id: 'user-1', email: 'admin@example.com' },
          session: { access_token: 'new-access', refresh_token: 'new-refresh' },
        },
        error: null,
      }),
    });
    createAuthClient.mockReturnValue(auth);
    getStore.mockReturnValue({ getProfile: vi.fn().mockResolvedValue(profile()) });
    const cookies = fakeCookies({ [ACCESS_COOKIE]: 'expired', [REFRESH_COOKIE]: 'refresh' });

    const session = await resolveAdminSession(testEnv(), cookies, true);
    expect(session?.email).toBe('admin@example.com');
    expect(cookies.writes.map((w) => w.name)).toEqual([ACCESS_COOKIE, REFRESH_COOKIE]);
    expect(cookies.writes[0].options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax' });
  });

  it('rejects a session whose admin profile was deactivated', async () => {
    createAuthClient.mockReturnValue(
      authStub({ getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'admin@example.com' } }, error: null }) }),
    );
    getStore.mockReturnValue({ getProfile: vi.fn().mockResolvedValue(profile({ is_active: false })) });
    const cookies = fakeCookies({ [ACCESS_COOKIE]: 'token' });

    expect(await resolveAdminSession(testEnv(), cookies, true)).toBeNull();
  });
});
