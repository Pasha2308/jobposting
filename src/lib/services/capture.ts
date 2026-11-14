import type { AIProvider } from '../ai/provider';
import { AIError } from '../ai/provider';
import { validateExtraction, type ExtractionOutput, captureInputSchema } from '../domain/validation';
import { buildOpportunitySlug, canonicalSourceKey, extractLinkedInPostId, normalizeEmail, normalizeSourceUrl, safeOutboundUrl, slugify } from '../domain/url';
import { checkDuplicates, type DuplicateCandidate } from '../domain/duplicates';
import type {
  Category,
  Company,
  Opportunity,
  OpportunityDraft,
  OpportunityWithRelations,
  SourceCapture,
  SourceType,
  WorkMode,
  EmploymentType,
  SalaryPeriod,
  ApplicationMethod,
  DatePrecision,
} from '../domain/types';
import type { Store } from '../store/types';
import { ServiceError } from './errors';
import { refreshComments } from './comments';

export type SubmitCaptureInput = {
  sourceUrl?: string | null;
  rawText: string;
  sourceType: SourceType;
  company?: string | null;
  notes?: string | null;
  actor: string;
  telegramUserId?: number | null;
  telegramChatId?: number | null;
  telegramMessageId?: number | null;
};

export type SubmitCaptureResult = {
  capture: SourceCapture;
  sourceKey: string;
  sourcePostId: string | null;
};

/** Stable dedupe key for sources without a URL (e.g. pasted recruiter text). */
export async function textSourceKey(rawText: string): Promise<string> {
  const normalised = rawText.replace(/\s+/g, ' ').trim().toLowerCase();
  try {
    const data = new TextEncoder().encode(normalised);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return `text:${[...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  } catch {
    let hash = 5381;
    for (let i = 0; i < normalised.length; i += 1) hash = ((hash * 33) ^ normalised.charCodeAt(i)) >>> 0;
    return `text:${hash.toString(16)}`;
  }
}

export async function submitCapture(store: Store, input: SubmitCaptureInput): Promise<SubmitCaptureResult> {
  const parsed = captureInputSchema.safeParse({
    source_url: input.sourceUrl ?? null,
    raw_text: input.rawText,
    source_type: input.sourceType,
    company: input.company ?? null,
    notes: input.notes ?? null,
  });
  if (!parsed.success) {
    throw new ServiceError('invalid_capture', 'The capture could not be read.', 422, {
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  }

  let normalizedUrl: string | null = null;
  if (parsed.data.source_url) {
    normalizedUrl = normalizeSourceUrl(parsed.data.source_url);
    if (!normalizedUrl) {
      throw new ServiceError('invalid_url', 'That source URL is not a valid public web address.', 422);
    }
  }

  const sourcePostId = extractLinkedInPostId(normalizedUrl ?? '');
  const sourceKey = canonicalSourceKey(normalizedUrl, sourcePostId) ?? (await textSourceKey(parsed.data.raw_text));

  const existingCapture = await store.getCaptureBySourceKey(sourceKey);
  if (existingCapture && !['rejected', 'extraction_failed'].includes(existingCapture.status)) {
    throw new ServiceError('duplicate', 'This source has already been captured.', 409, {
      captureId: existingCapture.id,
      status: existingCapture.status,
      opportunityId: existingCapture.opportunity_id,
    });
  }

  const existingOpportunity = await store.findOpportunityBySourceKey(sourceKey);
  if (existingOpportunity) {
    throw new ServiceError('duplicate', 'An opportunity already exists for this source.', 409, {
      opportunityId: existingOpportunity.id,
      slug: existingOpportunity.slug,
      status: existingOpportunity.status,
    });
  }

  const capture = await store.createCapture({
    source_url: normalizedUrl,
    normalized_source_key: sourceKey,
    source_post_id: sourcePostId,
    source_type: parsed.data.source_type,
    raw_text: parsed.data.raw_text,
    submitted_company: parsed.data.company ?? null,
    notes: parsed.data.notes ?? null,
    created_by: input.actor,
    telegram_user_id: input.telegramUserId ?? null,
    telegram_chat_id: input.telegramChatId ?? null,
    telegram_message_id: input.telegramMessageId ?? null,
  });

  await store.logActivity({
    actor: input.actor,
    action: 'capture.received',
    entity_type: 'source_capture',
    entity_id: capture.id,
    metadata: { source_type: capture.source_type, source_key: sourceKey },
  });

  return { capture, sourceKey, sourcePostId };
}

export type ProcessCaptureResult = {
  capture: SourceCapture;
  opportunity: OpportunityWithRelations | null;
  extraction: ExtractionOutput;
  genuine: boolean;
  warnings: string[];
  potentialDuplicates: DuplicateCandidate[];
};

/**
 * Runs the full extraction pipeline for a capture. The raw capture is always
 * preserved, including on every failure path. Re-running is safe: a capture
 * that already produced an opportunity cannot be extracted again.
 */
export async function processCapture(
  store: Store,
  ai: AIProvider | null,
  captureId: string,
  opts: { actor: string; siteUrl: string },
): Promise<ProcessCaptureResult> {
  const capture = await store.getCapture(captureId);
  if (!capture) throw new ServiceError('not_found', 'Capture not found.', 404);

  if (capture.opportunity_id) {
    throw new ServiceError('already_processed', 'This capture has already produced an opportunity.', 409, {
      opportunityId: capture.opportunity_id,
    });
  }
  if (capture.status === 'extracting') {
    const started = capture.processing_started_at ? Date.parse(capture.processing_started_at) : 0;
    if (Date.now() - started < 10 * 60_000) {
      throw new ServiceError('busy', 'Extraction is already running for this capture.', 409);
    }
  }
  if (!ai) {
    await store.updateCapture(captureId, {
      status: 'extraction_failed',
      error_message: 'AI extraction is not configured. Add GEMINI_API_KEY and retry — the capture has been preserved.',
    });
    throw new ServiceError('ai_not_configured', 'AI extraction is not configured. The capture was saved and can be retried.', 503);
  }

  await store.updateCapture(captureId, {
    status: 'extracting',
    error_message: null,
    processing_started_at: new Date().toISOString(),
    attempt_count: capture.attempt_count + 1,
  });

  try {
    const categories = await store.listCategories({ activeOnly: false });
    const raw = await ai.extract({
      sourceText: capture.raw_text,
      sourceUrl: capture.source_url,
      submittedCompany: capture.submitted_company,
      categorySlugs: categories.map((c) => ({ slug: c.slug, name: c.name })),
    });

    const validated = validateExtraction(raw);
    if (!validated.ok) {
      throw new AIError('invalid_response', `The AI response failed validation: ${validated.issues.join('; ')}`, true);
    }
    const extraction = validated.value;

    if (!extraction.is_genuine_opportunity) {
      const updated = await store.updateCapture(captureId, {
        status: 'needs_review',
        extraction,
        extraction_confidence: extraction.confidence,
        error_message:
          extraction.genuine_opportunity_reason ??
          'The source does not appear to describe a specific vacancy. Review before rejecting.',
      });
      await store.logActivity({
        actor: opts.actor,
        action: 'capture.non_vacancy',
        entity_type: 'source_capture',
        entity_id: capture.id,
        metadata: { reason: extraction.genuine_opportunity_reason?.slice(0, 300) ?? null },
      });
      return {
        capture: updated,
        opportunity: null,
        extraction,
        genuine: false,
        warnings: ['The AI did not identify a specific vacancy in this source.'],
        potentialDuplicates: [],
      };
    }

    const warnings = [...extraction.warnings];
    const duplicateCandidates = await store.recentDuplicateCandidates(300);
    const companyName = extraction.company_name ?? capture.submitted_company ?? null;
    const duplicateCheck = checkDuplicates(
      {
        title: extraction.job_title ?? 'Untitled opportunity',
        companyName,
        source_url: capture.source_url,
        normalized_source_key: capture.normalized_source_key,
      },
      duplicateCandidates,
    );
    if (duplicateCheck.exact) {
      const updated = await store.updateCapture(captureId, {
        status: 'needs_review',
        extraction,
        extraction_confidence: extraction.confidence,
        error_message: duplicateCheck.exactReason ?? 'Duplicate source detected.',
      });
      return {
        capture: updated,
        opportunity: null,
        extraction,
        genuine: true,
        warnings: [duplicateCheck.exactReason ?? 'Duplicate source detected.'],
        potentialDuplicates: [],
      };
    }
    for (const duplicate of duplicateCheck.potential) {
      warnings.push(`Possible duplicate of “${duplicate.title}” (${duplicate.reason})`);
    }

    const category = resolveCategory(extraction.category_slug, categories);
    if (!category) warnings.push('No category matched; assign one before publishing.');

    const company = await resolveCompany(store, companyName, extraction.company_website);
    if (!company) warnings.push('No company identified; add a verified company before publishing.');

    const normalized = normaliseApplication(extraction, capture);

    const draft: OpportunityDraft = {
      slug: buildOpportunitySlug(extraction.job_title ?? 'Untitled opportunity', companyName ?? 'company', capture.id.slice(0, 6)),
      title: extraction.job_title?.trim() || 'Untitled opportunity',
      company_id: company?.id ?? null,
      category_id: category?.id ?? null,
      summary: extraction.summary,
      responsibilities: extraction.responsibilities,
      requirements: extraction.requirements,
      skills: extraction.required_skills,
      preferred_skills: extraction.preferred_skills,
      location_text: extraction.location,
      city: extraction.city,
      country: extraction.country,
      country_code: countryCode(extraction.country),
      work_mode: extraction.work_mode as WorkMode,
      employment_type: extraction.employment_type as EmploymentType,
      salary_min: extraction.salary_min,
      salary_max: extraction.salary_max,
      currency: extraction.currency,
      salary_period: extraction.salary_period as SalaryPeriod,
      experience_min_years: extraction.experience_min_years,
      experience_max_years: extraction.experience_max_years,
      application_method: normalized.method as ApplicationMethod,
      application_url: normalized.applicationUrl,
      recruitment_email: normalized.email,
      careers_url: normalized.careersUrl,
      application_instructions: extraction.application_instructions,
      source_url: capture.source_url,
      source_type: capture.source_type,
      source_capture_id: capture.id,
      canonical_source_key: capture.normalized_source_key || null,
      deadline: normalized.deadline,
      original_posted_at: normalisedOriginalDate(extraction, warnings),
      original_date_precision: extraction.original_date_precision as DatePrecision,
      original_date_text: extraction.original_date_text,
      status: 'pending_review',
      verification_status: 'needs_verification',
      is_featured: false,
      discovered_at: new Date().toISOString(),
      published_at: null,
      last_verified_at: null,
      closed_at: null,
      admin_notes: `AI extraction confidence: ${Math.round(extraction.confidence * 100)}%. Source: ${capture.source_url ?? 'pasted text'}`,
      created_by: opts.actor,
    };

    if (normalized.warnings.length) warnings.push(...normalized.warnings);

    let opportunity: Opportunity;
    try {
      opportunity = await store.createOpportunity(draft);
    } catch (error) {
      // Slug or canonical source collision: retry once with a random suffix.
      const message = error instanceof Error ? error.message : '';
      if (/slug|duplicate|already/i.test(message)) {
        opportunity = await store.createOpportunity({
          ...draft,
          slug: `${draft.slug}-${Math.random().toString(36).slice(2, 6)}`,
        });
      } else {
        throw error;
      }
    }

    const withRelations: OpportunityWithRelations = {
      ...opportunity,
      company: company
        ? {
            id: company.id,
            name: company.name,
            slug: company.slug,
            website: company.website,
            careers_url: company.careers_url,
            description: company.description,
            verified: company.verified,
          }
        : null,
      category: category ? { id: category.id, name: category.name, slug: category.slug } : null,
    };

    await refreshComments(store, withRelations, opts.siteUrl).catch(() => undefined);

    const updated = await store.updateCapture(captureId, {
      status: 'needs_review',
      extraction: {
        ...extraction,
        review_warnings: warnings,
        resolved_category: category?.slug ?? null,
        potential_duplicates: duplicateCheck.potential,
      },
      extraction_confidence: extraction.confidence,
      opportunity_id: opportunity.id,
      error_message: null,
    });

    await store.logActivity({
      actor: opts.actor,
      action: 'capture.extracted',
      entity_type: 'source_capture',
      entity_id: capture.id,
      metadata: { opportunity_id: opportunity.id, confidence: extraction.confidence },
    });

    return {
      capture: updated,
      opportunity: withRelations,
      extraction,
      genuine: true,
      warnings,
      potentialDuplicates: duplicateCheck.potential,
    };
  } catch (error) {
    const message =
      error instanceof AIError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Extraction failed.';
    await store
      .updateCapture(captureId, {
        status: 'extraction_failed',
        error_message: message.slice(0, 500),
      })
      .catch(() => undefined);
    await store
      .logActivity({
        actor: opts.actor,
        action: 'capture.extraction_failed',
        entity_type: 'source_capture',
        entity_id: captureId,
        metadata: { error: message.slice(0, 300) },
      })
      .catch(() => undefined);
    throw error;
  }
}

export async function retryCapture(
  store: Store,
  ai: AIProvider | null,
  captureId: string,
  opts: { actor: string; siteUrl: string },
): Promise<ProcessCaptureResult> {
  const capture = await store.getCapture(captureId);
  if (!capture) throw new ServiceError('not_found', 'Capture not found.', 404);
  if (capture.opportunity_id) {
    throw new ServiceError('already_processed', 'This capture already has an opportunity. Edit it in review instead.', 409);
  }
  if (!['extraction_failed', 'received', 'validating', 'duplicate_check'].includes(capture.status)) {
    throw new ServiceError('not_retryable', `A capture in "${capture.status}" cannot be retried.`, 409);
  }
  return processCapture(store, ai, captureId, opts);
}

export async function rejectCapture(
  store: Store,
  captureId: string,
  actor: string,
  note?: string,
): Promise<SourceCapture> {
  const capture = await store.getCapture(captureId);
  if (!capture) throw new ServiceError('not_found', 'Capture not found.', 404);
  if (capture.status === 'published') {
    throw new ServiceError('invalid_transition', 'Published captures cannot be rejected. Close the opportunity instead.', 409);
  }
  if (capture.opportunity_id) {
    const opportunity = await store.getOpportunityById(capture.opportunity_id);
    if (opportunity && ['pending_review', 'draft'].includes(opportunity.status)) {
      await store.updateOpportunity(opportunity.id, { status: 'rejected' });
    }
  }
  const updated = await store.updateCapture(captureId, {
    status: 'rejected',
    error_message: note?.slice(0, 500) ?? capture.error_message,
  });
  await store.logActivity({
    actor,
    action: 'capture.rejected',
    entity_type: 'source_capture',
    entity_id: capture.id,
    metadata: { note: note?.slice(0, 300) ?? null },
  });
  return updated;
}

export async function approveCapture(store: Store, captureId: string, actor: string): Promise<SourceCapture> {
  const capture = await store.getCapture(captureId);
  if (!capture) throw new ServiceError('not_found', 'Capture not found.', 404);
  if (!capture.opportunity_id) {
    throw new ServiceError('no_opportunity', 'Extract the capture before approving it.', 409);
  }
  const updated = await store.updateCapture(captureId, { status: 'approved' });
  await store.logActivity({
    actor,
    action: 'capture.approved',
    entity_type: 'source_capture',
    entity_id: capture.id,
    metadata: { opportunity_id: capture.opportunity_id },
  });
  return updated;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

export function resolveCategory(slugOrName: string | null, categories: Category[]): Category | null {
  if (!slugOrName) return null;
  const value = slugOrName.trim().toLowerCase();
  return (
    categories.find((c) => c.slug === value) ??
    categories.find((c) => c.name.toLowerCase() === value) ??
    categories.find((c) => slugify(c.name) === slugify(value)) ??
    null
  );
}

async function resolveCompany(store: Store, name: string | null, website: string | null): Promise<Company | null> {
  const cleanName = name?.trim();
  if (!cleanName) return null;
  const existing = await store.findCompanyByName(cleanName);
  if (existing) return existing;
  const websiteSafe = safeOutboundUrl(website);
  try {
    return await store.createCompany({
      name: cleanName.slice(0, 160),
      slug: slugify(cleanName).slice(0, 70) || `company-${Date.now()}`,
      website: websiteSafe,
      verified: false,
    });
  } catch {
    const again = await store.findCompanyByName(cleanName);
    if (again) return again;
    try {
      return await store.createCompany({
        name: cleanName.slice(0, 160),
        slug: `${slugify(cleanName).slice(0, 60)}-${Math.random().toString(36).slice(2, 6)}`,
        website: websiteSafe,
        verified: false,
      });
    } catch {
      return null;
    }
  }
}

function normaliseApplication(
  extraction: ExtractionOutput,
  capture: SourceCapture,
): { method: string; applicationUrl: string | null; email: string | null; careersUrl: string | null; deadline: string | null; warnings: string[] } {
  const warnings: string[] = [];
  let method = extraction.application_method;
  const applicationUrl = safeOutboundUrl(extraction.application_url);
  const careersUrl: string | null = null;
  const email = normalizeEmail(extraction.recruitment_email);

  if (method === 'external_url' && !applicationUrl) {
    warnings.push('The AI selected an external application URL but did not provide a valid URL.');
    method = 'none';
  }
  if (method === 'email' && !email) {
    warnings.push('The AI selected email applications but did not provide a valid public email address.');
    method = 'none';
  }
  if (method === 'careers_page') {
    warnings.push('A careers page URL must be confirmed manually before publishing.');
    method = 'none';
  }
  if (method === 'linkedin_post') {
    if (!capture.source_url?.includes('linkedin.com') || !extraction.application_instructions) {
      warnings.push('LinkedIn application requires the original post URL and explicit application instructions.');
      method = 'none';
    }
  }

  let deadline: string | null = null;
  if (extraction.deadline) {
    const time = Date.parse(`${extraction.deadline}T23:59:59Z`);
    if (Number.isFinite(time) && time >= Date.now()) deadline = extraction.deadline;
    else warnings.push('The stated deadline has passed or is invalid; it was not applied.');
  }

  return { method, applicationUrl, email, careersUrl, deadline, warnings };
}

function normalisedOriginalDate(extraction: ExtractionOutput, warnings: string[]): string | null {
  if (!extraction.original_posted_date) return null;
  const time = Date.parse(`${extraction.original_posted_date}T00:00:00Z`);
  if (!Number.isFinite(time)) return null;
  if (time > Date.now() + 86_400_000) {
    warnings.push('An original posting date in the future was ignored.');
    return null;
  }
  return extraction.original_posted_date;
}

const COUNTRY_CODES: Record<string, string> = {
  india: 'IN',
  'united states': 'US',
  'united states of america': 'US',
  usa: 'US',
  'united kingdom': 'GB',
  uk: 'GB',
  england: 'GB',
  canada: 'CA',
  australia: 'AU',
  singapore: 'SG',
  'united arab emirates': 'AE',
  uae: 'AE',
  dubai: 'AE',
  germany: 'DE',
  france: 'FR',
  netherlands: 'NL',
  spain: 'ES',
  portugal: 'PT',
  ireland: 'IE',
  italy: 'IT',
  sweden: 'SE',
  switzerland: 'CH',
  denmark: 'DK',
  norway: 'NO',
  poland: 'PL',
  indonesia: 'ID',
  malaysia: 'MY',
  philippines: 'PH',
  vietnam: 'VN',
  thailand: 'TH',
  japan: 'JP',
  'south korea': 'KR',
  china: 'CN',
  brazil: 'BR',
  mexico: 'MX',
  argentina: 'AR',
  'south africa': 'ZA',
  nigeria: 'NG',
  kenya: 'KE',
  egypt: 'EG',
  'saudi arabia': 'SA',
  qatar: 'QA',
  israel: 'IL',
  turkey: 'TR',
  pakistan: 'PK',
  bangladesh: 'BD',
  'sri lanka': 'LK',
  nepal: 'NP',
  'new zealand': 'NZ',
};

export function countryCode(country: string | null): string | null {
  if (!country) return null;
  return COUNTRY_CODES[country.trim().toLowerCase()] ?? null;
}
