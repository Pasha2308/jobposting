import type { OpportunityWithRelations } from '../domain/types';
import { excerpt, plainText } from '../domain/text';

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
    `🔎 LOOKING FOR A ${opportunity.title.toUpperCase()} ROLE?`,
    `${opportunity.company?.name ?? 'A growing team'} IS HIRING: ${opportunity.title}`,
    '',
    'Here are the details:',
    opportunity.location_text ? `📍 Location: ${opportunity.location_text}` : null,
    opportunity.work_mode !== 'unspecified' ? `🏢 Work mode: ${opportunity.work_mode}` : null,
    opportunity.employment_type !== 'unspecified' ? `💼 Employment: ${opportunity.employment_type.replace('_', ' ')}` : null,
    experience ? `🧭 Experience: ${experience}` : null,
    opportunity.salary_min != null || opportunity.salary_max != null
      ? `💰 Compensation: ${opportunity.salary_min ?? ''}${opportunity.salary_max != null ? `–${opportunity.salary_max}` : ''}${opportunity.currency ? ` ${opportunity.currency}` : ''}${opportunity.salary_period !== 'unspecified' ? ` / ${opportunity.salary_period}` : ''}`
      : null,
    '',
    opportunity.summary ? `About the role:\n${excerpt(opportunity.summary, 520)}` : null,
    opportunity.responsibilities.length ? `\nWhat you'll work on:\n${opportunity.responsibilities.slice(0, 3).map((item) => `• ${excerpt(item, 160)}`).join('\n')}` : null,
    opportunity.requirements.length ? `\nWhat they're looking for:\n${opportunity.requirements.slice(0, 3).map((item) => `• ${excerpt(item, 150)}`).join('\n')}` : null,
    opportunity.skills.length ? `\nKey skills: ${opportunity.skills.slice(0, 6).map((skill) => excerpt(skill, 40)).join(' · ')}` : null,
    '',
    'Interested? See the full details and apply here 👇',
    publicUrl,
    '',
    'Know someone who fits? Share this with them.',
    '',
    '#Hiring #Jobs #CareerOpportunity #StartupJobs',
  ].filter((line): line is string => line !== null);
  return plainText(lines.join('\n'), 2_950);
}
