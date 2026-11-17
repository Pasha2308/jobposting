import { describe, expect, it } from 'vitest';
import type { OpportunityDraft } from '../../src/lib/domain/types';
import {
  normalizeIsoDate,
  resolveApplicationRoutes,
  validateExtraction,
  validateForPublication,
} from '../../src/lib/domain/validation';

function draft(overrides: Partial<OpportunityDraft> = {}): OpportunityDraft {
  return {
    slug: 'founding-full-stack-engineer-acme-labs',
    title: 'Founding Full Stack Engineer',
    company_id: '11111111-1111-4111-8111-111111111111',
    category_id: '22222222-2222-4222-8222-222222222222',
    summary:
      'Acme Labs is hiring a founding full stack engineer to own the TypeScript product and work directly with the founders.',
    responsibilities: [],
    requirements: [],
    skills: [],
    preferred_skills: [],
    education_requirements: [],
    benefits: [],
    languages: [],
    recruiter_name: null,
    location_text: 'Bengaluru, India',
    city: 'Bengaluru',
    country: 'India',
    country_code: 'IN',
    work_mode: 'hybrid',
    employment_type: 'full_time',
    salary_min: null,
    salary_max: null,
    currency: null,
    salary_period: 'unspecified',
    experience_min_years: null,
    experience_max_years: null,
    application_method: 'external_url',
    application_url: 'https://acme.test/careers/founding-engineer',
    recruitment_email: null,
    careers_url: 'https://acme.test/careers',
    application_instructions: null,
    source_url: 'https://www.linkedin.com/posts/acme_founder-1234567890',
    source_type: 'linkedin_post',
    source_capture_id: null,
    canonical_source_key: 'linkedin:1234567890',
    deadline: null,
    original_posted_at: null,
    original_date_precision: 'unknown',
    original_date_text: null,
    status: 'pending_review',
    verification_status: 'source_open',
    last_verified_at: null,
    is_featured: false,
    quality_flags: [],
    completeness_score: null,
    admin_notes: null,
    created_by: 'test',
    opening_key: 1,
    publication_number: null,
    ...overrides,
  };
}

const baseExtraction = {
  is_genuine_opportunity: true,
  genuine_opportunity_reason: null,
  job_title: 'Founding Engineer',
  company_name: 'Acme Labs',
  company_website: 'https://acme.test',
  category_slug: 'engineering',
  summary: 'A factual summary from the source.',
  responsibilities: ['Own the product'],
  requirements: ['TypeScript'],
  required_skills: ['TypeScript'],
  preferred_skills: [],
  location: 'Remote, India',
  city: null,
  country: 'India',
  work_mode: 'remote',
  employment_type: 'full_time',
  salary_min: 90000,
  salary_max: 120000,
  currency: 'usd',
  salary_period: 'annual',
  experience_min_years: 2,
  experience_max_years: 5,
  application_method: 'external_url',
  recruitment_email: 'jobs@acme.test',
  application_url: 'https://acme.test/careers',
  application_instructions: 'Apply on the careers page.',
  deadline: '2026-12-31',
  original_posted_date: '2026-01-02',
  original_date_precision: 'exact',
  original_date_text: null,
  confidence: 0.9,
  warnings: [],
};

describe('validateExtraction', () => {
  it('accepts a well-formed extraction and normalises fields', () => {
    const result = validateExtraction(baseExtraction);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.currency).toBe('USD');
    expect(result.value.application_url).toBe('https://acme.test/careers');
    expect(result.value.recruitment_email).toBe('jobs@acme.test');
    expect(result.value.deadline).toBe('2026-12-31');
  });

  it('orders a reversed salary range and records a warning', () => {
    const result = validateExtraction({ ...baseExtraction, salary_min: 120000, salary_max: 90000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.salary_min).toBe(90000);
    expect(result.value.salary_max).toBe(120000);
    expect(result.value.warnings.join(' ')).toMatch(/reversed/i);
  });

  it('turns unsafe URLs and emails into nulls instead of guessing', () => {
    const result = validateExtraction({
      ...baseExtraction,
      application_url: 'javascript:alert(1)',
      company_website: 'not a url',
      recruitment_email: 'not-an-email',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.application_url).toBeNull();
    expect(result.value.company_website).toBeNull();
    expect(result.value.recruitment_email).toBeNull();
  });

  it('tolerates null arrays and fills them with empty lists', () => {
    const result = validateExtraction({
      ...baseExtraction,
      responsibilities: null,
      requirements: null,
      required_skills: null,
      preferred_skills: null,
      warnings: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.responsibilities).toEqual([]);
    expect(result.value.warnings).toEqual([]);
  });

  it('normalises near-miss enum values instead of discarding the extraction', () => {
    const result = validateExtraction({
      ...baseExtraction,
      work_mode: 'On-Site',
      employment_type: 'fulltime',
      salary_period: 'LPA',
      application_method: 'Apply Link',
      original_date_precision: 'day',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.work_mode).toBe('onsite');
    expect(result.value.employment_type).toBe('full_time');
    expect(result.value.salary_period).toBe('annual');
    expect(result.value.application_method).toBe('external_url');
    expect(result.value.original_date_precision).toBe('exact');
  });

  it('downgrades genuinely unknown enum values to safe defaults', () => {
    const result = validateExtraction({
      ...baseExtraction,
      work_mode: 'teleport',
      employment_type: 'freelance-ish',
      salary_period: 'whenever',
      application_method: 'carrier_pigeon',
      original_date_precision: 'century',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.work_mode).toBe('unspecified');
    expect(result.value.employment_type).toBe('unspecified');
    expect(result.value.salary_period).toBe('unspecified');
    expect(result.value.application_method).toBe('none');
    expect(result.value.original_date_precision).toBe('unknown');
  });

  it('still rejects a missing required boolean and a non-object payload', () => {
    expect(validateExtraction({ ...baseExtraction, is_genuine_opportunity: 'yes' }).ok).toBe(false);
    expect(validateExtraction({ nonsense: true }).ok).toBe(false);
  });
});

describe('resolveApplicationRoutes', () => {
  it('returns a usable external URL route', () => {
    const result = resolveApplicationRoutes(draft());
    expect(result.usable).toBe(true);
    expect(result.routes.some((route) => route.method === 'external_url')).toBe(true);
  });

  it('blocks an external URL method with no valid URL', () => {
    const result = resolveApplicationRoutes(
      draft({
        application_url: null,
        careers_url: null,
        recruitment_email: null,
        source_url: null,
        application_instructions: null,
      }),
    );
    expect(result.usable).toBe(false);
    expect(result.blocking.join(' ')).toMatch(/external URL/i);
  });

  it('supports a recruitment email route', () => {
    const result = resolveApplicationRoutes(
      draft({ application_method: 'email', application_url: null, recruitment_email: 'jobs@acme.test', careers_url: null }),
    );
    expect(result.usable).toBe(true);
    expect(result.routes[0].href).toBe('mailto:jobs@acme.test');
  });

  it('requires reviewed instructions for a LinkedIn application route', () => {
    const blocked = resolveApplicationRoutes(
      draft({
        application_method: 'linkedin_post',
        application_url: null,
        careers_url: null,
        application_instructions: null,
      }),
    );
    expect(blocked.usable).toBe(false);
    expect(blocked.blocking.join(' ')).toMatch(/application instructions/i);

    const allowed = resolveApplicationRoutes(
      draft({
        application_method: 'linkedin_post',
        application_url: null,
        careers_url: null,
        application_instructions: 'Comment "interested" on the original post and the founder will reply.',
      }),
    );
    expect(allowed.usable).toBe(true);
    expect(allowed.routes.some((route) => route.method === 'linkedin_post')).toBe(true);
  });

  it('blocks when no route is usable', () => {
    const result = resolveApplicationRoutes(
      draft({
        application_method: 'none',
        application_url: null,
        careers_url: null,
        recruitment_email: null,
        source_url: null,
      }),
    );
    expect(result.usable).toBe(false);
    expect(result.blocking.join(' ')).toMatch(/No usable application route/i);
  });
});

describe('validateForPublication', () => {
  it('passes a complete record with a usable route', () => {
    const result = validateForPublication(draft(), 'Acme Labs', 'Engineering');
    expect(result.ok).toBe(true);
    expect(result.routes.length).toBeGreaterThan(0);
  });

  it('blocks missing company, category, summary and location', () => {
    const result = validateForPublication(
      draft({ summary: 'Too short', location_text: null, country: null }),
      null,
      null,
    );
    expect(result.ok).toBe(false);
    expect(result.blocking.join(' ')).toMatch(/company/i);
    expect(result.blocking.join(' ')).toMatch(/category/i);
    expect(result.blocking.join(' ')).toMatch(/summary/i);
    expect(result.blocking.join(' ')).toMatch(/location/i);
  });

  it('blocks an already-passed deadline', () => {
    const result = validateForPublication(draft({ deadline: '2020-01-01' }), 'Acme Labs', 'Engineering');
    expect(result.ok).toBe(false);
    expect(result.blocking.join(' ')).toMatch(/deadline/i);
  });

  it('blocks an implausible future posting date', () => {
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const result = validateForPublication(draft({ original_posted_at: future }), 'Acme Labs', 'Engineering');
    expect(result.ok).toBe(false);
    expect(result.blocking.join(' ')).toMatch(/future/i);
  });

  it('warns rather than blocks when optional facts are absent', () => {
    const result = validateForPublication(draft(), 'Acme Labs', 'Engineering');
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.join(' ')).toMatch(/not been verified/i);
  });
});

describe('normalizeIsoDate', () => {
  it('keeps ISO dates and parses full timestamps', () => {
    expect(normalizeIsoDate('2026-02-01')).toBe('2026-02-01');
    expect(normalizeIsoDate('2026-02-01T15:00:00Z')).toBe('2026-02-01');
  });

  it('rejects impossible or out-of-range values', () => {
    expect(normalizeIsoDate('not a date')).toBeNull();
    expect(normalizeIsoDate('1999-01-01')).toBeNull();
    expect(normalizeIsoDate('')).toBeNull();
    expect(normalizeIsoDate(null)).toBeNull();
  });
});
