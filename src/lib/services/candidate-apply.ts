import type { OpportunityWithRelations } from '../domain/types';
import { isPubliclyVisible } from '../page-data';
import { resolveCandidateRedirectRoute } from '../domain/validation';
import { isSafeEmail } from '../domain/url';
import type { AppEnv } from '../env';
import type { Store } from '../store/types';
import { ServiceError } from './errors';

export const CANDIDATE_APPLY_CONSENT_VERSION = 'candidate-apply-2026-11-otp';
async function otpHash(secret: string, email: string, code: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${email}:${code}`));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getAvailableOpportunity(opportunity: OpportunityWithRelations | null) {
  if (!opportunity || !isPubliclyVisible(opportunity) || opportunity.status !== 'published' || opportunity.closed_at) {
    throw new ServiceError('job_unavailable', 'This job is no longer accepting applications.', 404);
  }
  const route = resolveCandidateRedirectRoute(opportunity);
  if (!route) throw new ServiceError('application_unavailable', 'This job has no usable application route.', 409);
  return route;
}

export function candidateOtpConfigured(env: AppEnv): boolean {
  return Boolean(env.candidateEmailResendApiKey && env.candidateEmailFrom && env.candidateEmailOtpSecret && env.candidateEmailOtpSecret.length >= 32);
}

export async function startCandidateEmailVerification(
  store: Store,
  env: AppEnv,
  jobCode: string,
  submittedEmail: string,
  consent: boolean,
  ip: string,
  now = new Date(),
): Promise<void> {
  if (!candidateOtpConfigured(env)) throw new ServiceError('email_verification_unavailable', 'Email verification is temporarily unavailable. Please try again later.', 503);
  const opportunity = await store.getOpportunityByJobCode(jobCode);
  getAvailableOpportunity(opportunity);
  if (!consent) throw new ServiceError('consent_required', 'Please agree before continuing.', 400);
  const email = submittedEmail.trim().toLowerCase();
  if (!isSafeEmail(email)) throw new ServiceError('invalid_email', 'Enter a valid email address.', 400);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, '0');
  const codeHash = await otpHash(env.candidateEmailOtpSecret!, email, code);
  const emailHash = await otpHash(env.candidateEmailOtpSecret!, 'email', email);
  const ipHash = await otpHash(env.candidateEmailOtpSecret!, 'ip', ip || 'unknown');
  const result = await store.requestCandidateEmailOtp({
    email_hash: emailHash,
    opportunity_id: opportunity!.id,
    code_hash: codeHash,
    consented_at: now.toISOString(),
    ip_hash: ipHash,
    now: now.toISOString(),
  });
  if (!result.allowed) throw new ServiceError('otp_rate_limited', 'Too many verification requests. Please wait before trying again.', 429);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.candidateEmailResendApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.candidateEmailFrom,
      to: [email],
      subject: 'Your Hustler Community verification code',
      text: `Your verification code is ${code}. It expires in 10 minutes. Enter it on Hustler Community to verify your email and continue to the job application. If you did not request this, you can ignore this email.`,
    }),
  });
  if (!response.ok) throw new ServiceError('email_delivery_failed', 'We could not send the verification email. Please try again later.', 502);
}

export async function completeCandidateEmailVerification(
  store: Store,
  env: AppEnv,
  jobCode: string,
  submittedEmail: string,
  submittedCode: string,
  now = new Date(),
): Promise<{ redirectTo: string; opportunity: OpportunityWithRelations }> {
  if (!env.candidateEmailOtpSecret) throw new ServiceError('email_verification_unavailable', 'Email verification is temporarily unavailable.', 503);
  const opportunity = await store.getOpportunityByJobCode(jobCode);
  const route = getAvailableOpportunity(opportunity);
  const email = submittedEmail.trim().toLowerCase();
  if (!isSafeEmail(email)) throw new ServiceError('invalid_email', 'Enter a valid email address.', 400);
  if (!/^\d{6}$/.test(submittedCode)) throw new ServiceError('invalid_code', 'Enter the six-digit code from your email.', 400);
  const result = await store.verifyCandidateEmailOtp({
    email,
    email_hash: await otpHash(env.candidateEmailOtpSecret, 'email', email),
    code_hash: await otpHash(env.candidateEmailOtpSecret, email, submittedCode),
    now: now.toISOString(),
    consent_text_version: CANDIDATE_APPLY_CONSENT_VERSION,
  });
  if (!result.verified) {
    const messages: Record<string, string> = {
      expired: 'That code has expired. Request a new one.',
      attempts: 'Too many incorrect codes. Request a new one.',
      invalid: 'That code does not match. Check it and try again.',
      missing: 'Request a verification code first.',
    };
    throw new ServiceError('verification_failed', messages[result.reason ?? 'invalid'] ?? messages.invalid!, 400);
  }
  return { redirectTo: route.href, opportunity: opportunity! };
}
