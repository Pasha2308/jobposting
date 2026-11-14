import type { APIRoute } from 'astro';
import { clearSessionCookies, signOutAdmin } from '../../../lib/auth';
import { assertSameOrigin } from '../../../lib/http';

export const POST: APIRoute = async (context) => {
  try {
    assertSameOrigin(context.request, context.locals.env);
  } catch {
    return new Response(null, { status: 303, headers: { location: '/admin/login' } });
  }
  clearSessionCookies(context.cookies, new URL(context.request.url).protocol === 'https:');
  await signOutAdmin(context.locals.env);
  return new Response(null, { status: 303, headers: { location: '/admin/login' } });
};
