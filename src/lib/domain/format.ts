import type {
  EmploymentType,
  SalaryPeriod,
  WorkMode,
  ApplicationMethod,
  VerificationStatus,
  OpportunityStatus,
  DatePrecision,
} from './types';

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  onsite: 'On-site',
  hybrid: 'Hybrid',
  remote: 'Remote',
  unspecified: 'Not specified',
};

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
  temporary: 'Temporary',
  unspecified: 'Not specified',
};

export const SALARY_PERIOD_LABELS: Record<SalaryPeriod, string> = {
  annual: 'per year',
  monthly: 'per month',
  daily: 'per day',
  hourly: 'per hour',
  stipend: 'stipend',
  unspecified: '',
};

export const APPLICATION_METHOD_LABELS: Record<ApplicationMethod, string> = {
  external_url: 'External application',
  email: 'Email application',
  linkedin_post: 'LinkedIn post',
  careers_page: 'Company careers page',
  other: 'Other',
  none: 'Not specified',
};

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  not_verified: 'Not verified',
  source_open: 'Source checked — appears open',
  source_closed: 'Source checked — closed',
  uncertain: 'Uncertain',
  needs_verification: 'Verification needed',
};

export const STATUS_LABELS: Record<OpportunityStatus, string> = {
  draft: 'Draft',
  pending_review: 'Pending review',
  published: 'Published',
  closed: 'Closed',
  expired: 'Expired',
  rejected: 'Rejected',
  archived: 'Archived',
};

export const DATE_PRECISION_LABELS: Record<DatePrecision, string> = {
  exact: 'Exact date',
  month: 'Month only',
  year: 'Year only',
  unknown: 'Unknown',
};

export function formatSalary(
  min: number | null,
  max: number | null,
  currency: string | null,
  period: SalaryPeriod,
): string {
  if (min == null && max == null) return 'Not specified';
  const cur = (currency || '').toUpperCase();
  const symbol: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SGD: 'S$' };
  const prefix = symbol[cur] ?? (cur ? `${cur} ` : '');
  const fmt = (n: number) => {
    const abs = Math.abs(n);
    if (abs >= 10000000) return `${trimZero(n / 10000000)}Cr`;
    if (abs >= 100000) return `${trimZero(n / 100000)}L`;
    if (abs >= 10000) return `${trimZero(n / 1000)}K`;
    return n.toLocaleString('en-US');
  };
  const periodLabel = SALARY_PERIOD_LABELS[period];
  if (min != null && max != null) {
    if (min === max) return `${prefix}${fmt(min)} ${periodLabel}`.trim();
    return `${prefix}${fmt(min)} – ${prefix}${fmt(max)} ${periodLabel}`.trim();
  }
  const value = (min ?? max) as number;
  return `${min != null ? 'From ' : 'Up to '}${prefix}${fmt(value)} ${periodLabel}`.trim();
}

function trimZero(n: number): string {
  return Number(n.toFixed(1)).toString();
}

export function formatExperience(min: number | null, max: number | null): string {
  if (min == null && max == null) return 'Not specified';
  const yr = (n: number) => `${n} ${n === 1 ? 'year' : 'years'}`;
  if (min != null && max != null) {
    if (min === max) return `${yr(min)}`;
    return `${min}–${max} years`;
  }
  if (min != null) return `${min}+ years`;
  return `Up to ${yr(max as number)}`;
}

export function formatDate(value: string | null | undefined, opts?: { withYear?: boolean }): string {
  if (!value) return 'Not specified';
  const d = parseDateOnly(value) ?? new Date(value);
  if (!d || Number.isNaN(d.getTime())) return 'Not specified';
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(opts?.withYear === false ? {} : { year: 'numeric' }),
  });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Not specified';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Not specified';
  return `${formatDate(value)} · ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toDateOnly(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Difference in whole days between two instants (positive = past). */
export function daysAgo(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const t = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(t)) return null;
  return Math.floor((now - t) / 86_400_000);
}

export function relativeTime(value: string | null | undefined, now = Date.now()): string {
  const days = daysAgo(value, now);
  if (days == null) return 'Unknown';
  if (days < 0) return 'Scheduled';
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} ${Math.floor(days / 7) === 1 ? 'week' : 'weeks'} ago`;
  if (days < 365) return `${Math.floor(days / 30)} ${Math.floor(days / 30) === 1 ? 'month' : 'months'} ago`;
  return `${Math.floor(days / 365)} ${Math.floor(days / 365) === 1 ? 'year' : 'years'} ago`;
}

/**
 * Freshness is based on real timestamps only. We never label a listing
 * "posted today" because it was discovered today.
 */
export function freshness(o: {
  discovered_at: string;
  original_posted_at: string | null;
  published_at: string | null;
  last_verified_at: string | null;
  status: OpportunityStatus;
}): { tone: 'fresh' | 'recent' | 'stale' | 'closed'; label: string; detail: string } {
  if (o.status === 'closed' || o.status === 'expired' || o.status === 'archived') {
    return { tone: 'closed', label: 'No longer active', detail: 'This listing has been closed.' };
  }
  if (o.last_verified_at) {
    const days = daysAgo(o.last_verified_at) ?? 0;
    if (days <= 7) {
      return { tone: 'fresh', label: 'Recently verified', detail: `Source checked ${relativeTime(o.last_verified_at).toLowerCase()}.` };
    }
    if (days <= 30) {
      return { tone: 'recent', label: 'Verified this month', detail: `Source checked ${relativeTime(o.last_verified_at).toLowerCase()}.` };
    }
    return { tone: 'stale', label: 'Verification due', detail: `Last source check ${relativeTime(o.last_verified_at).toLowerCase()}.` };
  }
  const discoveredDays = daysAgo(o.discovered_at) ?? 0;
  if (discoveredDays <= 7) {
    return { tone: 'fresh', label: 'Newly discovered', detail: `Added ${relativeTime(o.discovered_at).toLowerCase()}.` };
  }
  if (discoveredDays <= 30) {
    return { tone: 'recent', label: 'Recent', detail: `Added ${relativeTime(o.discovered_at).toLowerCase()}.` };
  }
  return { tone: 'stale', label: 'Verify before applying', detail: `Added ${relativeTime(o.discovered_at).toLowerCase()}.` };
}

export function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).trim()}…`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : plural}`;
}

export function titleCaseEnum(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
