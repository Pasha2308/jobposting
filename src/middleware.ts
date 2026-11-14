import { defineMiddleware } from 'astro:middleware';
import { resolveEnv } from './lib/env';
import { resolveAdminSession } from './lib/auth';
import { jsonResponse } from './lib/http';

/**
 * Resolves runtime env for every request and guards the entire admin workspace
 * and admin API server-side. Hiding a nav item is never treated as security.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const env = resolveEnv(context.locals.runtime?.env ?? null);
  context.locals.env = env;

  const url = new URL(context.request.url);
  const isAdminApi = url.pathname.startsWith('/api/admin');
  const isAdminPage = url.pathname === '/admin' || url.pathname.startsWith('/admin/');
  const isLoginPage = url.pathname === '/admin/login';
  const isLoginApi = url.pathname === '/api/admin/login';

  if ((isAdminApi && !isLoginApi) || (isAdminPage && !isLoginPage)) {
    const session = await resolveAdminSession(env, context.cookies, url.protocol === 'https:');
    if (!session) {
      if (isAdminApi) {
        return jsonResponse({ error: 'Unauthorised. Sign in to the admin workspace.', code: 'unauthorised' }, 401);
      }
      const next = encodeURIComponent(`${url.pathname}${url.search}`);
      return context.redirect(`/admin/login?next=${next}`);
    }
    context.locals.admin = session.profile;
    context.locals.adminUserId = session.userId;
  }

  return next();
});
