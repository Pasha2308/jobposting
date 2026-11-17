/**
 * Deterministic completeness scoring. The AI never produces this number: it is
 * derived from the persisted fields so two reviewers see the same score, and a
 * missing value is never hidden behind a confident-looking AI response.
 */

export type CompletenessInput = {
  title?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  summary?: string | null;
  responsibilities?: string[] | null;
  requirements?: string[] | null;
  skills?: string[] | null;
  location_text?: string | null;
  city?: string | null;
  country?: string | null;
  work_mode?: string | null;
  employment_type?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  experience_min_years?: number | null;
  experience_max_years?: number | null;
  application_method?: string | null;
  application_url?: string | null;
  recruitment_email?: string | null;
  deadline?: string | null;
  education_requirements?: string[] | null;
  confidence?: number | null;
};

const WEIGHTS = {
  title: 0.12,
  company: 0.08,
  description: 0.12,
  responsibilities: 0.07,
  requirements: 0.07,
  skills: 0.08,
  location: 0.08,
  work_mode: 0.05,
  employment_type: 0.03,
  salary: 0.08,
  experience: 0.07,
  application: 0.1,
  deadline: 0.03,
  education: 0.02,
} as const;

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasList(value: string[] | null | undefined): boolean {
  return Array.isArray(value) && value.some((item) => hasText(String(item)));
}

export function computeCompleteness(
  input: CompletenessInput,
  opts: { hasApplicationRoute?: boolean } = {},
): { score: number; flags: string[] } {
  const flags: string[] = [];
  let score = 0;

  if (hasText(input.title)) score += WEIGHTS.title;
  else flags.push('missing_title');

  if (input.company_id || hasText(input.company_name)) score += WEIGHTS.company;
  else flags.push('missing_company');

  if (hasText(input.summary)) score += WEIGHTS.description;
  else flags.push('no_description');

  if (hasList(input.responsibilities)) score += WEIGHTS.responsibilities;
  else flags.push('missing_responsibilities');

  if (hasList(input.requirements)) score += WEIGHTS.requirements;
  else flags.push('missing_requirements');

  if (hasList(input.skills)) score += WEIGHTS.skills;
  else flags.push('missing_skills');

  if (hasText(input.location_text) || hasText(input.city) || hasText(input.country)) score += WEIGHTS.location;
  else flags.push('missing_location');

  if (input.work_mode && input.work_mode !== 'unspecified') score += WEIGHTS.work_mode;
  else flags.push('unspecified_work_mode');

  if (input.employment_type && input.employment_type !== 'unspecified') score += WEIGHTS.employment_type;

  if (input.salary_min != null || input.salary_max != null) score += WEIGHTS.salary;
  else flags.push('missing_salary');

  if (input.experience_min_years != null || input.experience_max_years != null) score += WEIGHTS.experience;
  else flags.push('missing_experience');

  const applicationRoute =
    opts.hasApplicationRoute ??
    (hasText(input.application_url) ||
      hasText(input.recruitment_email) ||
      (input.application_method != null && !['none', 'careers_page'].includes(input.application_method)));
  if (applicationRoute) score += WEIGHTS.application;
  else flags.push('missing_application_route');

  if (hasText(input.deadline)) score += WEIGHTS.deadline;
  else flags.push('missing_deadline');

  if (hasList(input.education_requirements)) score += WEIGHTS.education;
  else flags.push('missing_education');

  if (input.confidence != null && input.confidence < 0.6) flags.push('low_confidence');

  return {
    score: Math.round(Math.min(1, Math.max(0, score)) * 1000) / 1000,
    flags,
  };
}
