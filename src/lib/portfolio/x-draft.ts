import type { OpportunityWithRelations } from '../domain/types';
import { excerpt, plainText } from '../domain/text';

/** Compact, factual X copy. Deterministic generation costs no AI quota. */
export function buildXDraft(opportunity: OpportunityWithRelations, publicUrl: string): string {
  const company = opportunity.company?.name ? ` at ${opportunity.company.name}` : '';
  const place = opportunity.location_text ? ` · ${opportunity.location_text}` : '';
  const summary = opportunity.summary ? `\n${excerpt(opportunity.summary, 120)}` : '';
  return plainText(`Hiring: ${opportunity.title}${company}${place}${summary}\n\nApply: ${publicUrl}\n\n#Hiring #StartupJobs`, 275);
}
