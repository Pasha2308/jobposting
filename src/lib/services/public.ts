import { eventSchema, publicSubmissionSchema, reportSchema } from '../domain/validation';
import { canonicalSourceKey, extractLinkedInPostId, normalizeEmail, normalizeSourceUrl } from '../domain/url';
import type { Store } from '../store/types';
import type { EventType, OpportunityWithRelations } from '../domain/types';
import { ServiceError } from './errors';
import { textSourceKey } from './capture';
import { transitionOpportunity } from './publishing';

/** Public suggestion. Always lands in the admin review queue; never publishes. */
export async function createPublicSubmission(
  store: Store,
  rawInput: unknown,
  actor = 'public',
): Promise<{ captureId: string }> {
  const parsed = publicSubmissionSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError('invalid_input', 'Please check the submitted details.', 422, {
      issues: parsed.error.issues.map((i) => i.message),
    });
  }
  const sourceUrl = normalizeSourceUrl(parsed.data.source_url);
  if (!sourceUrl) throw new ServiceError('invalid_url', 'Please provide a valid public URL.', 422);

  const postId = extractLinkedInPostId(sourceUrl);
  const key = canonicalSourceKey(sourceUrl, postId) ?? (await textSourceKey(parsed.data.details));

  const existingOpportunity = await store.findOpportunityBySourceKey(key);
  if (existingOpportunity) {
    throw new ServiceError('duplicate', 'This opportunity is already listed.', 409, {
      slug: existingOpportunity.slug,
    });
  }
  const existingCapture = await store.getCaptureBySourceKey(key);
  if (existingCapture && !['rejected', 'extraction_failed'].includes(existingCapture.status)) {
    throw new ServiceError('duplicate', 'This opportunity has already been submitted for review.', 409);
  }

  const rawText = [
    parsed.data.role_title ? `Suggested role: ${parsed.data.role_title}` : '',
    parsed.data.company ? `Suggested company: ${parsed.data.company}` : '',
    parsed.data.details,
  ]
    .filter(Boolean)
    .join('\n\n');

  const capture = await store.createCapture({
    source_url: sourceUrl,
    normalized_source_key: key,
    source_post_id: postId,
    source_type: 'public_submission',
    raw_text: rawText,
    submitted_company: parsed.data.company ?? null,
    notes: 'Submitted through the public suggestion form. Review the original source before extracting.',
    created_by: actor,
  });

  await store.logActivity({
    actor,
    action: 'public.submission_received',
    entity_type: 'source_capture',
    entity_id: capture.id,
    metadata: { source: sourceUrl },
  });

  return { captureId: capture.id };
}

export async function createPublicReport(store: Store, rawInput: unknown): Promise<{ reportId: string }> {
  const parsed = reportSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError('invalid_input', 'Please check the report details.', 422, {
      issues: parsed.error.issues.map((i) => i.message),
    });
  }
  const opportunity = await store.getOpportunityById(parsed.data.opportunity_id);
  if (!opportunity) throw new ServiceError('not_found', 'That listing could not be found.', 404);

  const contactEmail = parsed.data.contact_email ? normalizeEmail(parsed.data.contact_email) : null;
  if (parsed.data.contact_email && !contactEmail) {
    throw new ServiceError('invalid_input', 'Please provide a valid email address or leave it blank.', 422);
  }

  const report = await store.createReport({
    opportunity_id: opportunity.id,
    reason: parsed.data.reason,
    details: parsed.data.details ?? null,
    contact_email: contactEmail,
  });

  await store.logActivity({
    actor: 'public',
    action: 'report.created',
    entity_type: 'report',
    entity_id: report.id,
    metadata: { opportunity_id: opportunity.id, reason: report.reason },
  });

  return { reportId: report.id };
}

const PUBLIC_EVENT_TYPES: EventType[] = ['view', 'apply_click', 'email_click', 'source_click', 'careers_click', 'share', 'search'];

/**
 * Records anonymous aggregate events. Never stores IPs, user agents or
 * candidate identities, and never labels an outbound click as an application.
 */
export async function trackPublicEvent(
  store: Store,
  rawInput: unknown,
): Promise<{ recorded: boolean }> {
  const parsed = eventSchema.safeParse(rawInput);
  if (!parsed.success) throw new ServiceError('invalid_event', 'Unknown event.', 422);
  const eventType = parsed.data.event_type;
  if (!PUBLIC_EVENT_TYPES.includes(eventType)) throw new ServiceError('invalid_event', 'Unknown event.', 422);

  const metadata: Record<string, unknown> = {};
  if (eventType === 'search') {
    const rawQuery = String(parsed.data.metadata?.query ?? '').slice(0, 120).trim();
    if (!rawQuery) return { recorded: false };
    metadata.query = rawQuery;
  }
  if (eventType === 'share') {
    const channel = String(parsed.data.metadata?.channel ?? '').slice(0, 20);
    if (channel) metadata.channel = channel;
  }

  let opportunity: OpportunityWithRelations | null = null;
  if (parsed.data.opportunity_id) {
    opportunity = await store.getOpportunityById(parsed.data.opportunity_id);
    if (!opportunity) return { recorded: false };
    const isActive = opportunity.status === 'published' && !opportunity.closed_at;
    if (!isActive) return { recorded: false };
    if (opportunity.deadline) {
      const deadline = Date.parse(`${opportunity.deadline}T23:59:59Z`);
      if (Number.isFinite(deadline) && deadline < Date.now()) return { recorded: false };
    }
  } else if (!['search', 'share'].includes(eventType)) {
    // Views and application clicks must always reference a real listing.
    return { recorded: false };
  }

  await store.recordEvents([
    {
      opportunity_id: opportunity?.id ?? null,
      event_type: eventType,
      metadata: Object.keys(metadata).length ? metadata : null,
    },
  ]);
  return { recorded: true };
}

export type ReportResolutionAction = 'dismiss' | 'resolve' | 'close_job';

export async function resolveReport(
  store: Store,
  reportId: string,
  action: ReportResolutionAction,
  opts: { actor: string; siteUrl: string; note?: string },
): Promise<{ reportId: string; opportunityClosed: boolean }> {
  const report = await store.getReport(reportId);
  if (!report) throw new ServiceError('not_found', 'Report not found.', 404);
  if (report.status === 'resolved' || report.status === 'dismissed') {
    throw new ServiceError('already_resolved', 'This report has already been resolved.', 409);
  }

  let opportunityClosed = false;
  if (action === 'close_job') {
    const opportunity = await store.getOpportunityById(report.opportunity_id);
    if (!opportunity) throw new ServiceError('not_found', 'The reported listing no longer exists.', 404);
    if (opportunity.status === 'published') {
      await transitionOpportunity(store, opportunity.id, 'close', opts.actor, opts.siteUrl);
      opportunityClosed = true;
    }
  }

  const status = action === 'dismiss' ? 'dismissed' : 'resolved';
  await store.updateReport(reportId, {
    status,
    resolution_note: opts.note?.slice(0, 1000) ?? null,
    resolved_at: new Date().toISOString(),
  });

  await store.logActivity({
    actor: opts.actor,
    action: `report.${action}`,
    entity_type: 'report',
    entity_id: reportId,
    metadata: { opportunity_id: report.opportunity_id, opportunityClosed },
  });

  return { reportId, opportunityClosed };
}

export async function markReportReviewing(store: Store, reportId: string, actor: string): Promise<void> {
  const report = await store.getReport(reportId);
  if (!report) throw new ServiceError('not_found', 'Report not found.', 404);
  if (report.status === 'open') {
    await store.updateReport(reportId, { status: 'reviewing' });
    await store.logActivity({
      actor,
      action: 'report.reviewing',
      entity_type: 'report',
      entity_id: reportId,
    });
  }
}
