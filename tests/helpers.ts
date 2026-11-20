import type { AIProvider, ExtractionRequest } from '../src/lib/ai/provider';
import type { AppEnv } from '../src/lib/env';
import type { Messenger, SendOptions } from '../src/lib/telegram/client';
import { MemoryStore } from '../src/lib/store/memory-store';

export const SITE_URL = 'https://opportunities.test';

export function testEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    siteUrl: SITE_URL,
    supabaseUrl: null,
    supabaseAnonKey: null,
    supabaseServiceRoleKey: null,
    geminiApiKey: null,
    geminiModel: 'gemini-2.5-flash',
    aiProvider: 'gemini',
    groqApiKey: null,
    groqModel: 'openai/gpt-oss-120b',
    telegramBotToken: '123456:test-token',
    telegramWebhookSecret: 'test-webhook-secret',
    telegramAdminIds: [111, 222],
    portfolioTelegramBotToken: null,
    portfolioTelegramChatId: null,
    portfolioTelegramWebhookSecret: null,
    portfolioTelegramAdminIds: overrides.portfolioTelegramAdminIds ?? overrides.telegramAdminIds ?? [111, 222],
    portfolioGetroApiKey: null,
    portfolioGetroNetworkIds: {},
    portfolioGetroSourceCredentials: {},
    turnstileSecretKey: null,
    turnstileSiteKey: null,
    linkedinJsonLdEnabled: false,
    linkedinRetrievalAuthorised: false,
    cronSecret: null,
    isProduction: false,
    isTest: true,
    ...overrides,
  };
}

export async function seedStore(): Promise<{ store: MemoryStore; categoryId: string; companyId: string }> {
  const store = new MemoryStore();
  const category = await store.createCategory({
    name: 'Engineering',
    slug: 'engineering',
    description: 'Engineering roles at early-stage teams.',
    is_active: true,
    is_featured: true,
    sort_order: 10,
  });
  const company = await store.createCompany({
    name: 'Acme Labs',
    slug: 'acme-labs',
    website: 'https://acme.test',
    careers_url: 'https://acme.test/careers',
    description: 'A test company.',
    verified: true,
  });
  return { store, categoryId: category.id, companyId: company.id };
}

export const SAMPLE_TEXT = [
  'Acme Labs is hiring a Founding Full Stack Engineer.',
  'We are a small product team building developer tools.',
  'You will own our TypeScript web app and work directly with the founders.',
  'Requirements: 3+ years with TypeScript, React and Postgres.',
  'This is a remote role in India.',
  'Apply here: https://acme.test/careers/founding-engineer',
  'Applications reviewed on a rolling basis.',
].join('\n');

export type FakeAI = AIProvider & { calls: ExtractionRequest[] };

export function fakeAI(overrides: Record<string, unknown> = {}): FakeAI {
  const calls: ExtractionRequest[] = [];
  const provider: FakeAI = {
    name: 'fake',
    calls,
    async extract(request: ExtractionRequest): Promise<unknown> {
      calls.push(request);
      return {
        is_genuine_opportunity: true,
        genuine_opportunity_reason: null,
        job_title: 'Founding Full Stack Engineer',
        company_name: 'Acme Labs',
        company_website: 'https://acme.test',
        category_slug: 'engineering',
        summary:
          'Acme Labs is hiring a founding full-stack engineer to own its TypeScript web app and work directly with the founders.',
        responsibilities: ['Own the TypeScript web app', 'Work directly with the founders'],
        requirements: ['3+ years with TypeScript', 'Experience with React and Postgres'],
        required_skills: ['TypeScript', 'React', 'Postgres'],
        preferred_skills: [],
        location: 'Remote, India',
        city: null,
        country: 'India',
        work_mode: 'remote',
        employment_type: 'full_time',
        salary_min: null,
        salary_max: null,
        currency: null,
        salary_period: 'unspecified',
        experience_min_years: 3,
        experience_max_years: null,
        application_method: 'external_url',
        recruitment_email: null,
        application_url: 'https://acme.test/careers/founding-engineer',
        application_instructions: 'Apply through the careers page.',
        deadline: null,
        original_posted_date: null,
        original_date_precision: 'unknown',
        original_date_text: null,
        confidence: 0.9,
        warnings: [],
        ...overrides,
      };
    },
  };
  return provider;
}

export function failingAI(message = 'Gemini timed out.'): FakeAI {
  return {
    name: 'fake-failing',
    calls: [],
    async extract(): Promise<unknown> {
      throw new Error(message);
    },
  };
}

export class RecordingMessenger implements Messenger {
  sent: { chatId: number; text: string; options?: SendOptions }[] = [];
  edits: { chatId: number; messageId: number; text: string; options?: SendOptions }[] = [];
  answers: { id: string; text?: string }[] = [];

  async sendMessage(chatId: number, text: string, options?: SendOptions): Promise<{ message_id: number }> {
    this.sent.push({ chatId, text, options });
    return { message_id: this.sent.length };
  }

  async editMessageText(chatId: number, messageId: number, text: string, options?: SendOptions): Promise<void> {
    this.edits.push({ chatId, messageId, text, options });
  }

  async answerCallbackQuery(id: string, text?: string): Promise<void> {
    this.answers.push({ id, text });
  }
}

export const VALID_OPPORTUNITY_INPUT = {
  title: 'Founding Full Stack Engineer',
  company_id: null,
  category_id: null,
  summary:
    'Acme Labs is hiring a founding full stack engineer to own the TypeScript product and work directly with the founders.',
  responsibilities: ['Own the product'],
  requirements: ['3+ years of TypeScript'],
  skills: ['TypeScript', 'React'],
  preferred_skills: [],
  education_requirements: [],
  benefits: [],
  languages: [],
  recruiter_name: null,
  location_text: 'Bengaluru, India',
  city: 'Bengaluru',
  country: 'India',
  country_code: 'IN',
  work_mode: 'hybrid',
  employment_type: 'full_time',
  salary_min: null,
  salary_max: null,
  currency: null,
  salary_period: 'unspecified',
  experience_min_years: 3,
  experience_max_years: null,
  application_method: 'external_url',
  application_url: 'https://acme.test/careers/founding-engineer',
  recruitment_email: null,
  careers_url: 'https://acme.test/careers',
  application_instructions: 'Apply on the careers page.',
  source_url: 'https://www.linkedin.com/posts/acme_founding-engineer-1234567890',
  source_type: 'linkedin_post',
  deadline: null,
  original_posted_at: null,
  original_date_precision: 'unknown',
  original_date_text: null,
  verification_status: 'source_open',
  is_featured: false,
  admin_notes: null,
  company_name: 'Acme Labs',
  company_website: null,
  company_careers_url: null,
};
