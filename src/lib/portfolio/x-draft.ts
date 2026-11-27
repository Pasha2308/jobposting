import type { OpportunityWithRelations } from '../domain/types';
import { excerpt, plainText } from '../domain/text';

/** Compact, factual X copy. Deterministic generation costs no AI quota. */
export function buildXDraft(opportunity: OpportunityWithRelations, publicUrl: string): string {
  const company = opportunity.company?.name ? ` at ${opportunity.company.name}` : '';
  const facts = [
    opportunity.location_text,
    opportunity.work_mode !== 'unspecified' ? opportunity.work_mode : null,
    opportunity.experience_min_years != null ? `${opportunity.experience_min_years}+ yrs` : null,
  ].filter(Boolean).join(' · ');
  const skills = opportunity.skills.length ? `\nSkills: ${opportunity.skills.slice(0, 3).join(', ')}` : '';
  const suffix = `\n\nDetails & apply 👇\n${publicUrl}\n#Hiring #Jobs`;
  const available = Math.max(30, 280 - suffix.length);
  const body = excerpt(`🚨 Hiring: ${opportunity.title}${company}${facts ? `\n${facts}` : ''}${skills}`, available);
  return plainText(`${body}${suffix}`, 280);
}
