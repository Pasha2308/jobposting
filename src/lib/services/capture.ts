import type { AIProvider, ExtractionRequest } from '../ai/provider';
import { AIError } from '../ai/provider';
import { validateExtraction, validateForPublication, type ExtractionOutput, captureInputSchema } from '../domain/validation';
import { buildOpportunitySlug, canonicalSourceKey, extractLinkedInPostId, isLinkedInShortPostUrl, linkedInPostUrl, normalizeEmail, normalizeSourceUrl, safeOutboundUrl, slugify } from '../domain/url';
import { checkDuplicates, type DuplicateCandidate } from '../domain/duplicates';
import { computeCompleteness } from '../domain/completeness';
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
  /** Keep a Telegram-provided source URL verbatim while still deduping canonically. */
  preserveSourceUrl?: boolean;
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
  if (existingOpportunity && !['rejected', 'archived'].includes(existingOpportunity.status)) {
    throw new ServiceError('duplicate', 'An opportunity already exists for this source.', 409, {
      opportunityId: existingOpportunity.id,
      slug: existingOpportunity.slug,
      status: existingOpportunity.status,
    });
  }

  const capture = await store.createCapture({
    source_url: input.preserveSourceUrl ? parsed.data.source_url?.trim() ?? null : normalizedUrl,
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
    // A URL submitted together with copied text needs no network retrieval.
    retrieval_status: 'retrieved',
    retrieval_method: 'manual_text',
    retrieval_attempts: 1,
    retrieved_at: new Date().toISOString(),
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
  opportunities: OpportunityWithRelations[];
  extractions: Array<{ openingIndex: number; [key: string]: unknown }>;
  genuine: boolean;
  warnings: string[];
  potentialDuplicates: DuplicateCandidate[];
};

/**
 * Runs the full extraction pipeline for a capture. If the AI returns multiple
 * openings (the `openings[]` envelope), each opening becomes an independent
 * opportunity record, all linked to the same source capture.
 *
 * Re-running is safe: a capture that already produced an opportunity cannot be
 * extracted again.
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
  if (capture.raw_text.trim().length < 40) {
    throw new ServiceError(
      'no_source_text',
      'No post text is available yet. Automatic retrieval did not produce content; send the copied post text or retry retrieval.',
      409,
    );
  }
  if (!ai) {
    await store.updateCapture(captureId, {
      status: 'extraction_failed',
      error_message: 'AI extraction is not configured. Add GROQ_API_KEY or GEMINI_API_KEY and retry — the capture has been preserved.',
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
    const request = {
      sourceText: capture.raw_text,
      sourceUrl: capture.source_url,
      submittedCompany: capture.submitted_company,
      categorySlugs: categories.map((c) => ({ slug: c.slug, name: c.name })),
      sourceMeta: {
        author: capture.source_author,
        postedAt: capture.source_posted_at,
        headline:
          typeof capture.source_metadata?.headline === 'string' ? capture.source_metadata.headline : null,
        comments: capture.source_comments ?? [],
        hasSharedContent: capture.source_metadata?.has_shared_content === true,
      },
    };
    const raw = await ai.extract(request);

    const validated = validateExtraction(raw);
    if (!validated.ok) {
      throw new AIError('invalid_response', `The AI response failed validation: ${validated.issues.join('; ')}`, true);
    }
    const extraction = validated.value;

    if (!extraction.is_genuine_opportunity || !extraction.openings || extraction.openings.length === 0) {
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
        metadata: { reason: extraction.genuine_opportunity_reason ?? 'No openings extracted from source.' },
      });
      return {
        capture: updated,
        opportunity: null,
        opportunities: [],
        extractions: [],
        genuine: false,
        warnings: extraction.warnings.length > 0 ? extraction.warnings : ['The AI did not identify any specific vacancies in this source.'],
        potentialDuplicates: [],
      };
    }

    const warnings = [...extraction.warnings];

    // Coverage verification for long multi-role posts. Advisory only: a
    // mismatch is surfaced to the reviewer, never used to discard roles.
    // Threshold is 4 extracted openings so a post that actually lists five
    // roles but only produced four is still caught.
    let coverage: CoverageReport | null = null;
    if (extraction.openings.length >= 4 && typeof ai.listRoles === 'function') {
      coverage = await runCoverageCheck(ai, request, extraction.openings.map((opening) => opening.job_title));
      if (coverage && coverage.missing.length > 0) {
        warnings.push(
          `Coverage check: the source may mention ${coverage.detected.length} roles but ${coverage.missing.length} were not extracted (${coverage.missing.join(', ')}). Review the source before publishing.`,
        );
      }
    }

    // Exclude this capture's own rows: on a retry after a partial multi-opening
    // write, its already-created openings must not be reported as duplicates.
    const duplicateCandidates = await store.recentDuplicateCandidates(300, capture.id);
    const allPotentialDuplicates: DuplicateCandidate[] = [];

    // Per-opening duplicate check, company resolution and opportunity creation.
    const openingResults = await Promise.all(
      extraction.openings.map(async (opening, oi) => {
        const openingKey = oi + 1;
        const companyName = opening.company_name ?? extraction.company_name ?? capture.submitted_company ?? null;
        const duplicateCheck = checkDuplicates(
          {
            title: opening.job_title ?? 'Untitled opportunity',
            companyName,
            source_url: capture.source_url,
            normalized_source_key: capture.normalized_source_key,
          },
          duplicateCandidates,
        );

        if (duplicateCheck.exact) {
          return {
            opportunity: null as unknown as OpportunityWithRelations,
            extraction: opening,
            isDuplicate: true,
          };
        }

        for (const duplicate of duplicateCheck.potential) {
          allPotentialDuplicates.push(duplicate);
          warnings.push(`Possible duplicate of "${duplicate.title}" (${duplicate.reason})`);
        }

        const category = resolveCategory(opening.category_slug ?? opening.category, categories);
        if (!category) warnings.push(`Opening ${openingKey}: no category matched; assign one before publishing.`);

        const company = await resolveCompany(
          store,
          companyName,
          opening.company_website ?? extraction.company_website,
          opening.company_description ?? extraction.company_description,
        );

        const application = normaliseApplication(opening, capture);
        warnings.push(...application.warnings);

        const completeness = computeCompleteness(
          {
            title: opening.job_title,
            company_id: company?.id ?? null,
            company_name: companyName,
            summary: opening.summary ?? opening.description,
            responsibilities: opening.responsibilities,
            requirements: opening.requirements,
            skills: opening.required_skills,
            location_text: opening.location,
            city: opening.city,
            country: opening.country,
            work_mode: opening.work_mode,
            employment_type: opening.employment_type,
            salary_min: opening.salary_min,
            salary_max: opening.salary_max,
            experience_min_years: opening.experience_min_years,
            experience_max_years: opening.experience_max_years,
            application_method: application.method,
            application_url: application.applicationUrl,
            recruitment_email: application.email,
            deadline: application.deadline,
            education_requirements: opening.education_requirements,
            confidence: opening.confidence || extraction.confidence,
          },
          { hasApplicationRoute: application.method !== 'none' },
        );

        const baseSlug = buildOpportunitySlug(
          opening.job_title ?? 'Untitled opportunity',
          companyName ?? 'company',
          extraction.openings.length > 1 ? `${capture.id.slice(0, 6)}-${openingKey}` : capture.id.slice(0, 6),
        );

        const draft: OpportunityDraft = {
          slug: baseSlug,
          title: opening.job_title?.trim() || 'Untitled opportunity',
          company_id: company?.id ?? null,
          category_id: category?.id ?? null,
          summary: opening.summary ?? opening.description ?? null,
          responsibilities: opening.responsibilities ?? [],
          requirements: opening.requirements ?? [],
          skills: opening.required_skills ?? [],
          preferred_skills: opening.preferred_skills ?? [],
          education_requirements: opening.education_requirements ?? [],
          benefits: opening.benefits ?? [],
          languages: opening.languages ?? [],
          recruiter_name: opening.recruiter_name ?? extraction.recruiter_name ?? null,
          quality_flags: completeness.flags,
          completeness_score: completeness.score,
          location_text: opening.location ?? null,
          city: opening.city ?? null,
          country: opening.country ?? null,
          country_code: countryCode(opening.country),
          work_mode: (opening.work_mode as WorkMode) || 'unspecified',
          employment_type: (opening.employment_type as EmploymentType) || 'unspecified',
          salary_min: opening.salary_min ?? null,
          salary_max: opening.salary_max ?? null,
          currency: opening.currency ?? null,
          salary_period: (opening.salary_period as SalaryPeriod) || 'unspecified',
          experience_min_years: opening.experience_min_years ?? null,
          experience_max_years: opening.experience_max_years ?? null,
          application_method: (application.method as ApplicationMethod) || 'none',
          application_url: application.applicationUrl,
          recruitment_email: application.email,
          careers_url: application.careersUrl,
          application_instructions: application.instructions,
          source_url: capture.source_url,
          source_type: capture.source_type,
          source_capture_id: capture.id,
          canonical_source_key: capture.normalized_source_key || null,
          opening_key: openingKey,
          publication_number: null,
          deadline: application.deadline,
          original_posted_at:
            normalisedOriginalDate(extraction, warnings) ?? dateOnly(capture.source_posted_at),
          original_date_precision: extraction.original_date_precision as DatePrecision,
          original_date_text: extraction.original_date_text,
          status: 'pending_review',
          verification_status: 'needs_verification',
          is_featured: false,
          discovered_at: new Date().toISOString(),
          published_at: null,
          last_verified_at: null,
          closed_at: null,
          admin_notes: `AI extraction confidence: ${Math.round((opening.confidence || extraction.confidence) * 100)}%. Completeness: ${Math.round(completeness.score * 100)}%. Source: ${capture.source_url ?? 'pasted text'}. Opening ${openingKey}/${extraction.openings.length}.`,
          created_by: opts.actor,
        };

        const readiness = validateForPublication(draft, companyName, category?.name ?? null, capture.raw_text);
        draft.status = readiness.ok ? 'pending_review' : 'draft';
        if (!readiness.ok) {
          draft.quality_flags = [...new Set([...draft.quality_flags, 'needs_information'])];
          draft.admin_notes = `${draft.admin_notes ?? ''} Needs information before review: ${readiness.blocking.join(' ')}`.trim();
        }

        // Resumable write. A previous attempt may have already created this
        // exact opening before failing on a later one. Reuse that row rather
        // than colliding with the (canonical_source_key, opening_key) index,
        // which would otherwise either drop the opening or create a duplicate.
        let opportunity: Opportunity | null = capture.normalized_source_key
          ? await store.findOpportunityByOpening(capture.normalized_source_key, openingKey)
          : null;
        const reused = opportunity != null;

        if (!opportunity) {
          try {
            opportunity = await store.createOpportunity(draft);
          } catch (error) {
            const message = error instanceof Error ? error.message : '';
            const uniqueConflict = /duplicate|already exists|unique|23505|conflict/i.test(message);
            // A concurrent worker may have inserted the same opening between
            // the lookup and the insert. Re-read before doing anything else.
            if (uniqueConflict && capture.normalized_source_key) {
              opportunity = await store.findOpportunityByOpening(capture.normalized_source_key, openingKey);
            }
            if (!opportunity) {
              if (/slug/i.test(message)) {
                opportunity = await store.createOpportunity({
                  ...draft,
                  slug: `${draft.slug}-${Math.random().toString(36).slice(2, 6)}`,
                });
              } else {
                throw error;
              }
            }
          }
        }

        if (!opportunity) {
          // Defensive: the branches above either assign a row or throw, so this
          // is unreachable. It exists so no opening can ever be dropped silently.
          throw new ServiceError('create_failed', `Opening ${openingKey} could not be saved.`, 500);
        }

        if (reused && opportunity.status === 'pending_review') {
          // Refresh an opening written by an earlier failed attempt so a changed
          // extraction order can never leave stale content in this slot. Rows a
          // reviewer already approved or published are never overwritten.
          opportunity = await store.updateOpportunity(opportunity.id, {
            ...draft,
            discovered_at: opportunity.discovered_at,
            status: opportunity.status,
          });
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

        return {
          opportunity: withRelations,
          extraction: opening,
          isDuplicate: false,
        };
      }),
    );

    const opportunities = openingResults
      .filter((r) => r.opportunity !== null && !r.isDuplicate)
      .map((r) => r.opportunity) as OpportunityWithRelations[];

    const extractionSummary = extraction.openings.map((op, i) => ({
      openingIndex: i,
      job_title: op.job_title,
      category: op.category_slug ?? op.category,
      company_name: op.company_name,
      confidence: op.confidence,
    }));

    const updated = await store.updateCapture(captureId, {
      status: 'needs_review',
      extraction: coverage ? { ...extraction, coverage_check: coverage } : extraction,
      extraction_confidence: extraction.confidence,
      opportunity_id: opportunities[0]?.id ?? null,
      error_message: null,
    });

    await store.logActivity({
      actor: opts.actor,
      action: 'capture.extracted',
      entity_type: 'source_capture',
      entity_id: capture.id,
      metadata: { opportunity_count: opportunities.length, confidence: extraction.confidence },
    });

    return {
      capture: updated,
      opportunity: opportunities[0] ?? null,
      opportunities,
      extractions: extractionSummary,
      genuine: true,
      warnings,
      potentialDuplicates: allPotentialDuplicates,
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
    throw new ServiceError('already_processed', 'This capture has already produced an opportunity.', 409);
  }
  if (!['extraction_failed', 'received', 'validating', 'duplicate_check', 'retrieval_failed'].includes(capture.status)) {
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
    if (opportunity) {
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
    metadata: { reason: note ?? 'Rejected by administrator.' },
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

export function resolveCategory(slugOrName: string | null | undefined, categories: Category[]): Category | null {
  if (!slugOrName) return null;
  const value = slugOrName.trim().toLowerCase();
  return (
    categories.find((c) => c.slug === value) ??
    categories.find((c) => c.name.toLowerCase() === value) ??
    categories.find((c) => slugify(c.name) === slugify(value)) ??
    null
  );
}

async function resolveCompany(
  store: Store,
  name: string | null,
  website: string | null,
  description?: string | null,
): Promise<Company | null> {
  const cleanName = name?.trim();
  if (!cleanName) return null;
  const existing = await store.findCompanyByName(cleanName);
  if (existing) return existing;
  const websiteSafe = safeOutboundUrl(website);
  const descriptionSafe = description?.trim().slice(0, 1200) || null;
  try {
    return await store.createCompany({
      name: cleanName.slice(0, 160),
      slug: slugify(cleanName).slice(0, 70) || `company-${Date.now()}`,
      website: websiteSafe,
      description: descriptionSafe,
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
        description: descriptionSafe,
        verified: false,
      });
    } catch {
      return null;
    }
  }
}

function normaliseApplication(
  opening: {
    application_method: string;
    application_url?: string | null;
    recruitment_email?: string | null;
    application_instructions?: string | null;
    deadline?: string | null;
  },
  capture: SourceCapture,
): { method: string; applicationUrl: string | null; email: string | null; careersUrl: string | null; deadline: string | null; instructions: string | null; warnings: string[] } {
  const warnings: string[] = [];
  let method = opening.application_method;
  let applicationUrl = safeOutboundUrl(opening.application_url);
  const careersUrl: string | null = null;
  const email = normalizeEmail(opening.recruitment_email);
  let instructions = opening.application_instructions?.trim() || null;

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
    if (!linkedInPostUrl(capture.source_url) || !instructions) {
      warnings.push('LinkedIn application requires the original post URL and explicit application instructions.');
      method = 'none';
    }
  }

  // LinkedIn frequently hides an embedded job link from copied post text. If
  // the author explicitly invites applications, DMs, or profiles, preserve the
  // original post as the honest candidate route instead of inventing a URL.
  if (method === 'none' && !applicationUrl && !email && isLinkedInShortPostUrl(capture.source_url) &&
      /\b(apply|dm|share|send)\b[\s\S]{0,80}\b(profile|resume|cv|job link|application)?\b/i.test(capture.raw_text)) {
    method = 'external_url';
    applicationUrl = safeOutboundUrl(capture.source_url);
    instructions = 'Open the original LinkedIn post and follow its application instructions or contact the poster.';
    warnings.push('The copied text omitted the embedded application destination; candidates will be sent to the original LinkedIn post.');
  }

  let deadline: string | null = null;
  if (opening.deadline) {
    const time = Date.parse(`${opening.deadline}T23:59:59Z`);
    if (Number.isFinite(time) && time >= Date.now()) deadline = opening.deadline;
    else warnings.push('The stated deadline has passed or is invalid; it was not applied.');
  }

  return { method, applicationUrl, email, careersUrl, deadline, instructions, warnings };
}

export type CoverageReport = {
  checked: true;
  detected: string[];
  extracted: string[];
  missing: string[];
};

function roleKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(senior|junior|lead|staff|principal)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function roleMatches(detected: string, extracted: string): boolean {
  const a = roleKey(detected);
  const b = roleKey(extracted);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * Second, cheap AI pass that lists role titles. Failure or quota exhaustion is
 * ignored: extraction already succeeded and must not be discarded because the
 * coverage check could not run.
 */
async function runCoverageCheck(
  ai: AIProvider,
  request: ExtractionRequest,
  extractedTitles: Array<string | null | undefined>,
): Promise<CoverageReport | null> {
  if (!ai.listRoles) return null;
  try {
    const roles = await ai.listRoles(request);
    const detected = [...new Set(roles.map((role) => role.trim()).filter(Boolean))];
    const extracted = extractedTitles.filter((title): title is string => Boolean(title?.trim()));
    const missing = detected.filter((role) => !extracted.some((title) => roleMatches(role, title)));
    return { checked: true, detected, extracted, missing };
  } catch {
    return null;
  }
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
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

export function countryCode(country: string | null | undefined): string | null {
  if (!country) return null;
  return COUNTRY_CODES[country.trim().toLowerCase()] ?? null;
}

export function generateFixedComment(number: number, siteUrl: string): string {
  return `Explore more ${number} similar opportunities at Hustler Community: ${siteUrl.replace(/\/+$/, '')}/opportunities`;
}
