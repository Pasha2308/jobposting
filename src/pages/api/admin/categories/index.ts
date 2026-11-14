import type { APIRoute } from 'astro';
import { categoryInputSchema } from '../../../../lib/domain/validation';
import { slugify } from '../../../../lib/domain/url';
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
    const parsed = categoryInputSchema.safeParse({
      name: body.name,
      description: body.description ?? null,
      is_active: body.is_active !== false && body.is_active !== 'false',
      is_featured: body.is_featured === true || body.is_featured === 'true' || body.is_featured === 'on',
      sort_order: Number(body.sort_order ?? 100),
    });
    if (!parsed.success) {
      throw new ServiceError('invalid_input', 'Check the category details.', 422, {
        issues: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }

    if (id) {
      const category = await store.updateCategory(id, {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        is_active: parsed.data.is_active,
        is_featured: parsed.data.is_featured,
        sort_order: parsed.data.sort_order,
      });
      await store.logActivity({
        actor: `admin:${admin.email}`,
        action: 'category.updated',
        entity_type: 'category',
        entity_id: id,
        metadata: { name: category.name },
      });
      return jsonResponse({ ok: true, category });
    }

    const category = await store.createCategory({
      name: parsed.data.name,
      slug: slugify(parsed.data.name),
      description: parsed.data.description ?? null,
      is_active: parsed.data.is_active,
      is_featured: parsed.data.is_featured,
      sort_order: parsed.data.sort_order,
    });
    await store.logActivity({
      actor: `admin:${admin.email}`,
      action: 'category.created',
      entity_type: 'category',
      entity_id: category.id,
      metadata: { name: category.name },
    });
    return jsonResponse({ ok: true, category });
  } catch (error) {
    return apiError(error);
  }
};
