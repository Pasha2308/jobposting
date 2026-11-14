/**
 * Shared domain types for Hustler Community Opportunities.
 *
 * These types are the single contract between the public site, the admin
 * workspace, the AI extraction pipeline, the Telegram bot and the database.
 * Database enum values mirror these string unions exactly (see
 * supabase/migrations/0001_init.sql).
 */

export const OPPORTUNITY_STATUSES = [
  'draft',
  'pending_review',
  'published',
  'closed',
  'expired',
  'rejected',
  'archived',
] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const VERIFICATION_STATUSES = [
  'not_verified',
  'source_open',
  'source_closed',
  'uncertain',
  'needs_verification',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const WORK_MODES = ['onsite', 'hybrid', 'remote', 'unspecified'] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const EMPLOYMENT_TYPES = [
  'full_time',
  'part_time',
  'contract',
  'internship',
  'temporary',
  'unspecified',
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const APPLICATION_METHODS = [
  'external_url',
  'email',
  'linkedin_post',
  'careers_page',
  'other',
  'none',
] as const;
export type ApplicationMethod = (typeof APPLICATION_METHODS)[number];

export const SALARY_PERIODS = ['annual', 'monthly', 'daily', 'hourly', 'stipend', 'unspecified'] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

export const DATE_PRECISIONS = ['exact', 'month', 'year', 'unknown'] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

export const SOURCE_TYPES = [
  'linkedin_post',
  'company_website',
  'recruiter_announcement',
  'public_submission',
  'other',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const CAPTURE_STATUSES = [
  'received',
  'validating',
  'duplicate_check',
  'awaiting_text',
  'extracting',
  'extraction_failed',
  'needs_review',
  'approved',
  'rejected',
  'published',
] as const;
export type CaptureStatus = (typeof CAPTURE_STATUSES)[number];

export const REPORT_REASONS = [
  'closed',
  'broken_link',
  'incorrect_info',
  'duplicate',
  'suspicious',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const EVENT_TYPES = [
  'view',
  'apply_click',
  'email_click',
  'source_click',
  'careers_click',
  'share',
  'search',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const ADMIN_ROLES = ['owner', 'admin', 'editor'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export type Company = {
  id: string;
  name: string;
  slug: string;
  website: string | null;
  careers_url: string | null;
  description: string | null;
  logo_url: string | null;
  verified: boolean;
  created_at: string;
  updated_at: string;
};

export type Category = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_active: boolean;
  is_featured: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type CategoryWithCount = Category & { opportunity_count: number };

export type Opportunity = {
  id: string;
  slug: string;
  title: string;
  company_id: string | null;
  category_id: string | null;
  summary: string | null;
  responsibilities: string[];
  requirements: string[];
  skills: string[];
  preferred_skills: string[];

  location_text: string | null;
  city: string | null;
  country: string | null;
  country_code: string | null;
  work_mode: WorkMode;
  employment_type: EmploymentType;

  salary_min: number | null;
  salary_max: number | null;
  currency: string | null;
  salary_period: SalaryPeriod;
  experience_min_years: number | null;
  experience_max_years: number | null;

  application_method: ApplicationMethod;
  application_url: string | null;
  recruitment_email: string | null;
  careers_url: string | null;
  application_instructions: string | null;

  source_url: string | null;
  source_type: SourceType | null;
  source_capture_id: string | null;
  /** Normalised canonical source key; unique across active opportunities. */
  canonical_source_key: string | null;

  deadline: string | null;
  original_posted_at: string | null;
  original_date_precision: DatePrecision;
  original_date_text: string | null;

  status: OpportunityStatus;
  verification_status: VerificationStatus;
  is_featured: boolean;

  discovered_at: string;
  published_at: string | null;
  last_verified_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;

  admin_notes: string | null;
  created_by: string | null;
};

export type OpportunityWithRelations = Opportunity & {
  company: Pick<Company, 'id' | 'name' | 'slug' | 'website' | 'careers_url' | 'description' | 'verified'> | null;
  category: Pick<Category, 'id' | 'slug' | 'name'> | null;
};

export type OpportunityDraft = Omit<
  Opportunity,
  | 'id'
  | 'created_at'
  | 'updated_at'
  | 'discovered_at'
  | 'published_at'
  | 'closed_at'
  | 'created_by'
> & {
  id?: string;
  discovered_at?: string;
  published_at?: string | null;
  closed_at?: string | null;
  created_by?: string | null;
};

export type SourceCapture = {
  id: string;
  source_url: string | null;
  normalized_source_key: string;
  source_post_id: string | null;
  source_type: SourceType;
  raw_text: string;
  submitted_company: string | null;
  notes: string | null;
  status: CaptureStatus;
  error_message: string | null;
  extraction: unknown | null;
  extraction_confidence: number | null;
  attempt_count: number;
  processing_started_at: string | null;
  opportunity_id: string | null;
  created_by: string | null;
  telegram_user_id: number | null;
  telegram_chat_id: number | null;
  telegram_message_id: number | null;
  created_at: string;
  updated_at: string;
};

export type GeneratedComment = {
  id: string;
  opportunity_id: string;
  style: CommentStyle;
  body: string;
  is_selected: boolean;
  manually_posted: boolean;
  generated_by: 'template' | 'ai';
  version: number;
  includes_listing_url: boolean;
  created_at: string;
  updated_at: string;
};

export const COMMENT_STYLES = ['professional', 'community', 'conversational'] as const;
export type CommentStyle = (typeof COMMENT_STYLES)[number];

export type Report = {
  id: string;
  opportunity_id: string;
  reason: ReportReason;
  details: string | null;
  contact_email: string | null;
  status: ReportStatus;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type ReportWithOpportunity = Report & {
  opportunity: Pick<Opportunity, 'id' | 'slug' | 'title' | 'status'> | null;
};

export type OpportunityEvent = {
  id: string;
  opportunity_id: string | null;
  event_type: EventType;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type AdminProfile = {
  user_id: string;
  email: string;
  display_name: string;
  role: AdminRole;
  is_active: boolean;
  created_at: string;
};

export type ActivityLog = {
  id: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type CompanySource = {
  id: string;
  company_id: string;
  provider: 'greenhouse' | 'lever' | 'ashby' | 'custom';
  board_identifier: string;
  source_url: string | null;
  last_checked_at: string | null;
  next_check_at: string | null;
  sync_status: 'idle' | 'ok' | 'error' | 'disabled';
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type SearchFilters = {
  q?: string;
  category?: string;
  country?: string;
  city?: string;
  workMode?: WorkMode[];
  employmentType?: EmploymentType[];
  experience?: 'entry' | 'mid' | 'senior' | '';
  salaryDisclosed?: boolean;
  currency?: string;
  sort?: 'newest' | 'oldest' | 'source_date' | 'relevance';
  page?: number;
  pageSize?: number;
};

export type SearchResult = {
  items: OpportunityWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type HomeData = {
  latest: OpportunityWithRelations[];
  recentlyDiscovered: OpportunityWithRelations[];
  remote: OpportunityWithRelations[];
  internships: OpportunityWithRelations[];
  featured: OpportunityWithRelations[];
  categories: CategoryWithCount[];
  locations: { city: string; country: string | null; count: number }[];
  totalPublished: number;
};

export type AdminStatistics = {
  total: number;
  published: number;
  pending_review: number;
  draft: number;
  closed: number;
  expired: number;
  rejected: number;
  archived: number;
  added_today: number;
  published_today: number;
  needs_verification: number;
  duplicate_captures: number;
  open_reports: number;
  total_captures: number;
};

export type AnalyticsSummary = {
  views: number;
  applyClicks: number;
  emailClicks: number;
  sourceClicks: number;
  careersClicks: number;
  shares: number;
  searches: number;
  topOpportunities: { id: string; title: string; slug: string; count: number }[];
  topCategories: { name: string; slug: string; count: number }[];
  publicationTrend: { date: string; count: number }[];
  dailyEvents: { date: string; views: number; applyClicks: number }[];
  topSearches: { query: string; count: number }[];
};

export type AppSettings = {
  site_name: string;
  site_url: string;
  verification_reminder_days: number;
  source_retention_days: number;
  public_submissions_enabled: boolean;
  reports_enabled: boolean;
  ai_provider: 'gemini' | 'none';
  default_currency: string;
};

export const DEFAULT_SETTINGS: AppSettings = {
  site_name: 'Hustler Community Opportunities',
  site_url: 'https://hustlercommunity-opportunities.pages.dev',
  verification_reminder_days: 14,
  source_retention_days: 180,
  public_submissions_enabled: true,
  reports_enabled: true,
  ai_provider: 'gemini',
  default_currency: 'INR',
};
