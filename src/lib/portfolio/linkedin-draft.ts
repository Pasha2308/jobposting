import type { OpportunityWithRelations } from '../domain/types';

/** Build a factual copy draft only from fields that survived admin review. */
export function buildLinkedInDraft(opportunity: OpportunityWithRelations, publicUrl: string): string {
  const experience = opportunity.experience_min_years != null && opportunity.experience_max_years != null
    ? `${opportunity.experience_min_years}–${opportunity.experience_max_years} years`
    : opportunity.experience_min_years != null
      ? `${opportunity.experience_min_years}+ years`
      : opportunity.experience_max_years != null
        ? `Up to ${opportunity.experience_max_years} years`
        : null;
  const lines = [
    `We're hiring: ${opportunity.title}${opportunity.company?.name ? ` at ${opportunity.company.name}` : ''}`,
    opportunity.location_text ? `Location: ${opportunity.location_text}${opportunity.work_mode !== 'unspecified' ? ` (${opportunity.work_mode})` : ''}` : null,
    experience ? `Experience: ${experience}` : null,
    opportunity.summary,
    opportunity.responsibilities.length ? `Responsibilities:\n${opportunity.responsibilities.slice(0, 5).map((item) => `• ${item}`).join('\n')}` : null,
    opportunity.requirements.length ? `Qualifications:\n${opportunity.requirements.slice(0, 6).map((item) => `• ${item}`).join('\n')}` : null,
    opportunity.salary_min != null || opportunity.salary_max != null
      ? `Salary: ${opportunity.salary_min ?? 'Not specified'}${opportunity.salary_max != null ? `–${opportunity.salary_max}` : ''}${opportunity.currency ? ` ${opportunity.currency}` : ''}${opportunity.salary_period !== 'unspecified' ? ` ${opportunity.salary_period}` : ''}`
      : null,
    opportunity.application_instructions ? `Application: ${opportunity.application_instructions}` : null,
    '',
    'Review the opportunity and apply through the Apply Now button on Hustler Community:',
    publicUrl,
    '',
    '#Hiring #StartupJobs #Careers',
  ].filter((line): line is string => Boolean(line?.trim()));
  // Telegram has a 4096 character limit. Leave room for the title and URL wrapper.
  return lines.join('\n').slice(0, 3600);
}
