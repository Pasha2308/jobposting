import type { OpportunityWithRelations } from '../domain/types';
import { isPubliclyVisible } from '../page-data';
import { resolveCandidateRedirectRoute } from '../domain/validation';
import { isSafeEmail } from '../domain/url';
import type { Store } from '../store/types';
import { ServiceError } from './errors';

export const CANDIDATE_APPLY_CONSENT_VERSION = 'candidate-apply-2026-11';

export async function recordCandidateApplication(
  store: Store,
  jobCode: string,
  submittedEmail: string,
  consent: boolean,
  now = new Date(),
): Promise<{ redirectTo: string; opportunity: OpportunityWithRelations }> {
  const opportunity = await store.getOpportunityByJobCode(jobCode);
  if (!opportunity || !isPubliclyVisible(opportunity) || opportunity.status !== 'published' || opportunity.closed_at) {
    throw new ServiceError('job_unavailable', 'This job is no longer accepting applications.', 404);
  }
  if (!consent) throw new ServiceError('consent_required', 'Please agree before continuing.', 400);

  const email = submittedEmail.trim().toLowerCase();
  if (!isSafeEmail(email)) throw new ServiceError('invalid_email', 'Enter a valid email address.', 400);

  const route = resolveCandidateRedirectRoute(opportunity);
  if (!route) throw new ServiceError('application_unavailable', 'This job has no usable application route.', 409);

  await store.recordCandidateApplication({
    opportunity_id: opportunity.id,
    email,
    email_normalized: email,
    consented_at: now.toISOString(),
    consent_text_version: CANDIDATE_APPLY_CONSENT_VERSION,
  });

  return { redirectTo: route.href, opportunity };
}
