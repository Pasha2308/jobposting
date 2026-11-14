import type { APIRoute } from 'astro';
import { settingsSchema } from '../../../lib/domain/validation';
import { requireStore } from '../../../lib/services/context';
import { ServiceError } from '../../../lib/services/errors';
import { apiError, assertSameOrigin, jsonResponse, readJson } from '../../../lib/http';

export const POST: APIRoute = async (context) => {
  try {
    assertSameOrigin(context.request, context.locals.env);
    const store = requireStore(context.locals.env);
    const admin = context.locals.admin;
    if (!admin) throw new ServiceError('unauthorised', 'Sign in required.', 401);

    const body = (await readJson(context.request)) as Record<string, unknown>;

    if (body.action === 'purge_source_text') {
      const current = await store.getSettings();
      const purged = await store.purgeExpiredSourceText(current.source_retention_days);
      await store.logActivity({
        actor: `admin:${admin.email}`,
        action: 'captures.source_text_purged',
        entity_type: 'settings',
        metadata: { retention_days: current.source_retention_days, purged },
      });
      return jsonResponse({ ok: true, purged, retention_days: current.source_retention_days });
    }

    const parsed = settingsSchema.safeParse({
      verification_reminder_days: Number(body.verification_reminder_days ?? 14),
      source_retention_days: Number(body.source_retention_days ?? 180),
      public_submissions_enabled: body.public_submissions_enabled !== false && body.public_submissions_enabled !== 'false',
      reports_enabled: body.reports_enabled !== false && body.reports_enabled !== 'false',
      ai_provider: String(body.ai_provider ?? 'gemini'),
      default_currency: String(body.default_currency ?? 'INR').toUpperCase(),
    });
    if (!parsed.success) {
      throw new ServiceError('invalid_input', 'Check the settings values.', 422, {
        issues: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }

    const settings = await store.updateSettings(parsed.data);
    await store.logActivity({
      actor: `admin:${admin.email}`,
      action: 'settings.updated',
      entity_type: 'settings',
      metadata: { ...parsed.data },
    });
    return jsonResponse({ ok: true, settings });
  } catch (error) {
    return apiError(error);
  }
};
