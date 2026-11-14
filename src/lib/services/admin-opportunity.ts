import type { Opportunity, OpportunityDraft } from '../domain/types';
import type { OpportunityInput } from '../domain/validation';
import { normalizeIsoDate, opportunityInputSchema, validateForPublication } from '../domain/validation';
import {
  buildOpportunitySlug,
  canonicalSourceKey,
  extractLinkedInPostId,
  isValidHttpUrl,
  normalizeEmail,
  normalizeSourceUrl,
  safeOutboundUrl,
  slugify,
} from '../domain/url';
import type { Store } from '../store/types';
import type { OpportunityWithRelations } from '../domain/types';
import { ServiceError } from './errors';
import { refreshComments } from './comments';

type Prepared = {
  patch: Partial<Opportunity>;
  blocking: string[];
};

/**
 * Validates and normalises administrator input exactly once so manual creation
 * and editing share the same rules (URLs, emails, dates, salaries, experience).
 */
function prepareInput(input: OpportunityInput): Prepared {
  const blocking: string[] = [];
  const applicationUrl = input.application_url ? safeOutboundUrl(input.application_url) : null;
  const careersUrl = input.careers_url ? safeOutboundUrl(input.careers_url) : null;
  const companyWebsite = input.company_website ? safeOutboundUrl(input.company_website) : null;
  const sourceUrl = input.source_url ? normalizeSourceUrl(input.source_url) : null;
  const email = input.recruitment_email ? normalizeEmail(input.recruitment_email) : null;
  const deadline = input.deadline ? normalizeIsoDate(input.deadline) : null;
  const originalPosted = input.original_posted_at ? normalizeIsoDate(input.original_posted_at) : null;

  if (input.application_url && !applicationUrl) blocking.push('Application URL must be a valid http(s) address.');
  if (input.careers_url && !careersUrl) blocking.push('Careers URL must be a valid http(s) address.');
  if (input.company_website && !companyWebsite) blocking.push('Company website must be a valid http(s) address.');
  if (input.source_url && !sourceUrl) blocking.push('Source URL must be a valid http(s) address.');
  if (input.recruitment_email && !email) blocking.push('Recruitment email is not valid.');
  if (input.deadline && !deadline) blocking.push('Deadline must be a valid date.');
  if (input.original_posted_at && !originalPosted) blocking.push('Original posting date must be a valid date.');
  if (input.salary_min != null && input.salary_max != null && input.salary_min > input.salary_max) {
    blocking.push('Minimum salary cannot exceed maximum salary.');
  }
  if (
    input.experience_min_years != null &&
    input.experience_max_years != null &&
    input.experience_min_years > input.experience_max_years
  ) {
    blocking.push('Minimum experience cannot exceed maximum experience.');
  }
  if (deadline && originalPosted && deadline < originalPosted) {
    blocking.push('Deadline cannot be earlier than the original posting date.');
  }

  return {
    blocking,
    patch: {
      title: input.title,
      category_id: input.category_id,
      summary: input.summary,
      responsibilities: input.responsibilities,
      requirements: input.requirements,
      skills: input.skills,
      preferred_skills: input.preferred_skills,
      location_text: input.location_text,
      city: input.city,
      country: input.country,
      country_code: input.country_code ? input.country_code.toUpperCase() : null,
      work_mode: input.work_mode,
      employment_type: input.employment_type,
      salary_min: input.salary_min,
      salary_max: input.salary_max,
      currency: input.currency ? input.currency.toUpperCase().slice(0, 3) : null,
      salary_period: input.salary_period,
      experience_min_years: input.experience_min_years,
      experience_max_years: input.experience_max_years,
      application_method: input.application_method,
      application_url: applicationUrl,
      recruitment_email: email,
      careers_url: careersUrl,
      application_instructions: input.application_instructions,
      source_url: sourceUrl,
      source_type: input.source_type,
      deadline,
      original_posted_at: originalPosted,
      original_date_precision: input.original_date_precision,
      original_date_text: input.original_date_text,
      verification_status: input.verification_status,
      is_featured: input.is_featured,
      admin_notes: input.admin_notes,
    },
  };
}

async function resolveCompany(
  store: Store,
  input: OpportunityInput,
): Promise<{ companyId: string | null; blocking: string[] }> {
  const blocking: string[] = [];
  const companyId = input.company_id;

  if (companyId) {
    const company = await store.getCompanyById(companyId);
    if (!company) blocking.push('Selected company no longer exists.');
    return { companyId, blocking };
  }

  if (input.company_name) {
    const existing = await store.findCompanyByName(input.company_name);
    if (existing) return { companyId: existing.id, blocking };
    try {
      const website = input.company_website ? safeOutboundUrl(input.company_website) : null;
      const careers = input.company_careers_url ? safeOutboundUrl(input.company_careers_url) : null;
      const created = await store.createCompany({
        name: input.company_name,
        slug: `${slugify(input.company_name).slice(0, 60)}-${Math.random().toString(36).slice(2, 6)}`,
        website,
        careers_url: careers,
        verified: false,
      });
      return { companyId: created.id, blocking };
    } catch {
      blocking.push('Could not create the company. Try selecting an existing company.');
    }
  } else {
    blocking.push('Choose an existing company or enter a company name.');
  }
  return { companyId, blocking };
}

function relations(updated: Opportunity, company: Awaited<ReturnType<Store['getCompanyById']>>, category: Awaited<ReturnType<Store['getCategoryById']>>): OpportunityWithRelations {
  return {
    ...updated,
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
}

/**
 * Saves an opportunity after an administrator edit. The same validation used
 * by publishing protects already-published records from being saved into an
 * unpublishable state.
 */
export async function saveOpportunity(
  store: Store,
  opportunityId: string,
  rawInput: unknown,
  opts: { actor: string; siteUrl: string },
): Promise<{ opportunity: OpportunityWithRelations; warnings: string[]; blocking: string[] }> {
  const current = await store.getOpportunityById(opportunityId);
  if (!current) throw new ServiceError('not_found', 'Opportunity not found.', 404);

  const parsed = opportunityInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError('invalid_input', 'Please check the highlighted fields.', 422, {
      issues: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  const input: OpportunityInput = parsed.data;
  const { patch, blocking: inputBlocking } = prepareInput(input);
  const blocking = [...inputBlocking];

  const { companyId, blocking: companyBlocking } = await resolveCompany(store, input);
  blocking.push(...companyBlocking);

  if (input.category_id) {
    const category = await store.getCategoryById(input.category_id);
    if (!category) blocking.push('Selected category no longer exists.');
  }

  if (blocking.length) {
    throw new ServiceError('invalid_input', blocking[0], 422, { blocking });
  }

  patch.company_id = companyId;

  const effective = { ...current, ...patch };
  let warnings: string[] = [];
  if (current.status === 'published') {
    const validation = validateForPublication(effective, current.company?.name ?? input.company_name, current.category?.name);
    if (!validation.ok) {
      throw new ServiceError('not_publishable', 'These changes would make the published listing invalid.', 422, {
        blocking: validation.blocking,
        warnings: validation.warnings,
      });
    }
    warnings = validation.warnings;
  }

  const updated = await store.updateOpportunity(opportunityId, patch);
  const company = companyId ? await store.getCompanyById(companyId) : null;
  const category = input.category_id ? await store.getCategoryById(input.category_id) : null;
  const withRelations = relations(updated, company, category);

  if (['draft', 'pending_review', 'published', 'closed', 'expired'].includes(updated.status)) {
    await refreshComments(store, withRelations, opts.siteUrl).catch(() => undefined);
  }

  await store.logActivity({
    actor: opts.actor,
    action: 'opportunity.updated',
    entity_type: 'opportunity',
    entity_id: opportunityId,
    metadata: { title: updated.title },
  });

  return { opportunity: withRelations, warnings, blocking: [] };
}

/**
 * Manual creation. Always lands as a draft so a human can verify every field
 * and a real application route before publishing. No system timestamps are
 * taken from user input.
 */
export async function createOpportunityManually(
  store: Store,
  rawInput: unknown,
  opts: { actor: string; siteUrl: string },
): Promise<{ opportunity: OpportunityWithRelations; warnings: string[] }> {
  const parsed = opportunityInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError('invalid_input', 'Please check the highlighted fields.', 422, {
      issues: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  const input = parsed.data;
  const { patch, blocking: inputBlocking } = prepareInput(input);
  const blocking = [...inputBlocking];
  const { companyId, blocking: companyBlocking } = await resolveCompany(store, input);
  blocking.push(...companyBlocking);
  if (!input.category_id) blocking.push('Choose a category before creating a draft.');
  if (blocking.length) throw new ServiceError('invalid_input', blocking[0], 422, { blocking });

  const company = companyId ? await store.getCompanyById(companyId) : null;
  const category = input.category_id ? await store.getCategoryById(input.category_id) : null;
  const sourceKey = canonicalSourceKey(patch.source_url ?? null, extractLinkedInPostId(patch.source_url ?? ''));

  const draft: OpportunityDraft = {
    slug: buildOpportunitySlug(input.title, company?.name ?? input.company_name ?? 'opportunity'),
    title: input.title,
    company_id: companyId,
    category_id: input.category_id,
    summary: input.summary,
    responsibilities: input.responsibilities,
    requirements: input.requirements,
    skills: input.skills,
    preferred_skills: input.preferred_skills,
    location_text: input.location_text,
    city: input.city,
    country: input.country,
    country_code: patch.country_code ?? null,
    work_mode: input.work_mode,
    employment_type: input.employment_type,
    salary_min: input.salary_min,
    salary_max: input.salary_max,
    currency: patch.currency ?? null,
    salary_period: input.salary_period,
    experience_min_years: input.experience_min_years,
    experience_max_years: input.experience_max_years,
    application_method: input.application_method,
    application_url: patch.application_url ?? null,
    recruitment_email: patch.recruitment_email ?? null,
    careers_url: patch.careers_url ?? null,
    application_instructions: input.application_instructions,
    source_url: patch.source_url ?? null,
    source_type: input.source_type,
    source_capture_id: null,
    canonical_source_key: sourceKey,
    deadline: patch.deadline ?? null,
    original_posted_at: patch.original_posted_at ?? null,
    original_date_precision: input.original_date_precision,
    original_date_text: input.original_date_text,
    status: 'draft',
    verification_status: input.verification_status,
    is_featured: false,
    published_at: null,
    last_verified_at: null,
    closed_at: null,
    admin_notes: input.admin_notes,
    created_by: opts.actor,
  };

  const created = await store.createOpportunity(draft);
  const withRelations = relations(created, company, category);
  await refreshComments(store, withRelations, opts.siteUrl).catch(() => undefined);

  await store.logActivity({
    actor: opts.actor,
    action: 'opportunity.created',
    entity_type: 'opportunity',
    entity_id: created.id,
    metadata: { title: created.title },
  });

  return { opportunity: withRelations, warnings: [] };
}

export async function setVerification(
  store: Store,
  opportunityId: string,
  status: Opportunity['verification_status'],
  actor: string,
): Promise<Opportunity> {
  const opportunity = await store.getOpportunityById(opportunityId);
  if (!opportunity) throw new ServiceError('not_found', 'Opportunity not found.', 404);
  const updated = await store.updateOpportunity(opportunityId, {
    verification_status: status,
    last_verified_at: new Date().toISOString(),
  });
  await store.logActivity({
    actor,
    action: 'opportunity.verification_updated',
    entity_type: 'opportunity',
    entity_id: opportunityId,
    metadata: { status },
  });
  return updated;
}

export function validateUrlField(value: string | null | undefined): boolean {
  return !value || isValidHttpUrl(value);
}
