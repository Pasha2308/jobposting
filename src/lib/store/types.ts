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
  OpportunityStatus,
  OpportunityWithRelations,
  Report,
  ReportReason,
  ReportStatus,
  ReportWithOpportunity,
  SearchFilters,
  SearchResult,
  SourceCapture,
  SourceType,
  CaptureStatus,
  RetrievalMethod,
  RetrievalStatus,
  SourceComment,
  VerificationStatus,
} from '../domain/types';
import type { DuplicateCandidate } from '../domain/duplicates';

export type AdminOpportunityFilters = {
  q?: string;
  status?: OpportunityStatus | '';
  category?: string;
  sort?: 'newest' | 'oldest' | 'updated' | 'title';
  page?: number;
  pageSize?: number;
};

export type CaptureFilters = {
  status?: CaptureStatus | '';
  q?: string;
  page?: number;
  pageSize?: number;
};

export type CommentSetInput = {
  style: CommentStyle;
  body: string;
  includesListingUrl: boolean;
};

export type CommentWithOpportunity = GeneratedComment & {
  opportunity: Pick<Opportunity, 'id' | 'slug' | 'title' | 'status' | 'company_id'> & {
    company_name?: string | null;
  };
};

export type LocationCount = { city: string; country: string | null; count: number; slug: string };
export type PortfolioDiscoveryState = {
  source_id: string;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
};
export type PortfolioSearchRun = {
  id: string;
  requested_by: number;
  status: 'running' | 'completed' | 'partial' | 'failed';
  full_backfill: boolean;
  started_at: string;
  finished_at: string | null;
  report: Record<string, unknown>;
};

export type CandidateApplicationLead = {
  id: string;
  opportunity_id: string;
  email: string;
  consented_at: string;
  created_at: string;
  last_redirected_at: string;
  verified_at?: string | null;
  job_code: string | null;
  title: string;
  company_name: string | null;
};

export type CandidateApplicationInput = {
  opportunity_id: string;
  email: string;
  email_normalized: string;
  consented_at: string;
  consent_text_version: string;
  verified_at: string;
};
export type CandidateOtpRequest = { email_hash: string; opportunity_id: string; code_hash: string; consented_at: string; ip_hash: string; now: string };
export type CandidateOtpResult = { allowed: boolean; reason?: string };
export type CandidateOtpVerify = { email: string; email_hash: string; code_hash: string; now: string; consent_text_version: string };
export type CandidateOtpVerifyResult = { verified: boolean; reason?: string };
export type LinkedInDeliveryItem = { opportunity_id: string; batch_number: number };
export type LinkedInDeliveryCounts = { queued: number; sending: number; sent: number; acknowledged: number; failed: number };
export type XDeliveryItem = LinkedInDeliveryItem;
export type XDeliveryCounts = LinkedInDeliveryCounts;

/**
 * Persistence contract. Services depend on this interface, never on Supabase
 * directly. That keeps the public site, admin API and Telegram bot on one set
 * of business rules, and lets the test suite run real workflows against an
 * in-memory implementation.
 */
export interface Store {
  /* categories */
  listCategories(opts?: { activeOnly?: boolean }): Promise<Category[]>;
  listCategoriesWithCounts(): Promise<CategoryWithCount[]>;
  getCategoryBySlug(slug: string): Promise<Category | null>;
  getCategoryById(id: string): Promise<Category | null>;
  createCategory(input: Omit<Category, 'id' | 'created_at' | 'updated_at' | 'slug'> & { slug: string }): Promise<Category>;
  updateCategory(id: string, patch: Partial<Category>): Promise<Category>;

  /* companies */
  listCompanies(opts?: { q?: string; limit?: number }): Promise<Company[]>;
  getCompanyById(id: string): Promise<Company | null>;
  findCompanyByName(name: string): Promise<Company | null>;
  createCompany(input: { name: string; slug: string; website?: string | null; careers_url?: string | null; description?: string | null; verified?: boolean }): Promise<Company>;
  updateCompany(id: string, patch: Partial<Company>): Promise<Company>;

  /* opportunities */
  searchPublic(filters: SearchFilters): Promise<SearchResult>;
  listAdmin(filters: AdminOpportunityFilters): Promise<SearchResult>;
  getOpportunityById(id: string): Promise<OpportunityWithRelations | null>;
  getOpportunityBySlug(slug: string): Promise<OpportunityWithRelations | null>;
  getOpportunityByJobCode(jobCode: string): Promise<OpportunityWithRelations | null>;
  createOpportunity(draft: OpportunityDraft): Promise<Opportunity>;
  updateOpportunity(id: string, patch: Partial<Opportunity>): Promise<Opportunity>;
  deleteOpportunity(id: string): Promise<void>;
  homepage(limit?: number): Promise<HomeData>;
  /**
   * Recent opportunities used for duplicate detection. When `excludeCaptureId`
   * is supplied, rows created by that capture are omitted so a retried
   * extraction never reports the capture's own openings as duplicates.
   */
  recentDuplicateCandidates(limit?: number, excludeCaptureId?: string | null): Promise<DuplicateCandidate[]>;
  findOpportunityBySourceKey(key: string): Promise<Opportunity | null>;
  /**
   * Finds the opportunity a capture already created for a given opening slot.
   * Retrying a partially persisted multi-opening extraction reuses these rows
   * instead of colliding with the (source key, opening key) unique index.
   */
  findOpportunityByOpening(sourceKey: string, openingKey: number): Promise<Opportunity | null>;
  listPublicSlugs(): Promise<{ slug: string; updated_at: string }[]>;
  listLocations(): Promise<LocationCount[]>;
  listCountries(): Promise<{ country: string; count: number }[]>;
  needsVerification(days: number): Promise<OpportunityWithRelations[]>;
  getPortfolioDiscoveryState(sourceId: string): Promise<PortfolioDiscoveryState | null>;
  updatePortfolioDiscoveryState(state: PortfolioDiscoveryState): Promise<void>;
  listUnnotifiedPortfolioOpportunities(limit?: number): Promise<OpportunityWithRelations[]>;
  claimPortfolioNotification(opportunityId: string): Promise<boolean>;
  claimTelegramUpdate(updateId: number, telegramUserId?: number | null, updateType?: string | null, botKey?: 'capture' | 'portfolio'): Promise<boolean>;
  getPortfolioAdminChat(telegramUserId: number): Promise<number | null>;
  setPortfolioAdminChat(telegramUserId: number, chatId: number): Promise<void>;
  isPortfolioChatVerified(chatId: number): Promise<boolean>;
  startPortfolioSearch(requestedBy: number, fullBackfill: boolean): Promise<string | null>;
  finishPortfolioSearch(id: string, status: 'completed' | 'partial' | 'failed', report: Record<string, unknown>): Promise<void>;
  updatePortfolioSearchProgress(id: string, report: Record<string, unknown>): Promise<void>;
  latestPortfolioSearch(): Promise<PortfolioSearchRun | null>;
  enqueueLinkedInPost(opportunityId: string): Promise<boolean>;
  claimNextLinkedInDeliveryBatch(limit?: number): Promise<LinkedInDeliveryItem[]>;
  setLinkedInDeliveryState(opportunityId: string, state: 'sent' | 'failed', details?: { telegramMessageId?: number; error?: string; retryable?: boolean }): Promise<void>;
  prepareLinkedInDeliveryRetry(batchNumber: number): Promise<void>;
  acknowledgeLinkedInDeliveryBatch(batchNumber: number): Promise<boolean>;
  currentLinkedInDeliveryBatch(): Promise<number | null>;
  linkedinDeliveryCounts(): Promise<LinkedInDeliveryCounts>;
  countPublishedWithoutLinkedInDraft(): Promise<number>;
  enqueueXPost(opportunityId: string): Promise<boolean>;
  claimNextXDeliveryBatch(limit?: number): Promise<XDeliveryItem[]>;
  setXDeliveryState(opportunityId: string, state: 'sent' | 'failed', details?: { telegramMessageId?: number; error?: string; retryable?: boolean }): Promise<void>;
  prepareXDeliveryRetry(batchNumber: number): Promise<void>;
  acknowledgeXDeliveryBatch(batchNumber: number): Promise<boolean>;
  currentXDeliveryBatch(): Promise<number | null>;
  xDeliveryCounts(): Promise<XDeliveryCounts>;

  /* candidate application email capture */
  recordCandidateApplication(input: CandidateApplicationInput): Promise<void>;
  requestCandidateEmailOtp(input: CandidateOtpRequest): Promise<CandidateOtpResult>;
  verifyCandidateEmailOtp(input: CandidateOtpVerify): Promise<CandidateOtpVerifyResult>;
  listCandidateApplications(limit?: number): Promise<CandidateApplicationLead[]>;
  purgeStaleCandidateApplications(): Promise<number>;

  /* captures */
  createCapture(input: {
    source_url: string | null;
    normalized_source_key: string | null;
    source_post_id?: string | null;
    source_type: SourceType;
    raw_text: string;
    submitted_company?: string | null;
    notes?: string | null;
    created_by: string;
    status?: CaptureStatus;
    telegram_user_id?: number | null;
    telegram_chat_id?: number | null;
    telegram_message_id?: number | null;
    retrieval_status?: RetrievalStatus;
    retrieval_method?: RetrievalMethod | null;
    retrieval_http_status?: number | null;
    retrieval_error_code?: string | null;
    retrieval_attempts?: number;
    retrieved_at?: string | null;
    next_retry_at?: string | null;
    source_author?: string | null;
    source_posted_at?: string | null;
    source_metadata?: Record<string, unknown> | null;
    source_comments?: SourceComment[] | null;
  }): Promise<SourceCapture>;
  getCapture(id: string): Promise<SourceCapture | null>;
  getCaptureBySourceKey(key: string): Promise<SourceCapture | null>;
  updateCapture(id: string, patch: Partial<SourceCapture>): Promise<SourceCapture>;
  listCaptures(filters: CaptureFilters): Promise<{ items: SourceCapture[]; total: number }>;
  /**
   * Most recent capture from this Telegram user that is waiting for copied
   * text, including one whose automatic retrieval failed (URL preserved).
   */
  findAwaitingCapture(telegramUserId: number, maxAgeMinutes: number): Promise<SourceCapture | null>;
  /** Atomically claim due retrieval retries. Never returns the same row twice. */
  claimDueRetrievals(limit: number): Promise<SourceCapture[]>;
  /** Re-queue captures left in `retrieving` after a worker was killed. */
  recoverStaleRetrieving(olderThanSeconds: number): Promise<number>;
  /**
   * Mark captures left in `extracting` after a worker was killed as failed so
   * an admin can retry extraction. Nothing is deleted.
   */
  recoverStaleExtracting(olderThanSeconds: number): Promise<number>;
  /** Clears raw post text and extraction payloads older than the retention window. */
  purgeExpiredSourceText(olderThanDays: number): Promise<number>;

  /* comments */
  replaceComments(
    opportunityId: string,
    comments: CommentSetInput[],
    opts: { generatedBy?: 'template' | 'ai'; selectedStyle?: CommentStyle },
  ): Promise<GeneratedComment[]>;
  listComments(opportunityId: string): Promise<GeneratedComment[]>;
  getComment(id: string): Promise<GeneratedComment | null>;
  updateComment(id: string, patch: Partial<Pick<GeneratedComment, 'body' | 'is_selected' | 'manually_posted'>>): Promise<GeneratedComment>;
  listCommentQueue(limit?: number): Promise<CommentWithOpportunity[]>;
  clearCommentSelection(opportunityId: string): Promise<void>;

  /* reports */
  createReport(input: {
    opportunity_id: string;
    reason: ReportReason;
    details?: string | null;
    contact_email?: string | null;
  }): Promise<Report>;
  listReports(status?: ReportStatus | ''): Promise<ReportWithOpportunity[]>;
  getReport(id: string): Promise<ReportWithOpportunity | null>;
  updateReport(id: string, patch: Partial<Report>): Promise<Report>;

  /* events + analytics */
  recordEvents(
    events: { opportunity_id?: string | null; event_type: string; metadata?: Record<string, unknown> | null }[],
  ): Promise<void>;
  analytics(days: number): Promise<AnalyticsSummary>;

  /* admin + platform */
  adminStats(): Promise<AdminStatistics>;
  getProfile(userId: string): Promise<AdminProfile | null>;
  logActivity(log: { actor: string; action: string; entity_type: string; entity_id?: string | null; metadata?: Record<string, unknown> | null }): Promise<void>;
  listActivity(limit?: number): Promise<ActivityLog[]>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  expireStaleOpportunities(): Promise<number>;
  activateNextCompanySourceBatch(): Promise<number>;

  /* future ATS integrations */
  listCompanySources(companyId?: string): Promise<CompanySource[]>;
  upsertCompanySource(input: {
    company_id: string;
    provider: CompanySource['provider'];
    board_identifier: string;
    source_url?: string | null;
    sync_status?: CompanySource['sync_status'];
  }): Promise<CompanySource>;
  recordCompanySourceSync(id: string, status: 'ok' | 'error', error?: string | null): Promise<void>;
}

export type { VerificationStatus, OpportunityStatus };
