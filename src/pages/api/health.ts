import type { APIRoute } from 'astro';
import { configurationReport } from '../../lib/env';
import { jsonResponse } from '../../lib/http';

export const GET: APIRoute = (context) => {
  const report = configurationReport(context.locals.env);
  return jsonResponse(
    {
      ok: true,
      service: 'hustler-community-opportunities',
      time: new Date().toISOString(),
      configured: report,
    },
    200,
    { 'x-robots-tag': 'noindex' },
  );
};
