import type { OpportunityStatus } from './types';

/**
 * Status is only ever changed through this table. The same table is enforced
 * by the `opportunities_enforce_transition` database trigger, so a bug in one
 * interface cannot bypass lifecycle rules.
 */
export const LIFECYCLE_TRANSITIONS: Record<OpportunityStatus, OpportunityStatus[]> = {
  draft: ['pending_review', 'published', 'rejected', 'archived'],
  pending_review: ['draft', 'published', 'rejected', 'archived'],
  published: ['closed', 'expired', 'archived'],
  closed: ['published', 'archived'],
  expired: ['published', 'closed', 'archived'],
  rejected: ['draft', 'pending_review', 'archived'],
  archived: ['draft'],
};

export type LifecycleAction =
  | 'submit_for_review'
  | 'approve'
  | 'publish'
  | 'close'
  | 'expire'
  | 'reopen'
  | 'reject'
  | 'archive'
  | 'restore';

const ACTION_TARGET: Record<LifecycleAction, OpportunityStatus> = {
  submit_for_review: 'pending_review',
  approve: 'pending_review',
  publish: 'published',
  close: 'closed',
  expire: 'expired',
  reopen: 'published',
  reject: 'rejected',
  archive: 'archived',
  restore: 'draft',
};

export function targetStatusFor(action: LifecycleAction): OpportunityStatus {
  return ACTION_TARGET[action];
}

const ACTION_ALLOWED_FROM: Record<LifecycleAction, OpportunityStatus[]> = {
  submit_for_review: ['draft', 'rejected'],
  approve: ['draft', 'pending_review', 'rejected'],
  publish: ['draft', 'pending_review', 'closed', 'expired'],
  close: ['published', 'expired'],
  expire: ['published'],
  reopen: ['closed', 'expired'],
  reject: ['draft', 'pending_review', 'rejected'],
  archive: ['draft', 'pending_review', 'published', 'closed', 'expired', 'rejected'],
  restore: ['archived'],
};

export type TransitionCheck = { ok: true; next: OpportunityStatus } | { ok: false; reason: string };

export function checkTransition(current: OpportunityStatus, action: LifecycleAction): TransitionCheck {
  const from = ACTION_ALLOWED_FROM[action];
  if (!from.includes(current)) {
    return {
      ok: false,
      reason: `Cannot ${action.replace(/_/g, ' ')} an opportunity that is currently ${current.replace(/_/g, ' ')}.`,
    };
  }
  const next = ACTION_TARGET[action];
  if (current !== next && !LIFECYCLE_TRANSITIONS[current].includes(next)) {
    return { ok: false, reason: `Lifecycle does not allow ${current} → ${next}.` };
  }
  return { ok: true, next };
}

/**
 * Public visibility is deliberately stricter than "is it published": an
 * opportunity must also be scheduled in the past/future correctly and not
 * have been manually closed.
 */
export function isPubliclyVisible(o: {
  status: OpportunityStatus;
  published_at: string | null;
  deadline?: string | null;
  closed_at?: string | null;
}): boolean {
  if (o.status !== 'published' || o.closed_at) return false;
  if (!o.published_at) return false;
  if (o.published_at && Date.parse(o.published_at) > Date.now()) return false;
  if (o.deadline && /^\d{4}-\d{2}-\d{2}$/.test(o.deadline)) {
    const endOfDeadline = Date.parse(`${o.deadline}T23:59:59.999Z`);
    if (Number.isFinite(endOfDeadline) && endOfDeadline < Date.now()) return false;
  }
  return true;
}

export function isExpired(deadline: string | null, now = new Date()): boolean {
  if (!deadline) return false;
  const parsed = Date.parse(`${deadline}T23:59:59.999Z`);
  return Number.isFinite(parsed) && parsed < now.getTime();
}
