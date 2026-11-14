import type { APIRoute } from 'astro';
import { createAIProvider } from '../../../lib/ai/gemini';
import { processCapture, submitCapture } from '../../../lib/services/capture';
import { requireStore } from '../../../lib/services/context';
import { ServiceError } from '../../../lib/services/errors';
import { apiError, assertSameOrigin, jsonResponse, readJson } from '../../../lib/http';
import type { SourceType } from '../../../lib/domain/types';

export const POST: APIRoute = async (context) => {
  try {
    assertSameOrigin(context.request, context.locals.env);
    const store = requireStore(context.locals.env);
    const admin = context.locals.admin;
    if (!admin) throw new ServiceError('unauthorised', 'Sign in required.', 401);

    const body = (await readJson(context.request)) as Record<string, unknown>;
    const submitted = await submitCapture(store, {
      sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : null,
      rawText: String(body.rawText ?? ''),
      sourceType: (String(body.sourceType ?? 'linkedin_post') as SourceType) || 'linkedin_post',
      company: typeof body.company === 'string' ? body.company : null,
      notes: typeof body.notes === 'string' ? body.notes : null,
      actor: `admin:${admin.email}`,
    });

    const ai = createAIProvider(context.locals.env);
    try {
      const result = await processCapture(store, ai, submitted.capture.id, {
        actor: `admin:${admin.email}`,
        siteUrl: context.locals.env.siteUrl,
      });
      return jsonResponse({
        ok: true,
        captureId: submitted.capture.id,
        captureStatus: result.capture.status,
        opportunityId: result.opportunity?.id ?? null,
        reviewUrl: result.opportunity
          ? `/admin/opportunities/${result.opportunity.id}`
          : `/admin/captures/${submitted.capture.id}`,
        genuine: result.genuine,
        warnings: result.warnings,
        extraction: result.extraction,
      });
    } catch (error) {
      // The capture is already preserved. Report the extraction failure without
      // pretending it succeeded.
      const capture = await store.getCapture(submitted.capture.id);
      const message =
        error instanceof ServiceError ? error.message : error instanceof Error ? error.message : 'Extraction failed.';
      return jsonResponse(
        {
          ok: false,
          captureId: submitted.capture.id,
          captureStatus: capture?.status ?? 'extraction_failed',
          reviewUrl: `/admin/captures/${submitted.capture.id}`,
          error: message,
        },
        200,
      );
    }
  } catch (error) {
    return apiError(error);
  }
};
