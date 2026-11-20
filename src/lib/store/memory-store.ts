import type {
  ActivityLog,
  AdminProfile,
  AdminStatistics,
  AnalyticsSummary,
  AppSettings,
  Category,
  CategoryWithCount,
  Company,
  CompanySource,
  GeneratedComment,
  HomeData,
  Opportunity,
  OpportunityDraft,
  OpportunityEvent,
  OpportunityWithRelations,
  Report,
  ReportWithOpportunity,
  SearchFilters,
  SearchResult,
  SourceCapture,
} from '../domain/types';
import { DEFAULT_SETTINGS } from '../domain/types';
import type { DuplicateCandidate } from '../domain/duplicates';
import { checkDuplicates } from '../domain/duplicates';
import { slugify } from '../domain/url';
import type {
  AdminOpportunityFilters,
  CaptureFilters,
  CommentSetInput,
  CommentWithOpportunity,
  LinkedInDeliveryCounts,
  LinkedInDeliveryItem,
  LocationCount,
  PortfolioSearchRun,
  Store,
} from './types';

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

/**
 * In-memory implementation used by the test suite (and only by tests). It
 * follows the same semantics as SupabaseStore, so workflow tests exercise the
 * real services without requiring live credentials.
 */
export class MemoryStore implements Store {
  categories: Category[] = [];
  companies: Company[] = [];
  opportunities: Opportunity[] = [];
  captures: SourceCapture[] = [];
  comments: GeneratedComment[] = [];
  reports: Report[] = [];
  events: OpportunityEvent[] = [];
  profiles: AdminProfile[] = [];
  activity: ActivityLog[] = [];
  telegramUpdates = new Set<string>();
  settings: AppSettings = { ...DEFAULT_SETTINGS };
  companySources: CompanySource[] = [];
  nextPublicationNumber = 1;
  nextJobCode = 1;
  portfolioDiscoveryState = new Map<string, import('./types').PortfolioDiscoveryState>();
  private portfolioNotificationClaims = new Set<string>();
  private portfolioAdminChats = new Map<number, number>();
  private portfolioSearchRuns: PortfolioSearchRun[] = [];
  private linkedinQueue = new Map<string, { status: 'queued' | 'sending' | 'sent' | 'acknowledged' | 'failed'; batch_number: number | null; telegram_message_id: number | null; attempts: number; last_error: string | null; retryable: boolean; created_at: string }>();
  private nextLinkedInBatch = 1;

  /* categories */
  async listCategories(opts: { activeOnly?: boolean } = {}): Promise<Category[]> {
    return this.categories
      .filter((c) => (opts.activeOnly === false ? true : c.is_active))
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }

  async listCategoriesWithCounts(): Promise<CategoryWithCount[]> {
    return (await this.listCategories()).map((c) => ({
      ...c,
      opportunity_count: this.live().filter((o) => o.category_id === c.id).length,
    }));
  }

  async getCategoryBySlug(slug: string): Promise<Category | null> {
    return this.categories.find((c) => c.slug === slug) ?? null;
  }

  async getCategoryById(catId: string): Promise<Category | null> {
    return this.categories.find((c) => c.id === catId) ?? null;
  }

  async createCategory(input: Omit<Category, 'id' | 'created_at' | 'updated_at'>): Promise<Category> {
    if (this.categories.some((c) => c.slug === input.slug)) throw new Error('Category slug already exists.');
    const category: Category = { ...input, id: id(), created_at: now(), updated_at: now() };
    this.categories.push(category);
    return category;
  }

  async updateCategory(catId: string, patch: Partial<Category>): Promise<Category> {
    const index = this.categories.findIndex((c) => c.id === catId);
    if (index < 0) throw new Error('Category not found');
    this.categories[index] = { ...this.categories[index], ...patch, updated_at: now() };
    return this.categories[index];
  }

  /* companies */
  async listCompanies(opts: { q?: string; limit?: number } = {}): Promise<Company[]> {
    return this.companies
      .filter((c) => !opts.q || c.name.toLowerCase().includes(opts.q.toLowerCase()))
      .sort((a, b) => Number(b.verified) - Number(a.verified) || a.name.localeCompare(b.name))
      .slice(0, opts.limit ?? 200);
  }

  async getCompanyById(companyId: string): Promise<Company | null> {
    return this.companies.find((c) => c.id === companyId) ?? null;
  }

  async findCompanyByName(name: string): Promise<Company | null> {
    return this.companies.find((c) => c.name.toLowerCase() === name.trim().toLowerCase()) ?? null;
  }

  async createCompany(input: {
    name: string;
    slug: string;
    website?: string | null;
    careers_url?: string | null;
    description?: string | null;
    verified?: boolean;
  }): Promise<Company> {
    if (this.companies.some((c) => c.name.toLowerCase() === input.name.toLowerCase())) {
      throw new Error('A company with this name already exists.');
    }
    const company: Company = {
      id: id(),
      name: input.name,
      slug: input.slug,
      website: input.website ?? null,
      careers_url: input.careers_url ?? null,
      description: input.description ?? null,
      logo_url: null,
      verified: input.verified ?? false,
      created_at: now(),
      updated_at: now(),
    };
    this.companies.push(company);
    return company;
  }

  async updateCompany(companyId: string, patch: Partial<Company>): Promise<Company> {
    const index = this.companies.findIndex((c) => c.id === companyId);
    if (index < 0) throw new Error('Company not found');
    this.companies[index] = { ...this.companies[index], ...patch, updated_at: now() };
    return this.companies[index];
  }

  /* opportunities */
  private withRelations(o: Opportunity): OpportunityWithRelations {
    const company = this.companies.find((c) => c.id === o.company_id);
    const category = this.categories.find((c) => c.id === o.category_id);
    return {
      ...o,
      company: company
        ? {
            id: company.id,
            name: company.name,
            slug: company.slug,
            website: company.website,
            careers_url: company.careers_url,
            description: company.description,
            verified: company.verified,
          }
        : null,
      category: category ? { id: category.id, slug: category.slug, name: category.name } : null,
    };
  }

  private live(): Opportunity[] {
    const today = new Date().toISOString().slice(0, 10);
    return this.opportunities.filter(
      (o) => o.status === 'published' && !o.closed_at && o.published_at && (!o.deadline || o.deadline >= today),
    );
  }

  async searchPublic(filters: SearchFilters): Promise<SearchResult> {
    const q = (filters.q ?? '').trim().toLowerCase();
    let rows = this.live().filter((o) => {
      const company = this.companies.find((c) => c.id === o.company_id);
      const category = this.categories.find((c) => c.id === o.category_id);
      if (filters.category && category?.slug !== filters.category) return false;
      if (filters.country && (o.country ?? '').toLowerCase() !== filters.country.toLowerCase() && (o.country_code ?? '').toUpperCase() !== filters.country.toUpperCase()) return false;
      if (filters.city && (o.city ?? '').toLowerCase() !== filters.city.toLowerCase()) return false;
      if (filters.workMode?.length && !filters.workMode.includes(o.work_mode)) return false;
      if (filters.employmentType?.length && !filters.employmentType.includes(o.employment_type)) return false;
      if (filters.salaryDisclosed && o.salary_min == null && o.salary_max == null) return false;
      if (filters.currency && o.currency !== filters.currency) return false;
      if (filters.experience === 'entry' && (o.experience_min_years ?? 0) > 2) return false;
      if (filters.experience === 'mid' && ((o.experience_min_years ?? 0) < 2 || (o.experience_min_years ?? 0) > 5)) return false;
      if (filters.experience === 'senior' && (o.experience_min_years ?? 0) < 5) return false;
      if (q) {
        const haystack = [o.title, o.summary ?? '', o.city ?? '', o.country ?? '', ...o.skills, company?.name ?? '', category?.name ?? '']
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    if (filters.sort === 'oldest') rows = rows.sort((a, b) => a.discovered_at.localeCompare(b.discovered_at));
    else if (filters.sort === 'source_date')
      rows = rows.sort((a, b) => (b.original_posted_at ?? '').localeCompare(a.original_posted_at ?? ''));
    else rows = rows.sort((a, b) => b.discovered_at.localeCompare(a.discovered_at));

    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(48, Math.max(1, filters.pageSize ?? 12));
    const total = rows.length;
    const items = rows.slice((page - 1) * pageSize, page * pageSize).map((o) => this.withRelations(o));
    return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async listAdmin(filters: AdminOpportunityFilters): Promise<SearchResult> {
    const q = (filters.q ?? '').trim().toLowerCase();
    let rows = this.opportunities.filter((o) => {
      if (filters.status && o.status !== filters.status) return false;
      if (filters.category) {
        const category = this.categories.find((c) => c.id === o.category_id);
        if (category?.slug !== filters.category) return false;
      }
      if (q) {
        const company = this.companies.find((c) => c.id === o.company_id);
        const haystack = [o.title, o.city ?? '', o.country ?? '', company?.name ?? '', o.source_url ?? ''].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    if (filters.sort === 'oldest') rows = rows.sort((a, b) => a.discovered_at.localeCompare(b.discovered_at));
    else if (filters.sort === 'title') rows = rows.sort((a, b) => a.title.localeCompare(b.title));
    else if (filters.sort === 'updated') rows = rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    else rows = rows.sort((a, b) => b.discovered_at.localeCompare(a.discovered_at));

    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
    const total = rows.length;
    return {
      items: rows.slice((page - 1) * pageSize, page * pageSize).map((o) => this.withRelations(o)),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async getOpportunityById(oppId: string): Promise<OpportunityWithRelations | null> {
    const found = this.opportunities.find((o) => o.id === oppId);
    return found ? this.withRelations(found) : null;
  }

  async getOpportunityBySlug(slug: string): Promise<OpportunityWithRelations | null> {
    const found = this.opportunities.find((o) => o.slug === slug);
    return found ? this.withRelations(found) : null;
  }

  async getOpportunityByJobCode(jobCode: string): Promise<OpportunityWithRelations | null> {
    const found = this.opportunities.find((o) => o.job_code?.toUpperCase() === jobCode.toUpperCase());
    return found ? this.withRelations(found) : null;
  }

  async createOpportunity(draft: OpportunityDraft): Promise<Opportunity> {
    if (this.opportunities.some((o) => o.slug === draft.slug)) throw new Error('Slug already exists.');
    const openingKey = draft.opening_key ?? 1;
    if (
      draft.canonical_source_key &&
      this.opportunities.some(
        (o) =>
          o.canonical_source_key === draft.canonical_source_key &&
          o.opening_key === openingKey &&
          !['archived', 'rejected'].includes(o.status),
      )
    ) {
      throw new Error('Source already captured.');
    }
    const discoveredAt = draft.discovered_at ?? now();
    const expiresAt = draft.expires_at ?? new Date(Date.parse(discoveredAt) + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const created: Opportunity = {
      ...draft,
      job_code: draft.job_code ?? `HC-${String(this.nextJobCode++).padStart(6, '0')}`,
      education_requirements: draft.education_requirements ?? [],
      benefits: draft.benefits ?? [],
      languages: draft.languages ?? [],
      recruiter_name: draft.recruiter_name ?? null,
      quality_flags: draft.quality_flags ?? [],
      completeness_score: draft.completeness_score ?? null,
      id: id(),
      discovered_at: discoveredAt,
      expires_at: expiresAt,
      published_at: draft.published_at ?? null,
      closed_at: draft.closed_at ?? null,
      created_by: draft.created_by ?? null,
      created_at: now(),
      updated_at: now(),
      opening_key: openingKey,
      publication_number:
        draft.status === 'published'
          ? draft.publication_number ?? this.nextPublicationNumber++
          : (draft.publication_number ?? null),
    };
    this.opportunities.push(created);
    return created;
  }

  async getPortfolioDiscoveryState(sourceId: string) {
    return this.portfolioDiscoveryState.get(sourceId) ?? null;
  }

  async updatePortfolioDiscoveryState(state: import('./types').PortfolioDiscoveryState): Promise<void> {
    this.portfolioDiscoveryState.set(state.source_id, state);
  }

  async listUnnotifiedPortfolioOpportunities(limit = 20): Promise<OpportunityWithRelations[]> {
    return this.opportunities
      .filter((o) => o.is_portfolio_discovered && o.status === 'published' && Boolean(o.published_at) && !o.portfolio_notified_at)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(0, Math.min(100, limit))
      .map((o) => this.withRelations(o));
  }

  async claimPortfolioNotification(opportunityId: string): Promise<boolean> {
    const opportunity = this.opportunities.find((item) => item.id === opportunityId);
    if (!opportunity || !opportunity.is_portfolio_discovered || opportunity.status !== 'published' || !opportunity.published_at || opportunity.portfolio_notified_at || this.portfolioNotificationClaims.has(opportunityId)) return false;
    this.portfolioNotificationClaims.add(opportunityId);
    opportunity.portfolio_notification_claimed_at = now();
    return true;
  }

  async updateOpportunity(oppId: string, patch: Partial<Opportunity>): Promise<Opportunity> {
    const index = this.opportunities.findIndex((o) => o.id === oppId);
    if (index < 0) throw new Error('Opportunity not found');
    const existing = this.opportunities[index];
    let pubNumber = patch.publication_number !== undefined ? patch.publication_number : existing.publication_number;
    if (patch.status === 'published' && !pubNumber) {
      pubNumber = this.nextPublicationNumber++;
    }
    const safePatch = { ...patch };
    delete safePatch.discovered_at;
    delete safePatch.expires_at;
    this.opportunities[index] = {
      ...existing,
      ...safePatch,
      discovered_at: existing.discovered_at,
      expires_at: existing.expires_at,
      publication_number: pubNumber,
      updated_at: now(),
    };
    if ('portfolio_notification_error' in patch || 'portfolio_notified_at' in patch) {
      this.portfolioNotificationClaims.delete(oppId);
      this.opportunities[index].portfolio_notification_claimed_at = null;
    }
    return this.opportunities[index];
  }

  async deleteOpportunity(oppId: string): Promise<void> {
    this.opportunities = this.opportunities.filter((o) => o.id !== oppId);
    this.comments = this.comments.filter((c) => c.opportunity_id !== oppId);
    this.reports = this.reports.filter((r) => r.opportunity_id !== oppId);
  }

  async homepage(limit = 6): Promise<HomeData> {
    const live = this.live().sort((a, b) => b.discovered_at.localeCompare(a.discovered_at));
    const shaped = live.map((o) => this.withRelations(o));
    const categories = await this.listCategoriesWithCounts();
    const locationMap = new Map<string, LocationCount>();
    for (const o of live) {
      if (!o.city) continue;
      const key = `${o.city}::${o.country ?? ''}`;
      const existing = locationMap.get(key);
      if (existing) existing.count += 1;
      else
        locationMap.set(key, {
          city: o.city,
          country: o.country,
          count: 1,
          slug: `${slugify(o.city)}${o.country ? `-${slugify(o.country)}` : ''}`,
        });
    }
    return {
      latest: shaped.slice(0, limit),
      recentlyDiscovered: shaped.slice(0, limit),
      remote: shaped.filter((o) => o.work_mode === 'remote').slice(0, limit),
      internships: shaped.filter((o) => o.employment_type === 'internship').slice(0, limit),
      featured: shaped.filter((o) => o.is_featured).slice(0, limit),
      categories,
      locations: [...locationMap.values()].sort((a, b) => b.count - a.count).slice(0, 8),
      totalPublished: live.length,
    };
  }

  async recentDuplicateCandidates(limit = 200, excludeCaptureId?: string | null): Promise<DuplicateCandidate[]> {
    return this.opportunities
      .filter((o) => !['archived', 'rejected'].includes(o.status))
      .filter((o) => !excludeCaptureId || o.source_capture_id !== excludeCaptureId)
      .slice(0, limit)
      .map((o) => ({
        id: o.id,
        title: o.title,
        companyName: this.companies.find((c) => c.id === o.company_id)?.name ?? null,
        source_url: o.source_url,
        normalized_source_key: o.canonical_source_key,
        original_posted_at: o.original_posted_at,
        discovered_at: o.discovered_at,
      }));
  }

  async findOpportunityBySourceKey(key: string): Promise<Opportunity | null> {
    return this.opportunities.find((o) => o.canonical_source_key === key) ?? null;
  }

  async findOpportunityByOpening(sourceKey: string, openingKey: number): Promise<Opportunity | null> {
    return (
      this.opportunities.find(
        (o) => o.canonical_source_key === sourceKey && o.opening_key === openingKey,
      ) ?? null
    );
  }

  async listPublicSlugs(): Promise<{ slug: string; updated_at: string }[]> {
    return this.live().map((o) => ({ slug: o.job_code ?? o.slug, updated_at: o.updated_at }));
  }

  async listLocations(): Promise<LocationCount[]> {
    const home = await this.homepage(1);
    const map = new Map<string, LocationCount>();
    for (const o of this.live()) {
      if (!o.city) continue;
      const key = `${o.city}::${o.country ?? ''}`;
      const slug = `${slugify(o.city)}${o.country ? `-${slugify(o.country)}` : ''}`;
      const existing = map.get(key);
      if (existing) existing.count += 1;
      else map.set(key, { city: o.city, country: o.country, count: 1, slug });
    }
    void home;
    return [...map.values()].sort((a, b) => b.count - a.count);
  }

  async listCountries(): Promise<{ country: string; count: number }[]> {
    const counts = new Map<string, number>();
    for (const o of this.live()) {
      if (!o.country) continue;
      counts.set(o.country, (counts.get(o.country) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));
  }

  async needsVerification(days: number): Promise<OpportunityWithRelations[]> {
    const cutoff = Date.now() - days * 86_400_000;
    return this.opportunities
      .filter(
        (o) =>
          o.status === 'published' &&
          (!o.last_verified_at ||
            Date.parse(o.last_verified_at) < cutoff ||
            ['needs_verification', 'uncertain', 'source_closed'].includes(o.verification_status)),
      )
      .map((o) => this.withRelations(o));
  }

  /* captures */
  async createCapture(input: Parameters<Store['createCapture']>[0]): Promise<SourceCapture> {
    if (
      input.normalized_source_key &&
      this.captures.some(
        (c) => c.normalized_source_key === input.normalized_source_key && !['rejected', 'extraction_failed'].includes(c.status),
      )
    ) {
      throw new Error('Duplicate source: this URL has already been captured.');
    }
    const capture: SourceCapture = {
      id: id(),
      source_url: input.source_url,
      normalized_source_key: input.normalized_source_key ?? '',
      source_post_id: input.source_post_id ?? null,
      source_type: input.source_type,
      raw_text: input.raw_text,
      submitted_company: input.submitted_company ?? null,
      notes: input.notes ?? null,
      status: input.status ?? 'received',
      error_message: null,
      extraction: null,
      extraction_confidence: null,
      attempt_count: 0,
      processing_started_at: null,
      opportunity_id: null,
      created_by: input.created_by,
      retrieval_status: input.retrieval_status ?? 'pending',
      retrieval_method: input.retrieval_method ?? null,
      retrieval_http_status: input.retrieval_http_status ?? null,
      retrieval_error_code: input.retrieval_error_code ?? null,
      retrieval_attempts: input.retrieval_attempts ?? 0,
      retrieved_at: input.retrieved_at ?? null,
      next_retry_at: input.next_retry_at ?? null,
      source_author: input.source_author ?? null,
      source_posted_at: input.source_posted_at ?? null,
      source_metadata: input.source_metadata ?? null,
      source_comments: input.source_comments ?? null,
      telegram_user_id: input.telegram_user_id ?? null,
      telegram_chat_id: input.telegram_chat_id ?? null,
      telegram_message_id: input.telegram_message_id ?? null,
      created_at: now(),
      updated_at: now(),
    };
    this.captures.push(capture);
    return capture;
  }

  async getCapture(captureId: string): Promise<SourceCapture | null> {
    return this.captures.find((c) => c.id === captureId) ?? null;
  }

  async getCaptureBySourceKey(key: string): Promise<SourceCapture | null> {
    return this.captures.find((c) => c.normalized_source_key === key) ?? null;
  }

  async updateCapture(captureId: string, patch: Partial<SourceCapture>): Promise<SourceCapture> {
    const index = this.captures.findIndex((c) => c.id === captureId);
    if (index < 0) throw new Error('Capture not found');
    this.captures[index] = { ...this.captures[index], ...patch, updated_at: now() };
    return this.captures[index];
  }

  async listCaptures(filters: CaptureFilters): Promise<{ items: SourceCapture[]; total: number }> {
    let rows = [...this.captures];
    if (filters.status) rows = rows.filter((c) => c.status === filters.status);
    if (filters.q) {
      const q = filters.q.toLowerCase();
      rows = rows.filter((c) =>
        [c.source_url ?? '', c.submitted_company ?? '', c.raw_text].join(' ').toLowerCase().includes(q),
      );
    }
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
    return { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length };
  }

  async purgeExpiredSourceText(olderThanDays: number): Promise<number> {
    const cutoff = Date.now() - Math.max(1, olderThanDays) * 86_400_000;
    let purged = 0;
    for (const capture of this.captures) {
      if (
        Date.parse(capture.created_at) < cutoff &&
        capture.opportunity_id &&
        ['approved', 'rejected', 'published'].includes(capture.status) &&
        (capture.raw_text || capture.extraction || capture.source_comments || capture.source_metadata)
      ) {
        capture.raw_text = '';
        capture.extraction = null;
        capture.source_comments = null;
        capture.source_metadata = null;
        capture.updated_at = now();
        purged += 1;
      }
    }
    return purged;
  }

  async findAwaitingCapture(telegramUserId: number, maxAgeMinutes: number): Promise<SourceCapture | null> {
    const cutoff = Date.now() - maxAgeMinutes * 60_000;
    return (
      this.captures
        .filter(
          (c) =>
            c.telegram_user_id === telegramUserId &&
            ['awaiting_text', 'retrieval_failed'].includes(c.status) &&
            Date.parse(c.created_at) >= cutoff,
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
    );
  }

  async claimDueRetrievals(limit: number): Promise<SourceCapture[]> {
    const nowMs = Date.now();
    const due = this.captures
      .filter(
        (c) =>
          c.status === 'retrieval_failed' &&
          c.retrieval_attempts < 4 &&
          Boolean(c.next_retry_at) &&
          Date.parse(c.next_retry_at as string) <= nowMs,
      )
      .sort((a, b) => (a.next_retry_at ?? a.created_at).localeCompare(b.next_retry_at ?? b.created_at))
      .slice(0, Math.max(1, Math.min(limit, 25)));
    for (const capture of due) {
      capture.status = 'retrieving';
      capture.retrieval_attempts += 1;
      capture.processing_started_at = now();
      capture.updated_at = now();
    }
    return due;
  }

  async recoverStaleRetrieving(olderThanSeconds: number): Promise<number> {
    const cutoff = Date.now() - Math.max(30, olderThanSeconds) * 1000;
    let recovered = 0;
    for (const capture of this.captures) {
      if (
        capture.status === 'retrieving' &&
        capture.processing_started_at &&
        Date.parse(capture.processing_started_at) < cutoff
      ) {
        capture.status = 'retrieval_failed';
        capture.retrieval_status = 'failed';
        capture.retrieval_error_code = 'stale_recovered';
        capture.error_message =
          'Retrieval stopped before it finished (worker restart). The URL was preserved and the capture was re-queued.';
        capture.next_retry_at = now();
        capture.updated_at = now();
        recovered += 1;
      }
    }
    return recovered;
  }

  async recoverStaleExtracting(olderThanSeconds: number): Promise<number> {
    const cutoff = Date.now() - Math.max(60, olderThanSeconds) * 1000;
    let recovered = 0;
    for (const capture of this.captures) {
      if (
        capture.status === 'extracting' &&
        capture.processing_started_at &&
        Date.parse(capture.processing_started_at) < cutoff
      ) {
        capture.status = 'extraction_failed';
        capture.error_message =
          'Extraction stopped before it finished (worker restart). The source was preserved and extraction can be retried.';
        capture.processing_started_at = null;
        capture.updated_at = now();
        recovered += 1;
      }
    }
    return recovered;
  }

  /* comments */
  async replaceComments(
    opportunityId: string,
    comments: CommentSetInput[],
    opts: { generatedBy?: 'template' | 'ai'; selectedStyle?: GeneratedComment['style'] } = {},
  ): Promise<GeneratedComment[]> {
    const version = this.comments.filter((c) => c.opportunity_id === opportunityId).reduce((max, c) => Math.max(max, c.version), 0) + 1;
    for (const c of this.comments) if (c.opportunity_id === opportunityId) c.is_selected = false;
    const selectedStyle = opts.selectedStyle ?? 'professional';
    const created = comments.map<GeneratedComment>((c) => ({
      id: id(),
      opportunity_id: opportunityId,
      style: c.style,
      body: c.body,
      is_selected: c.style === selectedStyle,
      manually_posted: false,
      generated_by: opts.generatedBy ?? 'template',
      version,
      includes_listing_url: c.includesListingUrl,
      created_at: now(),
      updated_at: now(),
    }));
    this.comments.push(...created);
    return created;
  }

  async listComments(opportunityId: string): Promise<GeneratedComment[]> {
    return this.comments
      .filter((c) => c.opportunity_id === opportunityId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async getComment(commentId: string): Promise<GeneratedComment | null> {
    return this.comments.find((c) => c.id === commentId) ?? null;
  }

  async updateComment(
    commentId: string,
    patch: Partial<Pick<GeneratedComment, 'body' | 'is_selected' | 'manually_posted'>>,
  ): Promise<GeneratedComment> {
    const comment = this.comments.find((c) => c.id === commentId);
    if (!comment) throw new Error('Comment not found');
    if (patch.is_selected) await this.clearCommentSelection(comment.opportunity_id);
    Object.assign(comment, patch, { updated_at: now() });
    return comment;
  }

  async listCommentQueue(limit = 100): Promise<CommentWithOpportunity[]> {
    return this.comments
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map((c) => {
        const opp = this.opportunities.find((o) => o.id === c.opportunity_id);
        return {
          ...c,
          opportunity: {
            id: opp?.id ?? c.opportunity_id,
            slug: opp?.slug ?? '',
            title: opp?.title ?? 'Untitled',
            status: opp?.status ?? 'draft',
            company_id: opp?.company_id ?? null,
          },
        };
      });
  }

  async clearCommentSelection(opportunityId: string): Promise<void> {
    for (const c of this.comments) if (c.opportunity_id === opportunityId) c.is_selected = false;
  }

  /* reports */
  async createReport(input: Parameters<Store['createReport']>[0]): Promise<Report> {
    const report: Report = {
      id: id(),
      ...input,
      details: input.details ?? null,
      contact_email: input.contact_email ?? null,
      status: 'open',
      resolution_note: null,
      created_at: now(),
      resolved_at: null,
    };
    this.reports.push(report);
    return report;
  }

  async listReports(status?: Report['status'] | ''): Promise<ReportWithOpportunity[]> {
    return this.reports
      .filter((r) => !status || r.status === status)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((r) => {
        const opp = this.opportunities.find((o) => o.id === r.opportunity_id);
        return {
          ...r,
          opportunity: opp ? { id: opp.id, slug: opp.slug, title: opp.title, status: opp.status } : null,
        };
      });
  }

  async getReport(reportId: string): Promise<ReportWithOpportunity | null> {
    return (await this.listReports()).find((r) => r.id === reportId) ?? null;
  }

  async updateReport(reportId: string, patch: Partial<Report>): Promise<Report> {
    const index = this.reports.findIndex((r) => r.id === reportId);
    if (index < 0) throw new Error('Report not found');
    this.reports[index] = { ...this.reports[index], ...patch };
    return this.reports[index];
  }

  /* events */
  async recordEvents(
    events: { opportunity_id?: string | null; event_type: string; metadata?: Record<string, unknown> | null }[],
  ): Promise<void> {
    for (const e of events) {
      this.events.push({
        id: id(),
        opportunity_id: e.opportunity_id ?? null,
        event_type: e.event_type as OpportunityEvent['event_type'],
        metadata: e.metadata ?? null,
        created_at: now(),
      });
    }
  }

  async analytics(days: number): Promise<AnalyticsSummary> {
    const cutoff = Date.now() - days * 86_400_000;
    const events = this.events.filter((e) => Date.parse(e.created_at) >= cutoff);
    const count = (type: string) => events.filter((e) => e.event_type === type).length;
    const topMap = new Map<string, number>();
    for (const e of events) {
      if (!e.opportunity_id) continue;
      if (!['view', 'apply_click', 'email_click', 'source_click', 'careers_click'].includes(e.event_type)) continue;
      topMap.set(e.opportunity_id, (topMap.get(e.opportunity_id) ?? 0) + 1);
    }
    const topOpportunities = [...topMap.entries()]
      .map(([oppId, n]) => {
        const opp = this.opportunities.find((o) => o.id === oppId);
        return { id: oppId, title: opp?.title ?? 'Unknown', slug: opp?.slug ?? '', count: n };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const catMap = new Map<string, number>();
    for (const e of events) {
      if (!['view', 'apply_click'].includes(e.event_type)) continue;
      const opp = this.opportunities.find((o) => o.id === e.opportunity_id);
      if (!opp?.category_id) continue;
      catMap.set(opp.category_id, (catMap.get(opp.category_id) ?? 0) + 1);
    }
    const topCategories = [...catMap.entries()]
      .map(([catId, n]) => {
        const cat = this.categories.find((c) => c.id === catId);
        return { name: cat?.name ?? 'Unknown', slug: cat?.slug ?? '', count: n };
      })
      .sort((a, b) => b.count - a.count);

    const publicationTrend: { date: string; count: number }[] = [];
    const dailyEvents: { date: string; views: number; applyClicks: number }[] = [];
    for (let i = 29; i >= 0; i -= 1) {
      const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      publicationTrend.push({
        date,
        count: this.opportunities.filter((o) => o.published_at?.slice(0, 10) === date).length,
      });
      dailyEvents.push({
        date,
        views: events.filter((e) => e.event_type === 'view' && e.created_at.slice(0, 10) === date).length,
        applyClicks: events.filter((e) => e.event_type === 'apply_click' && e.created_at.slice(0, 10) === date).length,
      });
    }

    const searchCounts = new Map<string, number>();
    for (const e of events) {
      if (e.event_type !== 'search') continue;
      const query = String(e.metadata?.query ?? '').trim().toLowerCase();
      if (!query) continue;
      searchCounts.set(query, (searchCounts.get(query) ?? 0) + 1);
    }

    return {
      views: count('view'),
      applyClicks: count('apply_click'),
      emailClicks: count('email_click'),
      sourceClicks: count('source_click'),
      careersClicks: count('careers_click'),
      shares: count('share'),
      searches: count('search'),
      topOpportunities,
      topCategories,
      publicationTrend,
      dailyEvents,
      topSearches: [...searchCounts.entries()]
        .map(([query, n]) => ({ query, count: n }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
    };
  }

  /* admin */
  async adminStats(): Promise<AdminStatistics> {
    const byStatus = (status: Opportunity['status']) => this.opportunities.filter((o) => o.status === status).length;
    const today = new Date().toISOString().slice(0, 10);
    return {
      total: this.opportunities.length,
      published: byStatus('published'),
      pending_review: byStatus('pending_review'),
      draft: byStatus('draft'),
      closed: byStatus('closed'),
      expired: byStatus('expired'),
      rejected: byStatus('rejected'),
      archived: byStatus('archived'),
      added_today: this.opportunities.filter((o) => o.created_at.slice(0, 10) === today).length,
      published_today: this.opportunities.filter((o) => o.published_at?.slice(0, 10) === today).length,
      needs_verification: (await this.needsVerification(this.settings.verification_reminder_days)).length,
      duplicate_captures: this.captures.filter((c) => {
        if (!c.normalized_source_key) return false;
        return this.captures.filter((other) => other.normalized_source_key === c.normalized_source_key).length > 1;
      }).length,
      open_reports: this.reports.filter((r) => ['open', 'reviewing'].includes(r.status)).length,
      total_captures: this.captures.length,
    };
  }

  async getProfile(userId: string): Promise<AdminProfile | null> {
    return this.profiles.find((p) => p.user_id === userId) ?? null;
  }

  async logActivity(log: {
    actor: string;
    action: string;
    entity_type: string;
    entity_id?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    this.activity.unshift({
      id: id(),
      actor: log.actor,
      action: log.action,
      entity_type: log.entity_type,
      entity_id: log.entity_id ?? null,
      metadata: log.metadata ?? null,
      created_at: now(),
    });
  }

  async listActivity(limit = 50): Promise<ActivityLog[]> {
    return this.activity.slice(0, limit);
  }

  async claimTelegramUpdate(updateId: number, _telegramUserId?: number | null, _updateType?: string | null, botKey: 'capture' | 'portfolio' = 'capture'): Promise<boolean> {
    const key = `${botKey}:${updateId}`;
    if (this.telegramUpdates.has(key)) return false;
    this.telegramUpdates.add(key);
    return true;
  }

  async getPortfolioAdminChat(telegramUserId: number): Promise<number | null> { return this.portfolioAdminChats.get(telegramUserId) ?? null; }
  async setPortfolioAdminChat(telegramUserId: number, chatId: number): Promise<void> { this.portfolioAdminChats.set(telegramUserId, chatId); }
  async isPortfolioChatVerified(chatId: number): Promise<boolean> { return [...this.portfolioAdminChats.values()].includes(chatId); }
  async startPortfolioSearch(requestedBy: number, fullBackfill: boolean): Promise<string | null> {
    if (this.portfolioSearchRuns.some((run) => run.status === 'running')) return null;
    const run: PortfolioSearchRun = { id: id(), requested_by: requestedBy, status: 'running', full_backfill: fullBackfill, started_at: now(), finished_at: null, report: {} };
    this.portfolioSearchRuns.unshift(run);
    return run.id;
  }
  async finishPortfolioSearch(runId: string, status: 'completed' | 'partial' | 'failed', report: Record<string, unknown>): Promise<void> {
    const run = this.portfolioSearchRuns.find((item) => item.id === runId);
    if (run) Object.assign(run, { status, finished_at: now(), report });
  }
  async updatePortfolioSearchProgress(runId: string, report: Record<string, unknown>): Promise<void> {
    const run = this.portfolioSearchRuns.find((item) => item.id === runId);
    if (run) run.report = { ...report };
  }
  async latestPortfolioSearch(): Promise<PortfolioSearchRun | null> { return this.portfolioSearchRuns[0] ?? null; }
  async enqueueLinkedInPost(opportunityId: string): Promise<boolean> {
    const opportunity = this.opportunities.find((item) => item.id === opportunityId);
    if (!opportunity || opportunity.status !== 'published' || !opportunity.published_at || !opportunity.linkedin_post_draft || this.linkedinQueue.has(opportunityId)) return false;
    this.linkedinQueue.set(opportunityId, { status: 'queued', batch_number: null, telegram_message_id: null, attempts: 0, last_error: null, retryable: true, created_at: now() });
    return true;
  }
  async claimNextLinkedInDeliveryBatch(limit = 30): Promise<LinkedInDeliveryItem[]> {
    const active = [...this.linkedinQueue.values()].find((item) => item.batch_number !== null && ['sent', 'failed', 'sending'].includes(item.status));
    const batch = active?.batch_number ?? this.nextLinkedInBatch++;
    const rows = [...this.linkedinQueue.entries()].filter(([, item]) => active
      ? item.batch_number === batch && item.status === 'failed' && item.retryable
      : item.status === 'queued').slice(0, Math.max(1, Math.min(30, limit)));
    for (const [, item] of rows) { item.status = 'sending'; item.batch_number = batch; item.attempts += 1; }
    return rows.map(([opportunity_id]) => ({ opportunity_id, batch_number: batch }));
  }
  async setLinkedInDeliveryState(opportunityId: string, state: 'sent' | 'failed', details: { telegramMessageId?: number; error?: string; retryable?: boolean } = {}): Promise<void> {
    const item = this.linkedinQueue.get(opportunityId);
    if (!item) return;
    item.status = state;
    item.telegram_message_id = details.telegramMessageId ?? item.telegram_message_id;
    item.last_error = details.error ?? null;
    item.retryable = details.retryable ?? false;
  }
  async prepareLinkedInDeliveryRetry(batchNumber: number): Promise<void> {
    for (const item of this.linkedinQueue.values()) if (item.batch_number === batchNumber && item.status === 'failed') item.retryable = true;
  }
  async acknowledgeLinkedInDeliveryBatch(batchNumber: number): Promise<boolean> {
    const rows = [...this.linkedinQueue.values()].filter((item) => item.batch_number === batchNumber);
    if (!rows.length || rows.some((item) => item.status === 'failed' || item.status === 'sending') || !rows.some((item) => item.status === 'sent')) return false;
    for (const item of rows) if (item.status === 'sent') item.status = 'acknowledged';
    return true;
  }
  async currentLinkedInDeliveryBatch(): Promise<number | null> {
    return [...this.linkedinQueue.values()].find((item) => item.batch_number !== null && ['sent', 'failed', 'sending'].includes(item.status))?.batch_number ?? null;
  }
  async linkedinDeliveryCounts(): Promise<LinkedInDeliveryCounts> {
    const counts: LinkedInDeliveryCounts = { queued: 0, sending: 0, sent: 0, acknowledged: 0, failed: 0 };
    for (const item of this.linkedinQueue.values()) counts[item.status] += 1;
    return counts;
  }
  async countPublishedWithoutLinkedInDraft(): Promise<number> {
    return this.opportunities.filter((item) => item.status === 'published' && Boolean(item.published_at) && !item.linkedin_post_draft).length;
  }

  async getSettings(): Promise<AppSettings> {
    return { ...this.settings };
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = { ...this.settings, ...patch };
    return { ...this.settings };
  }

  async expireStaleOpportunities(): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    const stale = this.opportunities.filter((item) => item.status === 'published' && Boolean(item.expires_at) && item.expires_at! <= today);
    for (const item of stale) await this.updateOpportunity(item.id, { status: 'expired', closed_at: now() });
    return stale.length;
  }

  async activateNextCompanySourceBatch(): Promise<number> {
    return 0;
  }

  async listCompanySources(companyId?: string): Promise<CompanySource[]> {
    return this.companySources.filter((s) => !companyId || s.company_id === companyId);
  }

  async upsertCompanySource(input: {
    company_id: string;
    provider: CompanySource['provider'];
    board_identifier: string;
    source_url?: string | null;
    sync_status?: CompanySource['sync_status'];
  }): Promise<CompanySource> {
    const existing = this.companySources.find(
      (s) => s.provider === input.provider && s.board_identifier === input.board_identifier,
    );
    if (existing) {
      Object.assign(existing, input, { updated_at: now() });
      return existing;
    }
    const source: CompanySource = {
      id: id(),
      company_id: input.company_id,
      provider: input.provider,
      board_identifier: input.board_identifier,
      source_url: input.source_url ?? null,
      last_checked_at: null,
      next_check_at: null,
      sync_status: input.sync_status ?? 'idle',
      error_message: null,
      created_at: now(),
      updated_at: now(),
    };
    this.companySources.push(source);
    return source;
  }

  async recordCompanySourceSync(sourceId: string, status: 'ok' | 'error', error?: string | null): Promise<void> {
    const source = this.companySources.find((item) => item.id === sourceId);
    if (!source) return;
    source.sync_status = status;
    source.last_checked_at = now();
    source.error_message = error ?? null;
    source.updated_at = now();
  }

  /** Test helper: seed a duplicate candidate directly. */
  duplicateCheckFor(candidate: DuplicateCandidate) {
    return checkDuplicates(candidate, this.opportunities.map((o) => ({
      id: o.id,
      title: o.title,
      companyName: this.companies.find((c) => c.id === o.company_id)?.name ?? null,
      source_url: o.source_url,
      normalized_source_key: o.canonical_source_key,
      original_posted_at: o.original_posted_at,
      discovered_at: o.discovered_at,
    })));
  }
}
