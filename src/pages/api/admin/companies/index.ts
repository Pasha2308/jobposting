import type { APIRoute } from 'astro';
import { companyInputSchema } from '../../../../lib/domain/validation';
import { normalizeSourceUrl, slugify } from '../../../../lib/domain/url';
import { requireStore } from '../../../../lib/services/context';
import { ServiceError } from '../../../../lib/services/errors';
import { apiError, assertSameOrigin, jsonResponse, readJson } from '../../../../lib/http';

export const POST: APIRoute = async (context) => {
  try {
    assertSameOrigin(context.request, context.locals.env);
    const store = requireStore(context.locals.env);
    const admin = context.locals.admin;
    if (!admin) throw new ServiceError('unauthorised', 'Sign in required.', 401);

    const body = (await readJson(context.request)) as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id : null;
    const parsed = companyInputSchema.safeParse({
      name: body.name,
      website: body.website ?? null,
      careers_url: body.careers_url ?? null,
      description: body.description ?? null,
      logo_url: body.logo_url ?? null,
      verified: body.verified === true || body.verified === 'true' || body.verified === 'on',
    });
    if (!parsed.success) {
      throw new ServiceError('invalid_input', 'Check the company details.', 422, {
        issues: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }

    const website = parsed.data.website ? normalizeSourceUrl(parsed.data.website) : null;
    const careersUrl = parsed.data.careers_url ? normalizeSourceUrl(parsed.data.careers_url) : null;
    if (parsed.data.website && !website) throw new ServiceError('invalid_url', 'Website must be a valid URL.', 422);
    if (parsed.data.careers_url && !careersUrl) throw new ServiceError('invalid_url', 'Careers URL must be valid.', 422);

    if (id) {
      const company = await store.updateCompany(id, {
        name: parsed.data.name,
        website,
        careers_url: careersUrl,
        description: parsed.data.description ?? null,
        verified: parsed.data.verified,
      });
      await store.logActivity({
        actor: `admin:${admin.email}`,
        action: 'company.updated',
        entity_type: 'company',
        entity_id: id,
        metadata: { name: company.name },
      });
      return jsonResponse({ ok: true, company });
    }

    const company = await store.createCompany({
      name: parsed.data.name,
      slug: `${slugify(parsed.data.name).slice(0, 60)}-${Math.random().toString(36).slice(2, 5)}`,
      website,
      careers_url: careersUrl,
      description: parsed.data.description ?? null,
      verified: parsed.data.verified,
    });
    await store.logActivity({
      actor: `admin:${admin.email}`,
      action: 'company.created',
      entity_type: 'company',
      entity_id: company.id,
      metadata: { name: company.name },
    });
    return jsonResponse({ ok: true, company });
  } catch (error) {
    return apiError(error);
  }
};
