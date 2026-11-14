import type { AppEnv } from './env';
import type {
  AnalyticsSummary,
  AppSettings,
  Category,
  CategoryWithCount,
  HomeData,
  OpportunityWithRelations,
  SearchFilters,
  SearchResult,
} from './domain/types';
import { DEFAULT_SETTINGS } from './domain/types';
import type { LocationCount } from './store/types';
import { getStore } from './services/context';

/**
 * Read helpers for server-rendered pages.
 *
 * Every page must render even when Supabase has not been configured yet (fresh
 * clone, preview deployment, temporary outage). These helpers turn missing
 * infrastructure into honest empty states instead of a 500 page, and never
 * substitute fabricated listings.
 */
export type LoadResult<T> = {
  data: T;
  /** False when the database is unavailable, so pages can show a setup notice. */
  available: boolean;
  error: string | null;
};

export const EMPTY_HOME: HomeData = {
  latest: [],
  recentlyDiscovered: [],
  remote: [],
  internships: [],
  featured: [],
  categories: [],
  locations: [],
  totalPublished: 0,
};

export const EMPTY_SEARCH: SearchResult = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 12,
  totalPages: 1,
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'The database is unavailable.';
}

async function load<T>(env: AppEnv, fn: (store: NonNullable<ReturnType<typeof getStore>>) => Promise<T>, fallback: T): Promise<LoadResult<T>> {
  const store = getStore(env);
  if (!store) return { data: fallback, available: false, error: 'The database is not configured yet.' };
  try {
    return { data: await fn(store), available: true, error: null };
  } catch (error) {
    console.error('page data load failed', message(error));
    return { data: fallback, available: false, error: message(error) };
  }
}

export async function loadHome(env: AppEnv, limit = 6): Promise<LoadResult<HomeData>> {
  return load(env, (store) => store.homepage(limit), EMPTY_HOME);
}

export async function loadCategories(env: AppEnv): Promise<LoadResult<CategoryWithCount[]>> {
  return load(env, (store) => store.listCategoriesWithCounts(), []);
}

export async function loadCategory(env: AppEnv, slug: string): Promise<LoadResult<Category | null>> {
  return load(env, (store) => store.getCategoryBySlug(slug), null);
}

export async function loadDirectory(env: AppEnv, filters: SearchFilters): Promise<LoadResult<SearchResult>> {
  return load(
    env,
    (store) => store.searchPublic(filters),
    { ...EMPTY_SEARCH, page: filters.page ?? 1, pageSize: filters.pageSize ?? 12 },
  );
}

export async function loadOpportunity(env: AppEnv, slug: string): Promise<LoadResult<OpportunityWithRelations | null>> {
  return load(env, (store) => store.getOpportunityBySlug(slug), null);
}

export async function loadOpportunityById(env: AppEnv, id: string): Promise<LoadResult<OpportunityWithRelations | null>> {
  return load(env, (store) => store.getOpportunityById(id), null);
}

export async function loadLocations(env: AppEnv): Promise<LoadResult<LocationCount[]>> {
  return load(env, (store) => store.listLocations(), []);
}

export async function loadCountries(env: AppEnv): Promise<LoadResult<{ country: string; count: number }[]>> {
  return load(env, (store) => store.listCountries(), []);
}

export async function loadSettings(env: AppEnv): Promise<LoadResult<AppSettings>> {
  return load(env, (store) => store.getSettings(), DEFAULT_SETTINGS);
}

export async function loadAnalytics(env: AppEnv, days = 30): Promise<LoadResult<AnalyticsSummary>> {
  const empty: AnalyticsSummary = {
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
  return load(env, (store) => store.analytics(days), empty);
}

/** Publicly visible states: live listings plus preserved closed ones. */
export function isPubliclyVisible(opportunity: OpportunityWithRelations | null): boolean {
  if (!opportunity) return false;
  return ['published', 'closed', 'expired'].includes(opportunity.status);
}

export function isExpired(opportunity: Pick<OpportunityWithRelations, 'deadline' | 'status'>): boolean {
  if (opportunity.status === 'expired') return true;
  if (!opportunity.deadline) return false;
  const deadline = Date.parse(`${opportunity.deadline}T23:59:59.999Z`);
  return Number.isFinite(deadline) && deadline < Date.now();
}
