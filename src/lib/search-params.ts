import {
  EMPLOYMENT_TYPES,
  WORK_MODES,
  type EmploymentType,
  type SearchFilters,
  type WorkMode,
} from './domain/types';

export type DirectoryParams = {
  q: string;
  category: string;
  country: string;
  city: string;
  workMode: WorkMode[];
  employmentType: EmploymentType[];
  experience: '' | 'entry' | 'mid' | 'senior';
  salaryDisclosed: boolean;
  currency: string;
  sort: 'newest' | 'oldest' | 'source_date' | 'relevance';
  page: number;
};

const SORTS = ['newest', 'oldest', 'source_date', 'relevance'] as const;

function clean(value: string | null, max = 120): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Parses shareable directory URLs. Unknown enum values are discarded rather
 * than passed to the database, so a hand-edited URL can never error.
 */
export function parseDirectoryParams(url: URL): DirectoryParams {
  const params = url.searchParams;
  const workMode = params
    .getAll('workMode')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value): value is WorkMode => (WORK_MODES as readonly string[]).includes(value));
  const employmentType = params
    .getAll('employmentType')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value): value is EmploymentType => (EMPLOYMENT_TYPES as readonly string[]).includes(value));

  const experienceRaw = clean(params.get('experience'), 10);
  const experience = (['entry', 'mid', 'senior'] as const).includes(experienceRaw as never)
    ? (experienceRaw as DirectoryParams['experience'])
    : '';

  const sortRaw = clean(params.get('sort'), 20);
  const sort = (SORTS as readonly string[]).includes(sortRaw) ? (sortRaw as DirectoryParams['sort']) : 'newest';

  const pageRaw = Number(params.get('page') ?? '1');
  const page = Number.isFinite(pageRaw) ? Math.min(Math.max(Math.trunc(pageRaw), 1), 500) : 1;

  return {
    q: clean(params.get('q')),
    category: clean(params.get('category'), 80),
    country: clean(params.get('country'), 80),
    city: clean(params.get('city'), 80),
    workMode: [...new Set(workMode)],
    employmentType: [...new Set(employmentType)],
    experience,
    salaryDisclosed: params.get('salary') === 'disclosed',
    currency: clean(params.get('currency'), 3).toUpperCase(),
    sort,
    page,
  };
}

export function toSearchFilters(p: DirectoryParams, pageSize = 12): SearchFilters {
  return {
    q: p.q || undefined,
    category: p.category || undefined,
    country: p.country || undefined,
    city: p.city || undefined,
    workMode: p.workMode.length ? p.workMode : undefined,
    employmentType: p.employmentType.length ? p.employmentType : undefined,
    experience: p.experience || undefined,
    salaryDisclosed: p.salaryDisclosed,
    currency: p.currency || undefined,
    sort: p.sort,
    page: p.page,
    pageSize,
  };
}

/** Serialises filters back to a link-safe query string (omits defaults). */
export function buildQuery(p: DirectoryParams, base = '/opportunities'): string {
  const params = new URLSearchParams();
  if (p.q) params.set('q', p.q);
  if (p.category) params.set('category', p.category);
  if (p.country) params.set('country', p.country);
  if (p.city) params.set('city', p.city);
  for (const mode of p.workMode) params.append('workMode', mode);
  for (const type of p.employmentType) params.append('employmentType', type);
  if (p.experience) params.set('experience', p.experience);
  if (p.salaryDisclosed) params.set('salary', 'disclosed');
  if (p.currency) params.set('currency', p.currency);
  if (p.sort !== 'newest') params.set('sort', p.sort);
  if (p.page > 1) params.set('page', String(p.page));
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export function withParams(p: DirectoryParams, patch: Partial<DirectoryParams>): string {
  return buildQuery({ ...p, page: 1, ...patch });
}

export function activeFilterCount(p: DirectoryParams): number {
  return (
    (p.q ? 1 : 0) +
    (p.category ? 1 : 0) +
    (p.country ? 1 : 0) +
    (p.city ? 1 : 0) +
    p.workMode.length +
    p.employmentType.length +
    (p.experience ? 1 : 0) +
    (p.salaryDisclosed ? 1 : 0) +
    (p.currency ? 1 : 0)
  );
}

/** Page numbers with ellipses for the directory pagination. */
export function paginationRange(current: number, total: number): (number | 'gap')[] {
  const pages: (number | 'gap')[] = [];
  if (total <= 7) {
    for (let i = 1; i <= total; i += 1) pages.push(i);
    return pages;
  }
  pages.push(1);
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push('gap');
  for (let i = start; i <= end; i += 1) pages.push(i);
  if (end < total - 1) pages.push('gap');
  pages.push(total);
  return pages;
}
