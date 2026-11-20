import type { AppEnv } from '../env';
import type { CompanySource, OpportunityDraft, OpportunityWithRelations } from '../domain/types';
import { normalizeSourceUrl, safeOutboundUrl, slugify } from '../domain/url';
import type { Store } from '../store/types';

const TWO_DAYS = 48 * 60 * 60 * 1000;
const FIRST_SCAN_WINDOW = 48 * 60 * 60 * 1000;
const PAGE_SIZE = 100;

export const GETRO_SOURCES = [
  { id: 'entrepreneurs-first', name: 'Entrepreneurs First', boardUrl: 'https://portfolio.joinef.com/jobs' },
  { id: 'techstars', name: 'Techstars', boardUrl: 'https://jobs.techstars.com/jobs' },
  { id: 'a16z', name: 'a16z', boardUrl: 'https://jobs.a16z.com/companies' },
  { id: 'accel', name: 'Accel', boardUrl: 'https://jobs.accel.com/companies' },
] as const;

/** Confirmed Getro candidate boards. They remain disabled until each network's
 * owner-authorized API key and network ID are configured. */
export const GETRO_CANDIDATE_SOURCES = [
  { id: 'atomico', name: 'Atomico', boardUrl: 'https://careers.atomico.com/companies' },
  { id: 'index-ventures', name: 'Index Ventures', boardUrl: 'https://indexventures.getro.com/jobs' },
] as const;

/** These boards are recorded for investigation, but their public site does not
 * prove API ownership/permission and the existing Getro API cannot be assumed. */
export const INACTIVE_PORTFOLIO_CANDIDATES = [
  { id: 'antler', name: 'Antler', boardUrl: 'https://careers.antler.co/jobs', reason: 'API access method not verified.' },
  { id: 'hv-capital', name: 'HV Capital', boardUrl: 'https://jobs.hvcapital.com/jobs', reason: 'API access method not verified.' },
  { id: 'general-catalyst', name: 'General Catalyst', boardUrl: 'https://jobs.generalcatalyst.com/jobs', reason: 'API access method not verified.' },
  { id: 'creandum', name: 'Creandum', boardUrl: 'https://careers.creandum.com/jobs', reason: 'API access method not verified.' },
  { id: 'speedinvest', name: 'Speedinvest', boardUrl: 'https://careers.speedinvest.com/companies', reason: 'API access method not verified.' },
  { id: 'cherry-ventures', name: 'Cherry Ventures', boardUrl: 'https://talent.cherry.vc/jobs', reason: 'API access method not verified.' },
  { id: '500-global', name: '500 Global', boardUrl: 'https://jobs.500.co/jobs', reason: 'API access method not verified.' },
] as const;

const PUBLIC_SOURCES = [
  { id: 'jump-capital', name: 'Jump Capital', boardUrl: 'https://careers.jumpcap.com/' },
  { id: 'a-hub', name: 'A-Hub', boardUrl: 'https://jobb.a-hub.se/jobs' },
] as const;

type GetroJob = {
  id?: number | string;
  title?: string;
  url?: string;
  source_url?: string | null;
  description?: string | null;
  created_at?: string;
  expires_at?: string | null;
  closed_at?: string | null;
  status?: string | null;
  locations?: string[];
  work_mode?: string;
  employment_types?: string[];
  job_functions?: string[];
  skills?: string[];
  compensation_min?: number | null;
  compensation_max?: number | null;
  compensation_currency?: string | null;
  compensation_period?: string | null;
  company?: { id?: number; name?: string; slug?: string; domain?: string | null; website?: string | null; careers_url?: string | null };
};

type GetroPage = { items?: GetroJob[]; meta?: { total?: number } };
type DiscoveryStats = { duplicatesSkipped: number; qualitySkipped: number };

function cleanDescription(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(/<\/(p|li|div|h[1-6])\s*>/gi, '\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim()
    .slice(0, 1200) || null;
}

function employmentType(values: string[] | undefined): OpportunityDraft['employment_type'] {
  const value = values?.[0]?.toLowerCase().replace(/[ -]/g, '_');
  if (value === 'full_time' || value === 'part_time' || value === 'contract' || value === 'internship' || value === 'temporary') return value;
  return 'unspecified';
}

function workMode(value: string | undefined): OpportunityDraft['work_mode'] {
  const normalized = value?.toLowerCase().replace(/[ -]/g, '_');
  if (normalized === 'remote') return 'remote';
  if (normalized === 'hybrid') return 'hybrid';
  if (normalized === 'on_site' || normalized === 'onsite') return 'onsite';
  return 'unspecified';
}

function salaryPeriod(value: string | null | undefined): OpportunityDraft['salary_period'] {
  if (value === 'hour') return 'hourly';
  if (value === 'day') return 'daily';
  if (value === 'month') return 'monthly';
  if (value === 'year') return 'annual';
  return 'unspecified';
}

async function fingerprint(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value.trim().toLowerCase());
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function draftPost(job: GetroJob, companyName: string | null, sourceName: string, publicUrl: string): string {
  const location = job.locations?.filter(Boolean).join(' · ');
  const summary = cleanDescription(job.description);
  return [
    `🚀 ${job.title}${companyName ? ` at ${companyName}` : ''}`,
    location ? `📍 ${location}` : null,
    summary ? summary.slice(0, 220) : null,
    '',
    'Visit Hustler Community to review the details and apply using the Apply Now button:',
    publicUrl,
    '',
    `Source: ${sourceName}`,
    `#Hiring #${slugify(companyName ?? 'StartupJobs').replace(/-/g, '')} #StartupJobs`,
  ].filter((line): line is string => line !== null).join('\n');
}

async function fetchPage(
  networkId: number,
  page: number,
  createdAtFrom: string,
  apiKey: string,
  fetcher: typeof fetch,
): Promise<GetroPage> {
  const url = new URL(`https://api.getro.com/v2/networks/${networkId}/jobs`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', String(PAGE_SIZE));
  url.searchParams.set('created_at_from', createdAtFrom);
  url.searchParams.set('include_descriptions', 'true');
  const response = await fetcher(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Getro ${response.status} for configured source network ${networkId}.`);
  const payload = (await response.json()) as GetroPage;
  if (!payload || !Array.isArray(payload.items)) throw new Error(`Getro returned an invalid job list for network ${networkId}.`);
  return payload;
}

async function createFromJob(
  store: Store,
  source: { id: string; name: string; boardUrl: string },
  job: GetroJob,
  siteUrl: string,
  descriptionOverride?: string | null,
  stats?: DiscoveryStats,
): Promise<OpportunityWithRelations | null> {
  const title = job.title?.trim();
  const companyName = job.company?.name?.trim() || null;
  const applicationUrl = safeOutboundUrl(job.url);
  const externalId = job.id == null ? '' : String(job.id);
  if (!title || !applicationUrl || !externalId) return null;
  if (source.id.startsWith('company:') && shouldExcludeCompanyJob(title, job.description ?? descriptionOverride ?? '')) {
    if (stats) stats.qualitySkipped += 1;
    return null;
  }
  const currentStatus = job.status?.toLowerCase();
  if (currentStatus && ['closed', 'expired', 'inactive', 'archived', 'removed'].includes(currentStatus)) return null;
  const expiry = job.expires_at ?? job.closed_at;
  if (expiry && Date.parse(expiry) <= Date.now()) return null;

  const existing = await store.findOpportunityBySourceKey(`portfolio:${await fingerprint(normalizeSourceUrl(applicationUrl) ?? applicationUrl)}`);
  if (existing) {
    if (stats) stats.duplicatesSkipped += 1;
    if (existing.is_portfolio_discovered && !existing.linkedin_post_draft && existing.job_code) {
      const publicUrl = `${siteUrl.replace(/\/+$/, '')}/opportunities/${existing.job_code}`;
      await store.updateOpportunity(existing.id, {
        linkedin_post_draft: draftPost(job, companyName, source.name, publicUrl),
      });
    }
    return null;
  }
  const key = `portfolio:${await fingerprint(normalizeSourceUrl(applicationUrl) ?? applicationUrl)}`;

  let company = companyName ? await store.findCompanyByName(companyName) : null;
  if (companyName && !company) {
    const domain = job.company?.domain?.trim();
    const website = safeOutboundUrl(job.company?.website) ?? (domain && !domain.includes('/') ? safeOutboundUrl(`https://${domain}`) : null);
    const careersUrl = safeOutboundUrl(job.company?.careers_url);
    try {
      company = await store.createCompany({
        name: companyName,
        slug: `${slugify(companyName).slice(0, 60)}-${externalId.slice(-8)}`,
        website,
        careers_url: careersUrl,
        verified: false,
      });
    } catch {
      // A concurrent discovery can create this company between lookup and insert.
      company = await store.findCompanyByName(companyName);
      if (!company) throw new Error(`Could not create company record for ${companyName}.`);
    }
  }

  const location = job.locations?.filter(Boolean).join(' · ') || null;
  const posted = job.created_at && !Number.isNaN(Date.parse(job.created_at))
    ? new Date(job.created_at).toISOString().slice(0, 10)
    : null;
  const description = cleanDescription(descriptionOverride ?? job.description);
  const draft: OpportunityDraft = {
    slug: `${slugify(title)}-${slugify(companyName ?? source.id)}-${slugify(externalId)}`.slice(0, 140).replace(/-+$/g, '') || `portfolio-${slugify(externalId)}`,
    title,
    company_id: company?.id ?? null,
    category_id: null,
    summary: description,
    responsibilities: [],
    requirements: [],
    skills: job.skills?.filter(Boolean).slice(0, 25) ?? [],
    preferred_skills: [],
    education_requirements: [],
    benefits: [],
    languages: [],
    recruiter_name: null,
    location_text: location,
    city: null,
    country: null,
    country_code: null,
    work_mode: workMode(job.work_mode),
    employment_type: employmentType(job.employment_types),
    salary_min: typeof job.compensation_min === 'number' ? job.compensation_min : null,
    salary_max: typeof job.compensation_max === 'number' ? job.compensation_max : null,
    currency: /^[A-Z]{3}$/.test(job.compensation_currency ?? '') ? job.compensation_currency! : null,
    salary_period: salaryPeriod(job.compensation_period),
    experience_min_years: null,
    experience_max_years: null,
    application_method: 'external_url',
    application_url: applicationUrl,
    recruitment_email: null,
    careers_url: null,
    application_instructions: null,
    source_url: safeOutboundUrl(job.source_url) ?? source.boardUrl,
    source_type: 'company_website',
    source_capture_id: null,
    canonical_source_key: key,
    opening_key: 1,
    publication_number: null,
    deadline: null,
    original_posted_at: posted,
    original_date_precision: posted ? 'exact' : 'unknown',
    original_date_text: null,
    status: 'pending_review',
    verification_status: 'needs_verification',
    is_featured: false,
    quality_flags: ['portfolio_discovered', ...(description ? [] : ['source_description_missing'])],
    completeness_score: null,
    discovered_at: new Date().toISOString(),
    published_at: null,
    last_verified_at: null,
    closed_at: null,
    admin_notes: `Discovered from ${source.name}. Verify that the source and application page are still open before publishing.`,
    created_by: 'portfolio-discovery',
    linkedin_post_draft: null,
    is_portfolio_discovered: true,
  };

  let created;
  try {
    created = await store.createOpportunity(draft);
  } catch (error) {
    // The DB's canonical-source unique index is the final race-safe duplicate guard.
    if (error instanceof Error && /duplicate|already|unique/i.test(error.message)) {
      if (stats) stats.duplicatesSkipped += 1;
      return null;
    }
    throw error;
  }
  const jobCode = created.job_code;
  const publicUrl = `${siteUrl.replace(/\/+$/, '')}/opportunities/${jobCode ?? created.slug}`;
  const linkedinDraft = draftPost(job, companyName, source.name, publicUrl);
  await store.updateOpportunity(created.id, { linkedin_post_draft: linkedinDraft });
  const withRelations = await store.getOpportunityById(created.id);
  return withRelations;
}

function shouldExcludeCompanyJob(title: string, description: string): boolean {
  const titleText = title.toLowerCase();
  const fullText = `${title} ${description}`.toLowerCase();
  if (/\b(voice process|call[ -]?cent(er|re)|telecalling|telemarketing|bpo process|data entry operator|delivery rider|delivery driver|courier rider|mass hiring)\b/i.test(titleText)) return true;
  return /\b(voice process|call[ -]?cent(er|re)|telecalling|telemarketing|bpo process|generic data entry|delivery rider|delivery driver|courier rider|mass hiring)\b/i.test(fullText);
}

async function fetchCompanySource(
  store: Store,
  companySource: CompanySource,
  env: AppEnv,
  fetcher: typeof fetch,
  fromMs: number,
  fullBackfill: boolean,
  stats: DiscoveryStats,
): Promise<{ created: number; seen: number }> {
  const company = await store.getCompanyById(companySource.company_id);
  if (!company) throw new Error('Configured ATS source has no company record.');
  const base = companySource.source_url ?? company.careers_url ?? company.website;
  if (!base) throw new Error('Configured company source has no official career URL.');
  const source = { id: `company:${companySource.id}`, name: company.name, boardUrl: base };
  let jobs: GetroJob[] = [];
  if (companySource.provider === 'greenhouse') {
    const response = await fetcher(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(companySource.board_identifier)}/jobs?content=true`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`Greenhouse jobs API returned HTTP ${response.status}.`);
    const payload = await response.json() as { jobs?: Array<{ id?: number; title?: string; absolute_url?: string; content?: string; updated_at?: string; location?: { name?: string } }> };
    if (!Array.isArray(payload.jobs)) throw new Error('Greenhouse returned an invalid job list.');
    jobs = payload.jobs.filter((job) => fullBackfill || !job.updated_at || Date.parse(job.updated_at) >= fromMs).map((job) => ({ id: job.id, title: job.title, url: job.absolute_url, source_url: job.absolute_url, description: job.content, created_at: job.updated_at, locations: job.location?.name ? [job.location.name] : [], company: { name: company.name, website: company.website, careers_url: company.careers_url } }));
  } else if (companySource.provider === 'lever') {
    const response = await fetcher(`https://api.lever.co/v0/postings/${encodeURIComponent(companySource.board_identifier)}?mode=json`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`Lever public postings API returned HTTP ${response.status}.`);
    const payload = await response.json() as Array<{ id?: string; text?: string; hostedUrl?: string; applyUrl?: string; description?: string; descriptionPlain?: string; createdAt?: number; categories?: { location?: string; commitment?: string } }>;
    if (!Array.isArray(payload)) throw new Error('Lever returned an invalid job list.');
    jobs = payload.filter((job) => fullBackfill || !job.createdAt || job.createdAt >= fromMs).map((job) => ({ id: job.id, title: job.text, url: job.applyUrl ?? job.hostedUrl, source_url: job.hostedUrl, description: job.descriptionPlain ?? job.description, created_at: job.createdAt ? new Date(job.createdAt).toISOString() : undefined, locations: job.categories?.location ? [job.categories.location] : [], employment_types: job.categories?.commitment ? [job.categories.commitment] : [], company: { name: company.name, website: company.website, careers_url: company.careers_url } }));
  } else if (companySource.provider === 'ashby') {
    const response = await fetcher(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(companySource.board_identifier)}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`Ashby public job board API returned HTTP ${response.status}.`);
    const payload = await response.json() as { jobs?: Array<{ id?: string; title?: string; jobUrl?: string; applyUrl?: string; descriptionHtml?: string; descriptionPlain?: string; publishedAt?: string; location?: string; workplaceType?: string; employmentType?: string }> };
    if (!Array.isArray(payload.jobs)) throw new Error('Ashby returned an invalid job list.');
    jobs = payload.jobs.filter((job) => fullBackfill || !job.publishedAt || Date.parse(job.publishedAt) >= fromMs).map((job) => ({ id: job.id, title: job.title, url: job.applyUrl ?? job.jobUrl, source_url: job.jobUrl, description: job.descriptionPlain ?? job.descriptionHtml, created_at: job.publishedAt, locations: job.location ? [job.location] : [], work_mode: job.workplaceType, employment_types: job.employmentType ? [job.employmentType] : [], company: { name: company.name, website: company.website, careers_url: company.careers_url } }));
  } else {
    throw new Error('Custom ATS source has no approved adapter; it was not fetched.');
  }
  let created = 0;
  for (const job of jobs) if (await createFromJob(store, source, job, env.siteUrl, undefined, stats)) created += 1;
  return { created, seen: jobs.length };
}

function xmlText(item: string, tag: string): string | null {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = item.match(new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, 'i'));
  if (!match) return null;
  return match[1]
    .replace(/^<!\[CDATA\[|\]\]>$/g, '')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'").replace(/&amp;/gi, '&').trim();
}

async function scanJumpCapital(store: Store, source: (typeof PUBLIC_SOURCES)[0], env: AppEnv, fetcher: typeof fetch, fromMs: number, stats: DiscoveryStats): Promise<number> {
  const response = await fetcher('https://storage.googleapis.com/jumpcap-jobs-public/jobs.json', {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Jump Capital public jobs feed returned HTTP ${response.status}.`);
  const payload = await response.json() as {
    jobs?: Array<{ id?: string; company?: string; title?: string; department?: string; location?: string; work_type?: string; apply_url?: string; first_seen?: string }>;
    companies?: Array<{ company?: string; website?: string; careers_url?: string }>;
  };
  if (!Array.isArray(payload.jobs)) throw new Error('Jump Capital jobs feed returned an invalid response.');
  const companies = new Map((payload.companies ?? []).map((c) => [c.company?.toLowerCase() ?? '', c]));
  let created = 0;
  for (const item of payload.jobs) {
    if (!item.first_seen || Date.parse(item.first_seen) < fromMs) continue;
    const company = companies.get(item.company?.toLowerCase() ?? '');
    const result = await createFromJob(store, source, {
      id: item.id,
      title: item.title,
      url: item.apply_url,
      created_at: item.first_seen,
      locations: item.location && item.location !== 'Not specified' ? [item.location] : [],
      work_mode: item.work_type,
      company: item.company ? { name: item.company, website: company?.website, careers_url: company?.careers_url } : undefined,
    }, env.siteUrl, undefined, stats);
    if (result) created += 1;
  }
  return created;
}

async function scanAHub(store: Store, source: (typeof PUBLIC_SOURCES)[1], env: AppEnv, fetcher: typeof fetch, fromMs: number, stats: DiscoveryStats): Promise<number> {
  const response = await fetcher('https://jobb.a-hub.se/jobs.rss', {
    headers: { Accept: 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`A-Hub RSS feed returned HTTP ${response.status}.`);
  const xml = await response.text();
  const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  if (!items.length) throw new Error('A-Hub RSS feed contained no job items.');
  let created = 0;
  for (const item of items) {
    const postedAt = xmlText(item, 'pubDate');
    if (!postedAt || Date.parse(postedAt) < fromMs) continue;
    const link = safeOutboundUrl(xmlText(item, 'link'));
    const title = xmlText(item, 'title');
    const guid = xmlText(item, 'guid');
    const locationMatches = [...item.matchAll(/<tt:name>([\s\S]*?)<\/tt:name>/gi)];
    const locations = locationMatches.map((match) => match[1].replace(/&amp;/g, '&').trim()).filter(Boolean);
    const result = await createFromJob(store, source, {
      id: guid ?? link ?? undefined,
      title: title ?? undefined,
      url: link ?? undefined,
      created_at: new Date(postedAt).toISOString(),
      locations,
    }, env.siteUrl, xmlText(item, 'description'), stats);
    if (result) created += 1;
  }
  return created;
}

export async function discoverPortfolioJobs(
  env: AppEnv,
  store: Store,
  options: { now?: () => number; fetcher?: typeof fetch; manual?: boolean; fullBackfill?: boolean; onProgress?: (report: Record<string, unknown>) => Promise<void> | void } = {},
): Promise<{ configured: boolean; scanned: number; created: number; notified: number; duplicatesSkipped: number; scannedSources: string[]; failures: string[] }> {
  const now = options.now ?? Date.now;
  const fetcher = options.fetcher ?? fetch;
  const apiKey = env.portfolioGetroApiKey;
  const eligibleGetro = apiKey ? GETRO_SOURCES.filter((source) => env.portfolioGetroNetworkIds[source.id]) : [];
  const eligibleCandidates = GETRO_CANDIDATE_SOURCES.filter((source) => env.portfolioGetroSourceCredentials[source.id]);
  if (!env.portfolioTelegramBotToken || !env.portfolioTelegramChatId) {
    return { configured: false, scanned: 0, created: 0, notified: 0, duplicatesSkipped: 0, scannedSources: [], failures: [] };
  }

  let scanned = 0;
  let created = 0;
  const failures: string[] = [];
  const scannedSources: string[] = [];
  const stats: DiscoveryStats = { duplicatesSkipped: 0, qualitySkipped: 0 };
  let lastRequestAt = 0;
  const sources = [...PUBLIC_SOURCES, ...eligibleGetro, ...eligibleCandidates];
  for (const source of sources) {
    const previous = await store.getPortfolioDiscoveryState(source.id);
    if (!options.manual && previous?.last_success_at && now() - Date.parse(previous.last_success_at) < TWO_DAYS) continue;
    const sourceCredentials = env.portfolioGetroSourceCredentials[source.id];
    const networkId = sourceCredentials?.networkId ?? env.portfolioGetroNetworkIds[source.id];
    const sourceApiKey = sourceCredentials?.apiKey ?? apiKey;
    const startedAt = new Date(now()).toISOString();
    await store.updatePortfolioDiscoveryState({
      source_id: source.id,
      last_attempt_at: startedAt,
      last_success_at: previous?.last_success_at ?? null,
      last_error: null,
    });
    try {
      await options.onProgress?.({ scanned, scannedSources: [...scannedSources], created, duplicatesSkipped: stats.duplicatesSkipped, failures: [...failures], currentSource: source.name });
      const fromMs = options.fullBackfill
        ? 0
        : previous?.last_success_at
          ? Date.parse(previous.last_success_at) - 5 * 60_000
          : now() - FIRST_SCAN_WINDOW;
      let newJobs = 0;
      if (source.id === 'jump-capital') {
        newJobs = await scanJumpCapital(store, source, env, fetcher, fromMs, stats);
      } else if (source.id === 'a-hub') {
        newJobs = await scanAHub(store, source, env, fetcher, fromMs, stats);
      } else {
        if (!networkId || !sourceApiKey) throw new Error(`Owner-authorized Getro credentials are missing for ${source.name}.`);
        const createdAtFrom = new Date(Math.max(0, fromMs)).toISOString().slice(0, 10);
        let page = 1;
        let total = Number.POSITIVE_INFINITY;
        let seen = 0;
        while (seen < total) {
          const waitMs = Math.max(0, 2100 - (now() - lastRequestAt));
          if (lastRequestAt && waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
          const payload = await fetchPage(networkId, page, createdAtFrom, sourceApiKey, fetcher);
          lastRequestAt = now();
          const jobs = payload.items ?? [];
          total = Math.max(0, Number(payload.meta?.total ?? jobs.length));
          for (const job of jobs) {
            const opportunity = await createFromJob(store, source, job, env.siteUrl, undefined, stats);
            if (opportunity) newJobs += 1;
          }
          seen += jobs.length;
          page += 1;
          await options.onProgress?.({ scanned, scannedSources: [...scannedSources], created: created + newJobs, duplicatesSkipped: stats.duplicatesSkipped, failures: [...failures], currentSource: source.name, pagesRead: page - 1, jobsRead: seen, jobsReported: total });
          if (jobs.length === 0) {
            if (seen < total) throw new Error(`Getro pagination for ${source.name} stopped before all reported jobs were read; source checkpoint was not advanced.`);
            break;
          }
          if (page > 1000 && seen < total) throw new Error(`Getro pagination for ${source.name} exceeded the safety limit; source checkpoint was not advanced.`);
        }
      }
      created += newJobs;
      const successAt = new Date(now()).toISOString();
      await store.updatePortfolioDiscoveryState({ source_id: source.id, last_attempt_at: startedAt, last_success_at: successAt, last_error: null });
      scanned += 1;
      scannedSources.push(source.name);
      await options.onProgress?.({ scanned, scannedSources: [...scannedSources], created, duplicatesSkipped: stats.duplicatesSkipped, failures: [...failures], currentSource: null });
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 300) : 'Unknown discovery failure.';
      failures.push(`${source.name}: ${reason}`);
      await options.onProgress?.({ scanned, scannedSources: [...scannedSources], created, duplicatesSkipped: stats.duplicatesSkipped, failures: [...failures], currentSource: source.name });
      await store.updatePortfolioDiscoveryState({
        source_id: source.id,
        last_attempt_at: startedAt,
        last_success_at: previous?.last_success_at ?? null,
        last_error: reason,
      });
      console.error('[portfolio-discovery] source failed', { sourceId: source.id, reason });
    }
  }

  // Company career sources are explicitly configured official ATS boards.
  // No company site is inferred or scraped from a guessed URL.
  try {
    const companySources = (await store.listCompanySources()).filter((source) => source.sync_status !== 'disabled');
    for (const companySource of companySources) {
      const sourceId = `company-source:${companySource.id}`;
      const previous = await store.getPortfolioDiscoveryState(sourceId);
      if (!options.manual && previous?.last_success_at && now() - Date.parse(previous.last_success_at) < TWO_DAYS) continue;
      const startedAt = new Date(now()).toISOString();
      await store.updatePortfolioDiscoveryState({ source_id: sourceId, last_attempt_at: startedAt, last_success_at: previous?.last_success_at ?? null, last_error: null });
      try {
        await options.onProgress?.({ scanned, scannedSources: [...scannedSources], created, duplicatesSkipped: stats.duplicatesSkipped, failures: [...failures], currentSource: companySource.source_url ?? companySource.board_identifier });
        const fromMs = options.fullBackfill ? 0 : previous?.last_success_at ? Date.parse(previous.last_success_at) - 5 * 60_000 : now() - FIRST_SCAN_WINDOW;
        const result = await fetchCompanySource(store, companySource, env, fetcher, fromMs, Boolean(options.fullBackfill), stats);
        created += result.created;
        scanned += 1;
        const company = await store.getCompanyById(companySource.company_id);
        scannedSources.push(company?.name ?? companySource.board_identifier);
        await store.updatePortfolioDiscoveryState({ source_id: sourceId, last_attempt_at: startedAt, last_success_at: new Date(now()).toISOString(), last_error: null });
        await store.recordCompanySourceSync(companySource.id, 'ok');
        await options.onProgress?.({ scanned, scannedSources: [...scannedSources], created, duplicatesSkipped: stats.duplicatesSkipped, failures: [...failures], currentSource: null });
      } catch (error) {
        const reason = error instanceof Error ? error.message.slice(0, 300) : 'Company ATS scan failed.';
        failures.push(`${companySource.source_url ?? companySource.board_identifier}: ${reason}`);
        await store.updatePortfolioDiscoveryState({ source_id: sourceId, last_attempt_at: startedAt, last_success_at: previous?.last_success_at ?? null, last_error: reason });
        await store.recordCompanySourceSync(companySource.id, 'error', reason);
        await options.onProgress?.({ scanned, scannedSources: [...scannedSources], created, duplicatesSkipped: stats.duplicatesSkipped, failures: [...failures], currentSource: companySource.board_identifier });
      }
    }
  } catch (error) {
    failures.push(`Configured company sources: ${error instanceof Error ? error.message.slice(0, 200) : 'Could not load configured ATS sources.'}`);
  }

  return { configured: true, scanned, created, notified: 0, duplicatesSkipped: stats.duplicatesSkipped, scannedSources, failures };
}
