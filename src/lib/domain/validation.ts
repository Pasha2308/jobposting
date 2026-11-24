import { z } from 'zod';
import {
  APPLICATION_METHODS,
  COMMENT_STYLES,
  DATE_PRECISIONS,
  EMPLOYMENT_TYPES,
  EVENT_TYPES,
  REPORT_REASONS,
  SALARY_PERIODS,
  SOURCE_TYPES,
  WORK_MODES,
} from './types';
import type { Opportunity, OpportunityDraft } from './types';
import { isSafeEmail, isValidHttpUrl, linkedInPostUrl, normalizeEmail, safeOutboundUrl } from './url';
import { checkEnglishJobContent } from './language';

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

const stringList = (maxItems = 30, maxLen = 400) =>
  z
    .array(z.string().trim().min(1).max(maxLen))
    .max(maxItems)
    .optional()
    .default([]);

/* -------------------------------------------------------------------------- */
/* Tolerant enums                                                             */
/* -------------------------------------------------------------------------- */
/*
 * AI providers occasionally return a near-miss enum (for example
 * `original_date_precision: "day"`). Rejecting the whole response would discard
 * every opening in a multi-role post, so known synonyms are normalised and
 * unknown values fall back to a safe default instead.
 */
function normaliseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  aliases: Record<string, T>,
  fallback: T,
): T {
  if (typeof value !== 'string') return fallback;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if ((allowed as readonly string[]).includes(key)) return key as T;
  return aliases[key] ?? fallback;
}

const WORK_MODE_ALIASES: Record<string, (typeof WORK_MODES)[number]> = {
  wfh: 'remote',
  work_from_home: 'remote',
  remote_work: 'remote',
  on_site: 'onsite',
  in_office: 'onsite',
  office: 'onsite',
  not_specified: 'unspecified',
  unknown: 'unspecified',
};

const EMPLOYMENT_TYPE_ALIASES: Record<string, (typeof EMPLOYMENT_TYPES)[number]> = {
  fulltime: 'full_time',
  permanent: 'full_time',
  parttime: 'part_time',
  intern: 'internship',
  intern_ship: 'internship',
  contractor: 'contract',
  freelance: 'contract',
  consulting: 'contract',
  consultant: 'contract',
  not_specified: 'unspecified',
  unknown: 'unspecified',
};

const SALARY_PERIOD_ALIASES: Record<string, (typeof SALARY_PERIODS)[number]> = {
  yearly: 'annual',
  per_annum: 'annual',
  per_year: 'annual',
  annum: 'annual',
  lpa: 'annual',
  per_month: 'monthly',
  month: 'monthly',
  per_day: 'daily',
  per_hour: 'hourly',
  monthly_stipend: 'stipend',
  not_specified: 'unspecified',
  unknown: 'unspecified',
};

const APPLICATION_METHOD_ALIASES: Record<string, (typeof APPLICATION_METHODS)[number]> = {
  url: 'external_url',
  link: 'external_url',
  external: 'external_url',
  apply_link: 'external_url',
  e_mail: 'email',
  mail: 'email',
  linkedin: 'linkedin_post',
  dm: 'linkedin_post',
  careers: 'careers_page',
  company_careers: 'careers_page',
  no_route: 'none',
  not_specified: 'none',
  unknown: 'none',
};

const DATE_PRECISION_ALIASES: Record<string, (typeof DATE_PRECISIONS)[number]> = {
  day: 'exact',
  date: 'exact',
  full_date: 'exact',
  exact_date: 'exact',
  month_year: 'month',
  year_only: 'year',
  unspecified: 'unknown',
  approximate: 'unknown',
};

const workModeSchema = z.preprocess(
  (value) => normaliseEnum(value, WORK_MODES, WORK_MODE_ALIASES, 'unspecified'),
  z.enum(WORK_MODES),
);
const employmentTypeSchema = z.preprocess(
  (value) => normaliseEnum(value, EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_ALIASES, 'unspecified'),
  z.enum(EMPLOYMENT_TYPES),
);
const salaryPeriodSchema = z.preprocess(
  (value) => normaliseEnum(value, SALARY_PERIODS, SALARY_PERIOD_ALIASES, 'unspecified'),
  z.enum(SALARY_PERIODS),
);
const applicationMethodSchema = z.preprocess(
  (value) => normaliseEnum(value, APPLICATION_METHODS, APPLICATION_METHOD_ALIASES, 'none'),
  z.enum(APPLICATION_METHODS),
);
const datePrecisionSchema = z.preprocess(
  (value) => normaliseEnum(value, DATE_PRECISIONS, DATE_PRECISION_ALIASES, 'unknown'),
  z.enum(DATE_PRECISIONS),
);

/* -------------------------------------------------------------------------- */
/* AI extraction output contract                                               */
/* -------------------------------------------------------------------------- */

export const extractionSchema = z.object({
  is_genuine_opportunity: z.boolean(),
  genuine_opportunity_reason: z.string().max(500).nullable().optional().default(null),
  job_title: z.string().max(160).nullable().optional().default(null),
  company_name: z.string().max(160).nullable().optional().default(null),
  company_website: z.string().max(300).nullable().optional().default(null),
  company_description: z.string().max(1200).nullable().optional().default(null),
  category_slug: z.string().max(80).nullable().optional().default(null),
  summary: z.string().max(1200).nullable().optional().default(null),
  responsibilities: z.array(z.string().max(400)).max(15).nullable().optional().default([]),
  requirements: z.array(z.string().max(400)).max(15).nullable().optional().default([]),
  required_skills: z.array(z.string().max(80)).max(25).nullable().optional().default([]),
  preferred_skills: z.array(z.string().max(80)).max(25).nullable().optional().default([]),
  education_requirements: z.array(z.string().max(200)).max(10).nullable().optional().default([]),
  benefits: z.array(z.string().max(200)).max(20).nullable().optional().default([]),
  languages: z.array(z.string().max(60)).max(10).nullable().optional().default([]),
  recruiter_name: z.string().max(160).nullable().optional().default(null),
  location: z.string().max(160).nullable().optional().default(null),
  city: z.string().max(100).nullable().optional().default(null),
  country: z.string().max(100).nullable().optional().default(null),
  work_mode: workModeSchema,
  employment_type: employmentTypeSchema,
  salary_min: z.number().min(0).max(1_000_000_000).nullable().optional().default(null),
  salary_max: z.number().min(0).max(1_000_000_000).nullable().optional().default(null),
  currency: z.string().max(8).nullable().optional().default(null),
  salary_period: salaryPeriodSchema,
  experience_min_years: z.number().min(0).max(60).nullable().optional().default(null),
  experience_max_years: z.number().min(0).max(60).nullable().optional().default(null),
  application_method: applicationMethodSchema,
  recruitment_email: z.string().max(254).nullable().optional().default(null),
  application_url: z.string().max(1000).nullable().optional().default(null),
  application_instructions: z.string().max(1200).nullable().optional().default(null),
  deadline: z.string().max(40).nullable().optional().default(null),
  original_posted_date: z.string().max(40).nullable().optional().default(null),
  original_date_precision: datePrecisionSchema,
  original_date_text: z.string().max(200).nullable().optional().default(null),
  confidence: z.number().min(0).max(1).optional().default(0),
  warnings: z
    .array(z.string().max(300))
    .max(20)
    .nullable()
    .optional()
    .transform((value) => value ?? []),

  /** Openings array — one record per distinct job opening in the source post. */
  openings: z
    .array(
      z.object({
        job_title: z.string().max(160).nullable().default(null),
        company_name: z.string().max(160).nullable().optional().default(null),
        company_website: z.string().max(300).nullable().optional().default(null),
        company_description: z.string().max(1200).nullable().optional().default(null),
        category_slug: z.string().max(80).nullable().optional().default(null),
        category: z.string().max(80).nullable().optional().default(null),
        summary: z.string().max(1200).nullable().optional().default(null),
        description: z.string().max(1200).nullable().optional().default(null),
        responsibilities: z.array(z.string().max(400)).max(15).nullable().optional().default([]),
        requirements: z.array(z.string().max(400)).max(15).nullable().optional().default([]),
        required_skills: z.array(z.string().max(80)).max(25).nullable().optional().default([]),
        preferred_skills: z.array(z.string().max(80)).max(25).nullable().optional().default([]),
        education_requirements: z.array(z.string().max(200)).max(10).nullable().optional().default([]),
        benefits: z.array(z.string().max(200)).max(20).nullable().optional().default([]),
        languages: z.array(z.string().max(60)).max(10).nullable().optional().default([]),
        recruiter_name: z.string().max(160).nullable().optional().default(null),
        location: z.string().max(160).nullable().optional().default(null),
        city: z.string().max(100).nullable().optional().default(null),
        country: z.string().max(100).nullable().optional().default(null),
        work_mode: workModeSchema,
        employment_type: employmentTypeSchema,
        salary_min: z.number().min(0).max(1_000_000_000).nullable().optional().default(null),
        salary_max: z.number().min(0).max(1_000_000_000).nullable().optional().default(null),
        currency: z.string().max(8).nullable().optional().default(null),
        salary_period: salaryPeriodSchema,
        experience_min_years: z.number().min(0).max(60).nullable().optional().default(null),
        experience_max_years: z.number().min(0).max(60).nullable().optional().default(null),
        application_method: applicationMethodSchema,
        recruitment_email: z.string().max(254).nullable().optional().default(null),
        application_url: z.string().max(1000).nullable().optional().default(null),
        application_instructions: z.string().max(1200).nullable().optional().default(null),
        deadline: z.string().max(40).nullable().optional().default(null),
        confidence: z.number().min(0).max(1).optional().default(0),
        warnings: z
          .array(z.string().max(300))
          .max(20)
          .nullable()
          .optional()
          .transform((value) => value ?? []),
      }),
    )
    .default([]),
});

export type ExtractionOutput = z.infer<typeof extractionSchema>;

/** Schema accepted from the AI, with nulls tolerated for optional arrays. */
export const lenientExtractionSchema = extractionSchema.extend({
  responsibilities: z.array(z.string().max(400)).max(15).nullable().default([]),
  requirements: z.array(z.string().max(400)).max(15).nullable().default([]),
  required_skills: z.array(z.string().max(80)).max(25).nullable().default([]),
  preferred_skills: z.array(z.string().max(80)).max(25).nullable().default([]),
  warnings: z
    .array(z.string().max(300))
    .max(20)
    .nullable()
    .default([])
    .transform((value) => value ?? []),
});

export function validateExtraction(raw: unknown): { ok: true; value: ExtractionOutput } | { ok: false; issues: string[] } {
  const parsed = lenientExtractionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.slice(0, 12).map((i) => `${i.path.join('.') || 'root'}: ${i.message}`),
    };
  }
  const v = parsed.data;
  const sanitised = {
    ...v,
    responsibilities: v.responsibilities ?? [],
    requirements: v.requirements ?? [],
    required_skills: v.required_skills ?? [],
    preferred_skills: v.preferred_skills ?? [],
    warnings: v.warnings ?? [],
    company_website: safeOutboundUrl(v.company_website),
    application_url: safeOutboundUrl(v.application_url),
    recruitment_email: normalizeEmail(v.recruitment_email),
    deadline: normalizeIsoDate(v.deadline),
    original_posted_date: normalizeIsoDate(v.original_posted_date),
    currency: v.currency ? v.currency.trim().toUpperCase().slice(0, 3) : null,
  };

  if (sanitised.salary_min != null && sanitised.salary_max != null && sanitised.salary_min > sanitised.salary_max) {
    [sanitised.salary_min, sanitised.salary_max] = [sanitised.salary_max, sanitised.salary_min];
    sanitised.warnings.push('Salary range was reversed in the source; values were ordered low to high.');
  }
  if (
    sanitised.experience_min_years != null &&
    sanitised.experience_max_years != null &&
    sanitised.experience_min_years > sanitised.experience_max_years
  ) {
    [sanitised.experience_min_years, sanitised.experience_max_years] = [
      sanitised.experience_max_years,
      sanitised.experience_min_years,
    ];
    sanitised.warnings.push('Experience range was reversed in the source; values were ordered low to high.');
  }

  // Ensure openings array is populated and sanitized
  if (sanitised.openings.length === 0) {
    if (sanitised.is_genuine_opportunity && sanitised.job_title) {
      sanitised.openings = [
        {
          job_title: sanitised.job_title,
          company_name: sanitised.company_name,
          company_website: sanitised.company_website,
          company_description: sanitised.company_description,
          category_slug: sanitised.category_slug,
          category: sanitised.category_slug,
          summary: sanitised.summary,
          description: sanitised.summary,
          responsibilities: sanitised.responsibilities,
          requirements: sanitised.requirements,
          required_skills: sanitised.required_skills,
          preferred_skills: sanitised.preferred_skills,
          education_requirements: sanitised.education_requirements,
          benefits: sanitised.benefits,
          languages: sanitised.languages,
          recruiter_name: sanitised.recruiter_name,
          location: sanitised.location,
          city: sanitised.city,
          country: sanitised.country,
          work_mode: sanitised.work_mode,
          employment_type: sanitised.employment_type,
          salary_min: sanitised.salary_min,
          salary_max: sanitised.salary_max,
          currency: sanitised.currency,
          salary_period: sanitised.salary_period,
          experience_min_years: sanitised.experience_min_years,
          experience_max_years: sanitised.experience_max_years,
          application_method: sanitised.application_method,
          recruitment_email: sanitised.recruitment_email,
          application_url: sanitised.application_url,
          application_instructions: sanitised.application_instructions,
          deadline: sanitised.deadline,
          confidence: sanitised.confidence,
          warnings: sanitised.warnings,
        },
      ];
    }
  } else {
    // Sanitize each opening
    sanitised.openings = sanitised.openings.map((op) => {
      const companyName = op.company_name || sanitised.company_name;
      const categorySlug = op.category_slug || op.category || sanitised.category_slug;
      const summary = op.summary || op.description || sanitised.summary;
      let salaryMin = op.salary_min;
      let salaryMax = op.salary_max;
      const opWarnings = Array.isArray(op.warnings) ? [...op.warnings] : [];

      if (salaryMin != null && salaryMax != null && salaryMin > salaryMax) {
        [salaryMin, salaryMax] = [salaryMax, salaryMin];
        opWarnings.push('Salary range was reversed in the source; values were ordered low to high.');
      }

      let expMin = op.experience_min_years;
      let expMax = op.experience_max_years;
      if (expMin != null && expMax != null && expMin > expMax) {
        [expMin, expMax] = [expMax, expMin];
        opWarnings.push('Experience range was reversed in the source; values were ordered low to high.');
      }

      return {
        ...op,
        company_name: companyName,
        category_slug: categorySlug,
        category: categorySlug,
        summary,
        description: summary,
        responsibilities: op.responsibilities ?? sanitised.responsibilities,
        requirements: op.requirements ?? sanitised.requirements,
        required_skills: op.required_skills ?? sanitised.required_skills,
        preferred_skills: op.preferred_skills ?? sanitised.preferred_skills,
        application_url: safeOutboundUrl(op.application_url),
        recruitment_email: normalizeEmail(op.recruitment_email),
        deadline: normalizeIsoDate(op.deadline) ?? sanitised.deadline,
        currency: op.currency ? op.currency.trim().toUpperCase().slice(0, 3) : sanitised.currency,
        salary_min: salaryMin,
        salary_max: salaryMax,
        experience_min_years: expMin,
        experience_max_years: expMax,
        warnings: opWarnings,
      };
    });

    if (!sanitised.job_title && sanitised.openings[0]?.job_title) {
      sanitised.job_title = sanitised.openings[0].job_title;
    }
    if (!sanitised.category_slug && sanitised.openings[0]?.category_slug) {
      sanitised.category_slug = sanitised.openings[0].category_slug;
    }
  }

  return { ok: true, value: sanitised };
}

export function normalizeIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const d = new Date(`${trimmed}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== trimmed) return null;
    const year = d.getUTCFullYear();
    if (year < 2000 || year > new Date().getUTCFullYear() + 1) return null;
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  if (year < 2000 || year > new Date().getUTCFullYear() + 1) return null;
  return parsed.toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* Application route validation                                                */
/* -------------------------------------------------------------------------- */

export type ApplicationRoute = {
  method: 'external_url' | 'email' | 'linkedin_post' | 'careers_page';
  label: string;
  href: string;
  trackingType: 'apply_click' | 'email_click' | 'source_click' | 'careers_click';
};

export type ApplicationRouteResult = {
  usable: boolean;
  routes: ApplicationRoute[];
  blocking: string[];
  warnings: string[];
};

type RouteInput = Pick<
  OpportunityDraft,
  | 'application_method'
  | 'application_url'
  | 'recruitment_email'
  | 'careers_url'
  | 'application_instructions'
  | 'source_url'
> & { status?: Opportunity['status'] };

/**
 * A published opportunity must expose at least one route that a candidate can
 * actually use. We never render a button for a method that has no destination.
 */
export function resolveApplicationRoutes(o: RouteInput): ApplicationRouteResult {
  const routes: ApplicationRoute[] = [];
  const blocking: string[] = [];
  const warnings: string[] = [];

  const appUrl = safeOutboundUrl(o.application_url);
  const careersUrl = safeOutboundUrl(o.careers_url);
  const email = normalizeEmail(o.recruitment_email);
  const linkedinUrl = linkedInPostUrl(o.source_url);
  const hasInstructions = Boolean(o.application_instructions && o.application_instructions.trim().length > 10);

  if (o.application_method === 'external_url') {
    if (appUrl) routes.push({ method: 'external_url', label: 'Apply now', href: appUrl, trackingType: 'apply_click' });
    else blocking.push('Application method is an external URL, but the URL is missing or invalid.');
  }

  if (o.application_method === 'email') {
    if (email) routes.push({ method: 'email', label: 'Apply via email', href: `mailto:${email}`, trackingType: 'email_click' });
    else blocking.push('Application method is email, but no valid recruitment email is set.');
    if (appUrl) warnings.push('An external application URL is also present; it is shown as a secondary route.');
  }

  if (o.application_method === 'linkedin_post') {
    if (!linkedinUrl) blocking.push('Application method is LinkedIn, but the source is not a LinkedIn post URL.');
    else if (!hasInstructions)
      blocking.push('Application method is LinkedIn, but the original post does not contain reviewed application instructions.');
    else
      routes.push({
        method: 'linkedin_post',
        label: 'View original post',
        href: linkedinUrl,
        trackingType: 'source_click',
      });
  }

  if (o.application_method === 'careers_page') {
    if (careersUrl) routes.push({ method: 'careers_page', label: 'View careers page', href: careersUrl, trackingType: 'careers_click' });
    else blocking.push('Application method is the company careers page, but no verified careers URL is set.');
  }

  if (o.application_method === 'other' || o.application_method === 'none') {
    // Secondary verified routes can still make this publishable, but the
    // selected method itself is not actionable.
    if (appUrl) routes.push({ method: 'external_url', label: 'Apply now', href: appUrl, trackingType: 'apply_click' });
    else if (careersUrl)
      routes.push({ method: 'careers_page', label: 'View careers page', href: careersUrl, trackingType: 'careers_click' });
    else if (email) routes.push({ method: 'email', label: 'Apply via email', href: `mailto:${email}`, trackingType: 'email_click' });
    else if (linkedinUrl && hasInstructions)
      routes.push({ method: 'linkedin_post', label: 'View original post', href: linkedinUrl, trackingType: 'source_click' });
    else blocking.push('No usable application route. Add a verified URL, recruitment email, careers page or LinkedIn instructions.');
  }

  // Secondary routes that the administrator explicitly verified are useful
  // even when the primary method is different.
  if (o.application_method !== 'external_url' && appUrl) {
    routes.push({ method: 'external_url', label: 'Apply now', href: appUrl, trackingType: 'apply_click' });
  }
  if (o.application_method !== 'careers_page' && careersUrl) {
    routes.push({ method: 'careers_page', label: 'Company careers page', href: careersUrl, trackingType: 'careers_click' });
  }
  if (o.application_method !== 'linkedin_post' && linkedinUrl) {
    routes.push({ method: 'linkedin_post', label: 'Original post', href: linkedinUrl, trackingType: 'source_click' });
  }

  const seen = new Set<string>();
  const uniqueRoutes = routes.filter((r) => {
    const key = `${r.method}:${r.href}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { usable: uniqueRoutes.length > 0, routes: uniqueRoutes, blocking, warnings };
}

/** Prefer a real employer application destination; never route email capture to a source post. */
export function resolveCandidateRedirectRoute(o: RouteInput): ApplicationRoute | null {
  const routes = resolveApplicationRoutes(o).routes;
  return routes.find((route) => route.method === 'external_url')
    ?? routes.find((route) => route.method === 'careers_page')
    ?? routes.find((route) => route.method === 'email')
    ?? null;
}

/* -------------------------------------------------------------------------- */
/* Opportunity validation                                                      */
/* -------------------------------------------------------------------------- */

export type OpportunityValidation = {
  ok: boolean;
  blocking: string[];
  warnings: string[];
  routes: ApplicationRoute[];
};

/**
 * Publication gate. Shared by the website, admin API, Telegram bot and any
 * future integration so there is exactly one definition of "publishable".
 */
export function validateForPublication(
  o: OpportunityDraft,
  companyName: string | null | undefined,
  categoryName: string | null | undefined,
  sourceText?: string | null,
): OpportunityValidation {
  const blocking: string[] = [];
  const warnings: string[] = [];

  const language = checkEnglishJobContent(o, sourceText);
  if (!language.ok) blocking.push(language.reason);

  if (!o.title || o.title.trim().length < 3) blocking.push('A role title is required.');
  if (!companyName || companyName.trim().length < 2) blocking.push('A company or hiring organisation name is required.');
  if (!categoryName) blocking.push('A category is required.');
  if (!o.summary || o.summary.trim().length < 30) blocking.push('A factual summary of at least 30 characters is required.');
  if (!o.responsibilities?.some((item) => item.trim())) warnings.push('Responsibilities were not separately stated in the source.');
  if (!o.requirements?.some((item) => item.trim())) warnings.push('Requirements were not separately stated in the source.');
  if (!o.source_url || !safeOutboundUrl(o.source_url)) blocking.push('A valid original source URL is required.');
  if (!o.location_text && !o.country) warnings.push('Location was not shared in the source.');

  const routes = resolveApplicationRoutes({ ...o, status: 'published' });
  blocking.push(...routes.blocking);
  warnings.push(...routes.warnings);

  if (o.salary_min != null && o.salary_min < 0) blocking.push('Salary cannot be negative.');
  if (o.salary_max != null && o.salary_max < 0) blocking.push('Salary cannot be negative.');
  if (o.salary_min != null && o.salary_max != null && o.salary_min > o.salary_max)
    blocking.push('Minimum salary cannot exceed maximum salary.');
  if (o.experience_min_years != null && o.experience_max_years != null && o.experience_min_years > o.experience_max_years)
    blocking.push('Minimum experience cannot exceed maximum experience.');

  if (o.salary_min != null && !o.currency) warnings.push('Salary is set without a currency.');
  if (o.salary_min != null && o.salary_period === 'unspecified') warnings.push('Salary is set without a pay period.');
  if (!o.original_posted_at) warnings.push('Original posting date is unknown; the public page will say "Not specified".');
  if (!o.deadline) warnings.push('No application deadline was provided.');
  if (!o.last_verified_at) warnings.push('The source has not been verified yet.');
  if (o.work_mode === 'unspecified') warnings.push('Work mode is unspecified.');
  if (o.employment_type === 'unspecified') warnings.push('Employment type is unspecified.');
  if (o.original_posted_at) {
    const posted = Date.parse(`${o.original_posted_at}T00:00:00Z`);
    if (Number.isFinite(posted) && posted > Date.now() + 86_400_000) blocking.push('Original posting date cannot be in the future.');
  }
  if (o.deadline) {
    const deadline = Date.parse(`${o.deadline}T23:59:59Z`);
    if (Number.isFinite(deadline) && deadline < Date.now()) blocking.push('The application deadline has already passed.');
  }
  if (o.application_method === 'email' && o.recruitment_email) {
    const domain = o.recruitment_email.split('@')[1]?.toLowerCase() ?? '';
    if (['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'].includes(domain)) {
      warnings.push('Recruitment email uses a free personal mailbox. Confirm it is a public application contact.');
    }
  }

  return { ok: blocking.length === 0, blocking, warnings, routes: routes.routes };
}

/* -------------------------------------------------------------------------- */
/* Input schemas                                                               */
/* -------------------------------------------------------------------------- */

export const opportunityInputSchema = z.object({
  title: z.string().trim().min(3).max(160),
  company_id: z.string().uuid().nullable(),
  category_id: z.string().uuid().nullable(),
  summary: nullableText(12_000),
  responsibilities: stringList(),
  requirements: stringList(),
  skills: stringList(30, 80),
  preferred_skills: stringList(30, 80),
  education_requirements: stringList(10, 200),
  benefits: stringList(20, 200),
  languages: stringList(10, 60),
  recruiter_name: nullableText(160),
  location_text: nullableText(160),
  city: nullableText(100),
  country: nullableText(100),
  country_code: nullableText(2),
  work_mode: z.enum(WORK_MODES),
  employment_type: z.enum(EMPLOYMENT_TYPES),
  salary_min: z.number().min(0).max(1_000_000_000).nullable(),
  salary_max: z.number().min(0).max(1_000_000_000).nullable(),
  currency: z.string().trim().max(3).nullable(),
  salary_period: z.enum(SALARY_PERIODS),
  experience_min_years: z.number().min(0).max(60).nullable(),
  experience_max_years: z.number().min(0).max(60).nullable(),
  application_method: z.enum(APPLICATION_METHODS),
  application_url: nullableText(1000),
  recruitment_email: nullableText(254),
  careers_url: nullableText(1000),
  application_instructions: nullableText(1500),
  source_url: nullableText(1000),
  source_type: z.enum(SOURCE_TYPES).nullable(),
  deadline: nullableText(20),
  original_posted_at: nullableText(20),
  original_date_precision: z.enum(DATE_PRECISIONS),
  original_date_text: nullableText(200),
  verification_status: z.enum([
    'not_verified',
    'source_open',
    'source_closed',
    'uncertain',
    'needs_verification',
  ]),
  is_featured: z.boolean().default(false),
  admin_notes: nullableText(4000),
  company_name: nullableText(160),
  company_website: nullableText(300),
  company_careers_url: nullableText(1000),
});

export type OpportunityInput = z.infer<typeof opportunityInputSchema>;

export const captureInputSchema = z.object({
  source_url: z.string().trim().max(1000).nullable().optional(),
  raw_text: z.string().trim().min(40).max(60_000),
  source_type: z.enum(SOURCE_TYPES).default('linkedin_post'),
  company: z.string().trim().max(160).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const publicSubmissionSchema = z.object({
  source_url: z.string().trim().min(8).max(1000),
  role_title: z.string().trim().max(160).optional().nullable(),
  company: z.string().trim().max(160).optional().nullable(),
  details: z.string().trim().min(30).max(4000),
  honeypot: z.string().max(0).optional(),
  turnstile_token: z.string().max(4000).optional(),
});

export const reportSchema = z.object({
  opportunity_id: z.string().uuid(),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(1500).optional().nullable(),
  contact_email: z.string().trim().max(254).optional().nullable(),
  honeypot: z.string().max(0).optional(),
  turnstile_token: z.string().max(4000).optional(),
});

export const eventSchema = z.object({
  opportunity_id: z.string().uuid().nullable().optional(),
  event_type: z.enum(EVENT_TYPES),
  metadata: z.record(z.unknown()).optional(),
});

export const commentUpdateSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

export const commentStyleSchema = z.enum(COMMENT_STYLES);

export const categoryInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  is_active: z.boolean().default(true),
  is_featured: z.boolean().default(false),
  sort_order: z.number().int().min(0).max(999).default(100),
});

export const companyInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  website: z.string().trim().max(300).nullable().optional(),
  careers_url: z.string().trim().max(1000).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  logo_url: z.string().trim().max(1000).nullable().optional(),
  verified: z.boolean().default(false),
});

export const settingsSchema = z.object({
  verification_reminder_days: z.number().int().min(1).max(365),
  source_retention_days: z.number().int().min(7).max(3650),
  public_submissions_enabled: z.boolean(),
  reports_enabled: z.boolean(),
  ai_provider: z.enum(['gemini', 'groq', 'none']),
  default_currency: z.string().trim().min(2).max(3),
});

export const telegramConfigSchema = z.object({
  token: z.string().min(10),
  secret: z.string().min(8),
  adminIds: z.array(z.number().int().positive()).min(1),
});

export function isValidApplicationUrl(value: string | null | undefined): boolean {
  return isValidHttpUrl(value);
}

export function isValidRecruitmentEmail(value: string | null | undefined): boolean {
  return isSafeEmail(value);
}
