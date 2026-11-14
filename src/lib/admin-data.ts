import type { AppEnv } from './env';
import type {
  ActivityLog,
  AdminStatistics,
  AnalyticsSummary,
  AppSettings,
  Category,
  CategoryWithCount,
  Company,
  GeneratedComment,
  OpportunityWithRelations,
  ReportStatus,
  ReportWithOpportunity,
  SearchResult,
  SourceCapture,
} from './domain/types';
import { DEFAULT_SETTINGS } from './domain/types';
import type { AdminOpportunityFilters, CaptureFilters, CommentWithOpportunity } from './store/types';
import { getStore } from './services/context';

/**
 * Read helpers for the admin workspace. Every page must render even when the
 * database is unavailable so the owner sees a clear setup message instead of a
 * crash. No loader ever invents data.
 */
export type AdminLoad<T> = { data: T; available: boolean; error: string | null };

export const EMPTY_ADMIN_STATS: AdminStatistics = {
  total: 0,
  published: 0,
  pending_review: 0,
  draft: 0,
  closed: 0,
  expired: 0,
  rejected: 0,
  archived: 0,
  added_today: 0,
  published_today: 0,
  needs_verification: 0,
  duplicate_captures: 0,
  open_reports: 0,
  total_captures: 0,
};

export const EMPTY_SEARCH: SearchResult = { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 };

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'The database is unavailable.';
}

async function load<T>(
  env: AppEnv,
  fn: (store: NonNullable<ReturnType<typeof getStore>>) => Promise<T>,
  fallback: T,
): Promise<AdminLoad<T>> {
  const store = getStore(env);
  if (!store) return { data: fallback, available: false, error: 'Supabase is not configured yet.' };
  try {
    return { data: await fn(store), available: true, error: null };
  } catch (error) {
    console.error('admin data load failed', message(error));
    return { data: fallback, available: false, error: message(error) };
  }
}

export function loadAdminStats(env: AppEnv): Promise<AdminLoad<AdminStatistics>> {
  return load(env, (store) => store.adminStats(), EMPTY_ADMIN_STATS);
}

export function loadAdminOpportunities(
  env: AppEnv,
  filters: AdminOpportunityFilters,
): Promise<AdminLoad<SearchResult>> {
  return load(env, (store) => store.listAdmin(filters), { ...EMPTY_SEARCH, page: filters.page ?? 1 });
}

export function loadCaptures(
  env: AppEnv,
  filters: CaptureFilters,
): Promise<AdminLoad<{ items: SourceCapture[]; total: number }>> {
  return load(env, (store) => store.listCaptures(filters), { items: [], total: 0 });
}

export function loadCapture(env: AppEnv, id: string): Promise<AdminLoad<SourceCapture | null>> {
  return load(env, (store) => store.getCapture(id), null);
}

export function loadOpportunityById(env: AppEnv, id: string): Promise<AdminLoad<OpportunityWithRelations | null>> {
  return load(env, (store) => store.getOpportunityById(id), null);
}

export function loadAdminCategories(env: AppEnv): Promise<AdminLoad<Category[]>> {
  return load(env, (store) => store.listCategories({ activeOnly: false }), []);
}

export function loadAdminCategoriesWithCounts(env: AppEnv): Promise<AdminLoad<CategoryWithCount[]>> {
  return load(env, (store) => store.listCategoriesWithCounts(), []);
}

export function loadCompanies(env: AppEnv, q = ''): Promise<AdminLoad<Company[]>> {
  return load(env, (store) => store.listCompanies({ q, limit: 200 }), []);
}

export function loadReports(env: AppEnv, status: ReportStatus | ''): Promise<AdminLoad<ReportWithOpportunity[]>> {
  return load(env, (store) => store.listReports(status), []);
}

export function loadCommentQueue(env: AppEnv, limit = 60): Promise<AdminLoad<CommentWithOpportunity[]>> {
  return load(env, (store) => store.listCommentQueue(limit), []);
}

export function loadComments(env: AppEnv, opportunityId: string): Promise<AdminLoad<GeneratedComment[]>> {
  return load(env, (store) => store.listComments(opportunityId), []);
}

export function loadActivity(env: AppEnv, limit = 10): Promise<AdminLoad<ActivityLog[]>> {
  return load(env, (store) => store.listActivity(limit), []);
}

export function loadAdminSettings(env: AppEnv): Promise<AdminLoad<AppSettings>> {
  return load(env, (store) => store.getSettings(), DEFAULT_SETTINGS);
}

export function loadNeedsVerification(env: AppEnv, days: number): Promise<AdminLoad<OpportunityWithRelations[]>> {
  return load(env, (store) => store.needsVerification(days), []);
}

const EMPTY_ANALYTICS: AnalyticsSummary = {
  views: 0,
  applyClicks: 0,
  emailClicks: 0,
  sourceClicks: 0,
  careersClicks: 0,
  shares: 0,
  searches: 0,
  topOpportunities: [],
  topCategories: [],
  publicationTrend: [],
  dailyEvents: [],
  topSearches: [],
};

export function loadAdminAnalytics(env: AppEnv, days = 30): Promise<AdminLoad<AnalyticsSummary>> {
  return load(env, (store) => store.analytics(days), EMPTY_ANALYTICS);
}

/** Formatting helpers shared by admin tables. */
export function initials(value: string): string {
  return (
    value
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'HC'
  );
}
