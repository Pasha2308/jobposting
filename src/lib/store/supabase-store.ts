import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ActivityLog,
  AdminProfile,
  AdminStatistics,
  AnalyticsSummary,
  AppSettings,
  Category,
  CategoryWithCount,
  CommentStyle,
  Company,
  CompanySource,
  GeneratedComment,
  HomeData,
  Opportunity,
  OpportunityDraft,
  OpportunityWithRelations,
  Report,
  ReportWithOpportunity,
  SearchFilters,
  SearchResult,
  SourceCapture,
} from '../domain/types';
import { DEFAULT_SETTINGS } from '../domain/types';
import type { DuplicateCandidate } from '../domain/duplicates';
import { slugify } from '../domain/url';
import type {
  AdminOpportunityFilters,
  CaptureFilters,
  CommentSetInput,
  CommentWithOpportunity,
  LocationCount,
  Store,
} from './types';

export class StoreError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

function fail(error: { message: string; code?: string } | null, context: string): never {
  // Never include credentials or request headers in the surfaced message.
  throw new StoreError(`${context}: ${error?.message ?? 'unknown database error'}`, error?.code);
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value);
  return s === '' ? null : s;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)).filter(Boolean) : [];
}

export function mapOpportunity(row: Record<string, unknown>): OpportunityWithRelations {
  const companyRaw = row.company as Record<string, unknown> | null | undefined;
  const categoryRaw = row.category as Record<string, unknown> | null | undefined;
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    company_id: str(row.company_id),
    category_id: str(row.category_id),
    summary: str(row.summary),
    responsibilities: strArray(row.responsibilities),
    requirements: strArray(row.requirements),
    skills: strArray(row.skills),
    preferred_skills: strArray(row.preferred_skills),
    education_requirements: strArray(row.education_requirements),
    benefits: strArray(row.benefits),
    languages: strArray(row.languages),
    recruiter_name: str(row.recruiter_name),
    location_text: str(row.location_text),
    city: str(row.city),
    country: str(row.country),
    country_code: str(row.country_code),
    work_mode: (row.work_mode as Opportunity['work_mode']) ?? 'unspecified',
    employment_type: (row.employment_type as Opportunity['employment_type']) ?? 'unspecified',
    salary_min: num(row.salary_min),
    salary_max: num(row.salary_max),
    currency: str(row.currency),
    salary_period: (row.salary_period as Opportunity['salary_period']) ?? 'unspecified',
    experience_min_years: num(row.experience_min_years),
    experience_max_years: num(row.experience_max_years),
    application_method: (row.application_method as Opportunity['application_method']) ?? 'none',
    application_url: str(row.application_url),
    recruitment_email: str(row.recruitment_email),
    careers_url: str(row.careers_url),
    application_instructions: str(row.application_instructions),
    source_url: str(row.source_url),
    source_type: (row.source_type as Opportunity['source_type']) ?? null,
    source_capture_id: str(row.source_capture_id),
    canonical_source_key: str(row.canonical_source_key),
    opening_key: Number(row.opening_key ?? 1),
    deadline: str(row.deadline),
    original_posted_at: str(row.original_posted_at),
    original_date_precision: (row.original_date_precision as Opportunity['original_date_precision']) ?? 'unknown',
    original_date_text: str(row.original_date_text),
    status: (row.status as Opportunity['status']) ?? 'draft',
    verification_status: (row.verification_status as Opportunity['verification_status']) ?? 'not_verified',
    is_featured: Boolean(row.is_featured),
    quality_flags: strArray(row.quality_flags),
    completeness_score: num(row.completeness_score),
    discovered_at: String(row.discovered_at ?? new Date().toISOString()),
    published_at: str(row.published_at),
    last_verified_at: str(row.last_verified_at),
    closed_at: str(row.closed_at),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
    admin_notes: str(row.admin_notes),
    created_by: str(row.created_by),
    publication_number: row.publication_number != null ? Number(row.publication_number) : null,
    company: companyRaw
      ? {
          id: String(companyRaw.id),
          name: String(companyRaw.name),
          slug: String(companyRaw.slug ?? ''),
          website: str(companyRaw.website),
          careers_url: str(companyRaw.careers_url),
          description: str(companyRaw.description),
          verified: Boolean(companyRaw.verified),
        }
      : null,
    category: categoryRaw
      ? {
          id: String(categoryRaw.id),
          name: String(categoryRaw.name),
          slug: String(categoryRaw.slug ?? ''),
        }
      : null,
  };
}

function mapCategory(row: Record<string, unknown>): Category {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    description: str(row.description),
    is_active: Boolean(row.is_active),
    is_featured: Boolean(row.is_featured),
    sort_order: Number(row.sort_order ?? 100),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
  };
}

function mapCompany(row: Record<string, unknown>): Company {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    website: str(row.website),
    careers_url: str(row.careers_url),
    description: str(row.description),
    logo_url: str(row.logo_url),
    verified: Boolean(row.verified),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
  };
}

function mapCapture(row: Record<string, unknown>): SourceCapture {
  return {
    id: String(row.id),
    source_url: str(row.source_url),
    normalized_source_key: String(row.normalized_source_key ?? ''),
    source_post_id: str(row.source_post_id),
    source_type: (row.source_type as SourceCapture['source_type']) ?? 'other',
    raw_text: String(row.raw_text ?? ''),
    submitted_company: str(row.submitted_company),
    notes: str(row.notes),
    status: (row.status as SourceCapture['status']) ?? 'received',
    error_message: str(row.error_message),
    extraction: row.extraction ?? null,
    extraction_confidence: num(row.extraction_confidence),
    attempt_count: Number(row.attempt_count ?? 0),
    processing_started_at: str(row.processing_started_at),
    opportunity_id: str(row.opportunity_id),
    created_by: str(row.created_by),
    retrieval_status: (row.retrieval_status as SourceCapture['retrieval_status']) ?? 'pending',
    retrieval_method: (row.retrieval_method as SourceCapture['retrieval_method']) ?? null,
    retrieval_http_status: row.retrieval_http_status == null ? null : Number(row.retrieval_http_status),
    retrieval_error_code: str(row.retrieval_error_code),
    retrieval_attempts: Number(row.retrieval_attempts ?? 0),
    retrieved_at: str(row.retrieved_at),
    next_retry_at: str(row.next_retry_at),
    source_author: str(row.source_author),
    source_posted_at: str(row.source_posted_at),
    source_metadata: (row.source_metadata as Record<string, unknown> | null) ?? null,
    source_comments: Array.isArray(row.source_comments)
      ? (row.source_comments as SourceCapture['source_comments'])
      : null,
    telegram_user_id: row.telegram_user_id == null ? null : Number(row.telegram_user_id),
    telegram_chat_id: row.telegram_chat_id == null ? null : Number(row.telegram_chat_id),
    telegram_message_id: row.telegram_message_id == null ? null : Number(row.telegram_message_id),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
  };
}

function mapComment(row: Record<string, unknown>): GeneratedComment {
  return {
    id: String(row.id),
    opportunity_id: String(row.opportunity_id),
    style: (row.style as GeneratedComment['style']) ?? 'professional',
    body: String(row.body ?? ''),
    is_selected: Boolean(row.is_selected),
    manually_posted: Boolean(row.manually_posted),
    generated_by: (row.generated_by as GeneratedComment['generated_by']) ?? 'template',
    version: Number(row.version ?? 1),
    includes_listing_url: Boolean(row.includes_listing_url),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
  };
}

function mapReport(row: Record<string, unknown>): ReportWithOpportunity {
  const opp = row.opportunity as Record<string, unknown> | null | undefined;
  return {
    id: String(row.id),
    opportunity_id: String(row.opportunity_id),
    reason: row.reason as Report['reason'],
    details: str(row.details),
    contact_email: str(row.contact_email),
    status: (row.status as Report['status']) ?? 'open',
    resolution_note: str(row.resolution_note),
    created_at: String(row.created_at ?? new Date().toISOString()),
    resolved_at: str(row.resolved_at),
    opportunity: opp
      ? {
          id: String(opp.id),
          slug: String(opp.slug),
          title: String(opp.title),
          status: opp.status as Opportunity['status'],
        }
      : null,
  };
}

function opportunityRow(draft: OpportunityDraft): Record<string, unknown> {
  return {
    slug: draft.slug,
    title: draft.title,
    company_id: draft.company_id,
    category_id: draft.category_id,
    summary: draft.summary,
    responsibilities: draft.responsibilities ?? [],
    requirements: draft.requirements ?? [],
    skills: draft.skills ?? [],
    preferred_skills: draft.preferred_skills ?? [],
    education_requirements: draft.education_requirements ?? [],
    benefits: draft.benefits ?? [],
    languages: draft.languages ?? [],
    recruiter_name: draft.recruiter_name ?? null,
    quality_flags: draft.quality_flags ?? [],
    completeness_score: draft.completeness_score ?? null,
    location_text: draft.location_text,
    city: draft.city,
    country: draft.country,
    country_code: draft.country_code,
    work_mode: draft.work_mode,
    employment_type: draft.employment_type,
    salary_min: draft.salary_min,
    salary_max: draft.salary_max,
    currency: draft.currency,
    salary_period: draft.salary_period,
    experience_min_years: draft.experience_min_years,
    experience_max_years: draft.experience_max_years,
    application_method: draft.application_method,
    application_url: draft.application_url,
    recruitment_email: draft.recruitment_email,
    careers_url: draft.careers_url,
    application_instructions: draft.application_instructions,
    source_url: draft.source_url,
    source_type: draft.source_type,
    source_capture_id: draft.source_capture_id,
    canonical_source_key: draft.canonical_source_key,
    deadline: draft.deadline,
    original_posted_at: draft.original_posted_at,
    original_date_precision: draft.original_date_precision,
    original_date_text: draft.original_date_text,
    status: draft.status,
    verification_status: draft.verification_status,
    is_featured: draft.is_featured,
    published_at: draft.published_at ?? null,
    last_verified_at: draft.last_verified_at,
    closed_at: draft.closed_at ?? null,
    admin_notes: draft.admin_notes,
    opening_key: draft.opening_key ?? 1,
    ...(draft.publication_number !== undefined ? { publication_number: draft.publication_number } : {}),
    ...(draft.discovered_at ? { discovered_at: draft.discovered_at } : {}),
    ...(draft.created_by ? { created_by: draft.created_by } : {}),
  };
}

export class SupabaseStore implements Store {
  constructor(private readonly client: SupabaseClient) {}

  /* ------------------------------------------------------------------ */
  /* Categories                                                          */
  /* ------------------------------------------------------------------ */
  async listCategories(opts: { activeOnly?: boolean } = {}): Promise<Category[]> {
    let query = this.client.from('categories').select('*').order('sort_order').order('name');
    if (opts.activeOnly !== false) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (error) fail(error, 'Could not load categories');
    return (data ?? []).map((row) => mapCategory(row as Record<string, unknown>));
  }

  async listCategoriesWithCounts(): Promise<CategoryWithCount[]> {
    const { data, error } = await this.client.rpc('homepage_sections', { p_limit: 1 });
    if (error) fail(error, 'Could not load category counts');
    const payload = (data ?? {}) as { categories?: CategoryWithCount[] };
    return payload.categories ?? [];
  }

  async getCategoryBySlug(slug: string): Promise<Category | null> {
    const { data, error } = await this.client.from('categories').select('*').eq('slug', slug).maybeSingle();
    if (error) fail(error, 'Could not load category');
    return data ? mapCategory(data as Record<string, unknown>) : null;
  }

  async getCategoryById(id: string): Promise<Category | null> {
    const { data, error } = await this.client.from('categories').select('*').eq('id', id).maybeSingle();
    if (error) fail(error, 'Could not load category');
    return data ? mapCategory(data as Record<string, unknown>) : null;
  }

  async createCategory(input: Omit<Category, 'id' | 'created_at' | 'updated_at'>): Promise<Category> {
    const { data, error } = await this.client.from('categories').insert(input).select('*').single();
    if (error) fail(error, 'Could not create category');
    return mapCategory(data as Record<string, unknown>);
  }

  async updateCategory(id: string, patch: Partial<Category>): Promise<Category> {
    const { data, error } = await this.client.from('categories').update(patch).eq('id', id).select('*').single();
    if (error) fail(error, 'Could not update category');
    return mapCategory(data as Record<string, unknown>);
  }

  /* ------------------------------------------------------------------ */
  /* Companies                                                           */
  /* ------------------------------------------------------------------ */
  async listCompanies(opts: { q?: string; limit?: number } = {}): Promise<Company[]> {
    let query = this.client
      .from('companies')
      .select('*')
      .order('verified', { ascending: false })
      .order('name')
      .limit(opts.limit ?? 200);
    if (opts.q) query = query.ilike('name', `%${opts.q}%`);
    const { data, error } = await query;
    if (error) fail(error, 'Could not load companies');
    return (data ?? []).map((row) => mapCompany(row as Record<string, unknown>));
  }

  async getCompanyById(id: string): Promise<Company | null> {
    const { data, error } = await this.client.from('companies').select('*').eq('id', id).maybeSingle();
    if (error) fail(error, 'Could not load company');
    return data ? mapCompany(data as Record<string, unknown>) : null;
  }

  async findCompanyByName(name: string): Promise<Company | null> {
    const { data, error } = await this.client
      .from('companies')
      .select('*')
      .ilike('name', name.trim())
      .limit(1)
      .maybeSingle();
    if (error) fail(error, 'Could not look up company');
    return data ? mapCompany(data as Record<string, unknown>) : null;
  }

  async createCompany(input: {
    name: string;
    slug: string;
    website?: string | null;
    careers_url?: string | null;
    description?: string | null;
    verified?: boolean;
  }): Promise<Company> {
    const { data, error } = await this.client
      .from('companies')
      .insert({
        name: input.name,
        slug: input.slug,
        website: input.website ?? null,
        careers_url: input.careers_url ?? null,
        description: input.description ?? null,
        verified: input.verified ?? false,
      })
      .select('*')
      .single();
    if (error) fail(error, 'Could not create company');
    return mapCompany(data as Record<string, unknown>);
  }

  async updateCompany(id: string, patch: Partial<Company>): Promise<Company> {
    const { data, error } = await this.client.from('companies').update(patch).eq('id', id).select('*').single();
    if (error) fail(error, 'Could not update company');
    return mapCompany(data as Record<string, unknown>);
  }

  /* ------------------------------------------------------------------ */
  /* Opportunities                                                       */
  /* ------------------------------------------------------------------ */
  async searchPublic(filters: SearchFilters): Promise<SearchResult> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(48, Math.max(1, filters.pageSize ?? 12));
    const { data, error } = await this.client.rpc('search_public_opportunities', {
      p_q: filters.q?.trim() || null,
      p_category: filters.category || null,
      p_country: filters.country || null,
      p_city: filters.city || null,
      p_work_modes: filters.workMode?.length ? filters.workMode : null,
      p_employment_types: filters.employmentType?.length ? filters.employmentType : null,
      p_experience: filters.experience || null,
      p_salary_disclosed: Boolean(filters.salaryDisclosed),
      p_currency: filters.currency || null,
      p_sort: filters.sort || 'newest',
      p_page: page,
      p_page_size: pageSize,
    });
    if (error) fail(error, 'Could not search opportunities');
    const payload = (data ?? {}) as { total?: number; items?: Record<string, unknown>[] };
    const total = Number(payload.total ?? 0);
    return {
      items: (payload.items ?? []).map(mapOpportunity),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async listAdmin(filters: AdminOpportunityFilters): Promise<SearchResult> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
    const { data, error } = await this.client.rpc('admin_list_opportunities', {
      p_q: filters.q?.trim() || null,
      p_status: filters.status || null,
      p_category: filters.category || null,
      p_sort: filters.sort || 'newest',
      p_page: page,
      p_page_size: pageSize,
    });
    if (error) fail(error, 'Could not load opportunities');
    const payload = (data ?? {}) as { total?: number; items?: Record<string, unknown>[] };
    const total = Number(payload.total ?? 0);
    return {
      items: (payload.items ?? []).map(mapOpportunity),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async getOpportunityById(id: string): Promise<OpportunityWithRelations | null> {
    const { data, error } = await this.client
      .from('opportunities')
      .select(
        '*, company:companies(id,name,slug,website,careers_url,description,verified), category:categories(id,slug,name)',
      )
      .eq('id', id)
      .maybeSingle();
    if (error) fail(error, 'Could not load opportunity');
    return data ? mapOpportunity(data as Record<string, unknown>) : null;
  }

  async getOpportunityBySlug(slug: string): Promise<OpportunityWithRelations | null> {
    const { data, error } = await this.client
      .from('opportunities')
      .select(
        '*, company:companies(id,name,slug,website,careers_url,description,verified), category:categories(id,slug,name)',
      )
      .eq('slug', slug)
      .maybeSingle();
    if (error) fail(error, 'Could not load opportunity');
    return data ? mapOpportunity(data as Record<string, unknown>) : null;
  }

  async createOpportunity(draft: OpportunityDraft): Promise<Opportunity> {
    const { data, error } = await this.client.from('opportunities').insert(opportunityRow(draft)).select('*').single();
    if (error) fail(error, 'Could not create opportunity');
    return mapOpportunity(data as Record<string, unknown>);
  }

  async updateOpportunity(id: string, patch: Partial<Opportunity>): Promise<Opportunity> {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    const { data, error } = await this.client.from('opportunities').update(clean).eq('id', id).select('*').single();
    if (error) fail(error, 'Could not update opportunity');
    return mapOpportunity(data as Record<string, unknown>);
  }

  async deleteOpportunity(id: string): Promise<void> {
    const { error } = await this.client.from('opportunities').delete().eq('id', id);
    if (error) fail(error, 'Could not delete opportunity');
  }

  async homepage(limit = 6): Promise<HomeData> {
    const { data, error } = await this.client.rpc('homepage_sections', { p_limit: limit });
    if (error) fail(error, 'Could not load homepage');
    const payload = (data ?? {}) as Record<string, unknown>;
    const list = (key: string) => ((payload[key] ?? []) as Record<string, unknown>[]).map(mapOpportunity);
    return {
      latest: list('latest'),
      recentlyDiscovered: list('recentlyDiscovered'),
      remote: list('remote'),
      internships: list('internships'),
      featured: list('featured'),
      categories: (payload.categories ?? []) as CategoryWithCount[],
      locations: (payload.locations ?? []) as HomeData['locations'],
      totalPublished: Number(payload.totalPublished ?? 0),
    };
  }

  async recentDuplicateCandidates(limit = 200): Promise<DuplicateCandidate[]> {
    const cutoff = new Date(Date.now() - 180 * 86_400_000).toISOString();
    const { data, error } = await this.client
      .from('opportunities')
      .select('id,title,source_url,canonical_source_key,original_posted_at,discovered_at,company:companies(name)')
      .gte('discovered_at', cutoff)
      .not('status', 'in', '(archived,rejected)')
      .order('discovered_at', { ascending: false })
      .limit(limit);
    if (error) fail(error, 'Could not check duplicates');
    return (data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      const company = r.company as { name?: string } | null;
      return {
        id: String(r.id),
        title: String(r.title),
        companyName: company?.name ?? null,
        source_url: str(r.source_url),
        normalized_source_key: str(r.canonical_source_key),
        original_posted_at: str(r.original_posted_at),
        discovered_at: str(r.discovered_at),
      };
    });
  }

  async findOpportunityBySourceKey(key: string): Promise<Opportunity | null> {
    const { data, error } = await this.client
      .from('opportunities')
      .select('*')
      .eq('canonical_source_key', key)
      .limit(1)
      .maybeSingle();
    if (error) fail(error, 'Could not look up source');
    return data ? mapOpportunity(data as Record<string, unknown>) : null;
  }

  async listPublicSlugs(): Promise<{ slug: string; updated_at: string }[]> {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await this.client
      .from('opportunities')
      .select('slug,updated_at')
      .eq('status', 'published')
      .is('closed_at', null)
      .or(`deadline.is.null,deadline.gte.${today}`)
      .limit(5000);
    if (error) fail(error, 'Could not load sitemap');
    return (data ?? []) as { slug: string; updated_at: string }[];
  }

  async listLocations(): Promise<LocationCount[]> {
    const { data, error } = await this.client
      .from('opportunities')
      .select('city,country')
      .eq('status', 'published')
      .is('closed_at', null)
      .not('city', 'is', null)
      .limit(5000);
    if (error) fail(error, 'Could not load locations');
    const counts = new Map<string, LocationCount>();
    for (const row of (data ?? []) as { city: string | null; country: string | null }[]) {
      if (!row.city) continue;
      const key = `${row.city.toLowerCase()}::${(row.country ?? '').toLowerCase()}`;
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else
        counts.set(key, {
          city: row.city,
          country: row.country,
          count: 1,
          slug: `${slugify(row.city)}${row.country ? `-${slugify(row.country)}` : ''}`,
        });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
  }

  async listCountries(): Promise<{ country: string; count: number }[]> {
    const { data, error } = await this.client
      .from('opportunities')
      .select('country')
      .eq('status', 'published')
      .is('closed_at', null)
      .not('country', 'is', null)
      .limit(5000);
    if (error) fail(error, 'Could not load countries');
    const counts = new Map<string, number>();
    for (const row of (data ?? []) as { country: string | null }[]) {
      if (!row.country) continue;
      counts.set(row.country, (counts.get(row.country) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));
  }

  async needsVerification(days: number): Promise<OpportunityWithRelations[]> {
    const { data, error } = await this.client.rpc('opportunities_needing_verification', { p_days: days });
    if (error) fail(error, 'Could not load verification queue');
    return ((data ?? []) as Record<string, unknown>[]).map(mapOpportunity);
  }

  /* ------------------------------------------------------------------ */
  /* Captures                                                            */
  /* ------------------------------------------------------------------ */
  async createCapture(input: Parameters<Store['createCapture']>[0]): Promise<SourceCapture> {
    const { data, error } = await this.client
      .from('source_captures')
      .insert({
        source_url: input.source_url,
        normalized_source_key: input.normalized_source_key,
        source_post_id: input.source_post_id ?? null,
        source_type: input.source_type,
        raw_text: input.raw_text,
        submitted_company: input.submitted_company ?? null,
        notes: input.notes ?? null,
        ...(input.status ? { status: input.status } : {}),
        created_by: input.created_by,
        telegram_user_id: input.telegram_user_id ?? null,
        telegram_chat_id: input.telegram_chat_id ?? null,
        telegram_message_id: input.telegram_message_id ?? null,
        ...(input.retrieval_status ? { retrieval_status: input.retrieval_status } : {}),
        retrieval_method: input.retrieval_method ?? null,
        retrieval_http_status: input.retrieval_http_status ?? null,
        retrieval_error_code: input.retrieval_error_code ?? null,
        ...(input.retrieval_attempts != null ? { retrieval_attempts: input.retrieval_attempts } : {}),
        retrieved_at: input.retrieved_at ?? null,
        next_retry_at: input.next_retry_at ?? null,
        source_author: input.source_author ?? null,
        source_posted_at: input.source_posted_at ?? null,
        source_metadata: input.source_metadata ?? null,
        source_comments: input.source_comments ?? null,
      })
      .select('*')
      .single();
    if (error) fail(error, 'Could not save capture');
    return mapCapture(data as Record<string, unknown>);
  }

  async getCapture(id: string): Promise<SourceCapture | null> {
    const { data, error } = await this.client.from('source_captures').select('*').eq('id', id).maybeSingle();
    if (error) fail(error, 'Could not load capture');
    return data ? mapCapture(data as Record<string, unknown>) : null;
  }

  async getCaptureBySourceKey(key: string): Promise<SourceCapture | null> {
    const { data, error } = await this.client
      .from('source_captures')
      .select('*')
      .eq('normalized_source_key', key)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) fail(error, 'Could not look up capture');
    return data ? mapCapture(data as Record<string, unknown>) : null;
  }

  async updateCapture(id: string, patch: Partial<SourceCapture>): Promise<SourceCapture> {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    const { data, error } = await this.client.from('source_captures').update(clean).eq('id', id).select('*').single();
    if (error) fail(error, 'Could not update capture');
    return mapCapture(data as Record<string, unknown>);
  }

  async listCaptures(filters: CaptureFilters): Promise<{ items: SourceCapture[]; total: number }> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
    let query = this.client.from('source_captures').select('*', { count: 'exact' });
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.q) {
      const q = filters.q.replace(/[%,]/g, ' ').trim();
      if (q) query = query.or(`source_url.ilike.%${q}%,submitted_company.ilike.%${q}%,raw_text.ilike.%${q}%`);
    }
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) fail(error, 'Could not load captures');
    return { items: (data ?? []).map((row) => mapCapture(row as Record<string, unknown>)), total: count ?? 0 };
  }

  async purgeExpiredSourceText(olderThanDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - Math.max(1, olderThanDays) * 86_400_000).toISOString();
    const { data, error } = await this.client
      .from('source_captures')
      .update({ raw_text: '', extraction: null, source_comments: null, source_metadata: null })
      .lt('created_at', cutoff)
      .select('id');
    if (error) fail(error, 'Could not purge expired source text');
    return (data ?? []).length;
  }

  async findAwaitingCapture(telegramUserId: number, maxAgeMinutes: number): Promise<SourceCapture | null> {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000).toISOString();
    const { data, error } = await this.client
      .from('source_captures')
      .select('*')
      .eq('telegram_user_id', telegramUserId)
      .in('status', ['awaiting_text', 'retrieval_failed'])
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) fail(error, 'Could not check pending capture');
    return data ? mapCapture(data as Record<string, unknown>) : null;
  }

  async claimDueRetrievals(limit: number): Promise<SourceCapture[]> {
    const { data, error } = await this.client.rpc('claim_retrieval_retries', { p_limit: limit });
    if (error) fail(error, 'Could not claim retrieval retries');
    return ((data ?? []) as Record<string, unknown>[]).map(mapCapture);
  }

  async recoverStaleRetrieving(olderThanSeconds: number): Promise<number> {
    const cutoff = new Date(Date.now() - Math.max(30, olderThanSeconds) * 1000).toISOString();
    const { data, error } = await this.client
      .from('source_captures')
      .update({
        status: 'retrieval_failed',
        retrieval_status: 'failed',
        retrieval_error_code: 'stale_recovered',
        error_message: 'Retrieval stopped before it finished (worker restart). The URL was preserved and the capture was re-queued.',
        next_retry_at: new Date().toISOString(),
      })
      .eq('status', 'retrieving')
      .lt('processing_started_at', cutoff)
      .select('id');
    if (error) fail(error, 'Could not recover stale retrievals');
    return (data ?? []).length;
  }

  async recoverStaleExtracting(olderThanSeconds: number): Promise<number> {
    const cutoff = new Date(Date.now() - Math.max(60, olderThanSeconds) * 1000).toISOString();
    const { data, error } = await this.client
      .from('source_captures')
      .update({
        status: 'extraction_failed',
        error_message:
          'Extraction stopped before it finished (worker restart). The source was preserved and extraction can be retried.',
        processing_started_at: null,
      })
      .eq('status', 'extracting')
      .lt('processing_started_at', cutoff)
      .select('id');
    if (error) fail(error, 'Could not recover stale extractions');
    return (data ?? []).length;
  }

  /* ------------------------------------------------------------------ */
  /* Comments                                                            */
  /* ------------------------------------------------------------------ */
  async replaceComments(
    opportunityId: string,
    comments: CommentSetInput[],
    opts: { generatedBy?: 'template' | 'ai'; selectedStyle?: CommentStyle },
  ): Promise<GeneratedComment[]> {
    const { data: latest, error: versionError } = await this.client
      .from('generated_comments')
      .select('version')
      .eq('opportunity_id', opportunityId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (versionError) fail(versionError, 'Could not version comments');
    const version = Number((latest as { version?: number } | null)?.version ?? 0) + 1;

    const { error: clearError } = await this.client
      .from('generated_comments')
      .update({ is_selected: false })
      .eq('opportunity_id', opportunityId)
      .eq('is_selected', true);
    if (clearError) fail(clearError, 'Could not reset comment selection');

    const selectedStyle = opts.selectedStyle ?? 'professional';
    const rows = comments.map((c) => ({
      opportunity_id: opportunityId,
      style: c.style,
      body: c.body,
      includes_listing_url: c.includesListingUrl,
      generated_by: opts.generatedBy ?? 'template',
      version,
      is_selected: c.style === selectedStyle,
    }));
    const { data, error } = await this.client.from('generated_comments').insert(rows).select('*');
    if (error) fail(error, 'Could not save comments');
    return (data ?? []).map((row) => mapComment(row as Record<string, unknown>));
  }

  async listComments(opportunityId: string): Promise<GeneratedComment[]> {
    const { data, error } = await this.client
      .from('generated_comments')
      .select('*')
      .eq('opportunity_id', opportunityId)
      .order('created_at', { ascending: false });
    if (error) fail(error, 'Could not load comments');
    return (data ?? []).map((row) => mapComment(row as Record<string, unknown>));
  }

  async getComment(id: string): Promise<GeneratedComment | null> {
    const { data, error } = await this.client.from('generated_comments').select('*').eq('id', id).maybeSingle();
    if (error) fail(error, 'Could not load comment');
    return data ? mapComment(data as Record<string, unknown>) : null;
  }

  async updateComment(
    id: string,
    patch: Partial<Pick<GeneratedComment, 'body' | 'is_selected' | 'manually_posted'>>,
  ): Promise<GeneratedComment> {
    if (patch.is_selected) {
      const existing = await this.getComment(id);
      if (existing) await this.clearCommentSelection(existing.opportunity_id);
    }
    const { data, error } = await this.client.from('generated_comments').update(patch).eq('id', id).select('*').single();
    if (error) fail(error, 'Could not update comment');
    return mapComment(data as Record<string, unknown>);
  }

  async listCommentQueue(limit = 100): Promise<CommentWithOpportunity[]> {
    const { data, error } = await this.client
      .from('generated_comments')
      .select('*, opportunity:opportunities(id,slug,title,status,company_id)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) fail(error, 'Could not load comments');
    return (data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      const opp = r.opportunity as Record<string, unknown> | null;
      return {
        ...mapComment(r),
        opportunity: {
          id: String(opp?.id ?? r.opportunity_id),
          slug: String(opp?.slug ?? ''),
          title: String(opp?.title ?? 'Untitled'),
          status: (opp?.status as Opportunity['status']) ?? 'draft',
          company_id: str(opp?.company_id),
        },
      };
    });
  }

  async clearCommentSelection(opportunityId: string): Promise<void> {
    const { error } = await this.client
      .from('generated_comments')
      .update({ is_selected: false })
      .eq('opportunity_id', opportunityId)
      .eq('is_selected', true);
    if (error) fail(error, 'Could not update comment selection');
  }

  /* ------------------------------------------------------------------ */
  /* Reports                                                             */
  /* ------------------------------------------------------------------ */
  async createReport(input: Parameters<Store['createReport']>[0]): Promise<Report> {
    const { data, error } = await this.client.from('reports').insert(input).select('*').single();
    if (error) fail(error, 'Could not save report');
    const { opportunity: _opportunity, ...report } = mapReport(data as Record<string, unknown>);
    return report;
  }

  async listReports(status?: Report['status'] | ''): Promise<ReportWithOpportunity[]> {
    let query = this.client
      .from('reports')
      .select('*, opportunity:opportunities(id,slug,title,status)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) fail(error, 'Could not load reports');
    return (data ?? []).map((row) => mapReport(row as Record<string, unknown>));
  }

  async getReport(id: string): Promise<ReportWithOpportunity | null> {
    const { data, error } = await this.client
      .from('reports')
      .select('*, opportunity:opportunities(id,slug,title,status)')
      .eq('id', id)
      .maybeSingle();
    if (error) fail(error, 'Could not load report');
    return data ? mapReport(data as Record<string, unknown>) : null;
  }

  async updateReport(id: string, patch: Partial<Report>): Promise<Report> {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    const { data, error } = await this.client.from('reports').update(clean).eq('id', id).select('*').single();
    if (error) fail(error, 'Could not update report');
    const mapped = mapReport(data as Record<string, unknown>);
    return mapped;
  }

  /* ------------------------------------------------------------------ */
  /* Events, analytics                                                   */
  /* ------------------------------------------------------------------ */
  async recordEvents(
    events: { opportunity_id?: string | null; event_type: string; metadata?: Record<string, unknown> | null }[],
  ): Promise<void> {
    if (!events.length) return;
    const { error } = await this.client.from('opportunity_events').insert(
      events.map((e) => ({
        opportunity_id: e.opportunity_id ?? null,
        event_type: e.event_type,
        metadata: e.metadata ?? null,
      })),
    );
    if (error) fail(error, 'Could not record event');
  }

  async analytics(days: number): Promise<AnalyticsSummary> {
    const { data, error } = await this.client.rpc('analytics_summary', { p_days: days });
    if (error) fail(error, 'Could not load analytics');
    const payload = (data ?? {}) as Partial<AnalyticsSummary>;
    return {
      views: Number(payload.views ?? 0),
      applyClicks: Number(payload.applyClicks ?? 0),
      emailClicks: Number(payload.emailClicks ?? 0),
      sourceClicks: Number(payload.sourceClicks ?? 0),
      careersClicks: Number(payload.careersClicks ?? 0),
      shares: Number(payload.shares ?? 0),
      searches: Number(payload.searches ?? 0),
      topOpportunities: payload.topOpportunities ?? [],
      topCategories: payload.topCategories ?? [],
      publicationTrend: payload.publicationTrend ?? [],
      dailyEvents: payload.dailyEvents ?? [],
      topSearches: payload.topSearches ?? [],
    };
  }

  /* ------------------------------------------------------------------ */
  /* Admin / platform                                                    */
  /* ------------------------------------------------------------------ */
  async adminStats(): Promise<AdminStatistics> {
    const { data, error } = await this.client.rpc('admin_dashboard_stats');
    if (error) fail(error, 'Could not load dashboard statistics');
    const payload = (data ?? {}) as Partial<AdminStatistics>;
    return {
      total: Number(payload.total ?? 0),
      published: Number(payload.published ?? 0),
      pending_review: Number(payload.pending_review ?? 0),
      draft: Number(payload.draft ?? 0),
      closed: Number(payload.closed ?? 0),
      expired: Number(payload.expired ?? 0),
      rejected: Number(payload.rejected ?? 0),
      archived: Number(payload.archived ?? 0),
      added_today: Number(payload.added_today ?? 0),
      published_today: Number(payload.published_today ?? 0),
      needs_verification: Number(payload.needs_verification ?? 0),
      duplicate_captures: Number(payload.duplicate_captures ?? 0),
      open_reports: Number(payload.open_reports ?? 0),
      total_captures: Number(payload.total_captures ?? 0),
    };
  }

  async getProfile(userId: string): Promise<AdminProfile | null> {
    const { data, error } = await this.client.from('admin_profiles').select('*').eq('user_id', userId).maybeSingle();
    if (error) fail(error, 'Could not verify administrator');
    if (!data) return null;
    const row = data as Record<string, unknown>;
    return {
      user_id: String(row.user_id),
      email: String(row.email),
      display_name: String(row.display_name ?? 'Administrator'),
      role: (row.role as AdminProfile['role']) ?? 'admin',
      is_active: Boolean(row.is_active),
      created_at: String(row.created_at ?? ''),
    };
  }

  async logActivity(log: {
    actor: string;
    action: string;
    entity_type: string;
    entity_id?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    const { error } = await this.client.from('activity_logs').insert({
      actor: log.actor,
      action: log.action,
      entity_type: log.entity_type,
      entity_id: log.entity_id ?? null,
      metadata: log.metadata ?? null,
    });
    // Logging must never break the user-facing operation.
    if (error) console.error('activity log failed', error.message);
  }

  async listActivity(limit = 50): Promise<ActivityLog[]> {
    const { data, error } = await this.client
      .from('activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) fail(error, 'Could not load activity');
    return (data ?? []) as ActivityLog[];
  }

  async claimTelegramUpdate(updateId: number, telegramUserId?: number | null, updateType?: string | null): Promise<boolean> {
    const { error } = await this.client.from('telegram_updates').insert({
      update_id: updateId,
      telegram_user_id: telegramUserId ?? null,
      update_type: updateType ?? null,
    });
    if (!error) return true;
    if (error.code === '23505') return false;
    fail(error, 'Could not claim Telegram update');
  }

  async getSettings(): Promise<AppSettings> {
    const { data, error } = await this.client.from('app_settings').select('value').eq('key', 'app').maybeSingle();
    if (error) fail(error, 'Could not load settings');
    const value = (data as { value?: Partial<AppSettings> } | null)?.value ?? {};
    return { ...DEFAULT_SETTINGS, ...value };
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.getSettings();
    const next = { ...current, ...patch };
    const { error } = await this.client
      .from('app_settings')
      .upsert({ key: 'app', value: next, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) fail(error, 'Could not save settings');
    return next;
  }

  async listCompanySources(companyId?: string): Promise<CompanySource[]> {
    let query = this.client.from('company_sources').select('*').order('created_at', { ascending: false });
    if (companyId) query = query.eq('company_id', companyId);
    const { data, error } = await query;
    if (error) fail(error, 'Could not load company sources');
    return (data ?? []) as CompanySource[];
  }

  async upsertCompanySource(input: {
    company_id: string;
    provider: CompanySource['provider'];
    board_identifier: string;
    source_url?: string | null;
    sync_status?: CompanySource['sync_status'];
  }): Promise<CompanySource> {
    const { data, error } = await this.client
      .from('company_sources')
      .upsert(
        {
          company_id: input.company_id,
          provider: input.provider,
          board_identifier: input.board_identifier,
          source_url: input.source_url ?? null,
          sync_status: input.sync_status ?? 'idle',
        },
        { onConflict: 'provider,board_identifier' },
      )
      .select('*')
      .single();
    if (error) fail(error, 'Could not save company source');
    return data as CompanySource;
  }
}
