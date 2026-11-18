import { describe, expect, it } from 'vitest';
import { processCapture, retryCapture, submitCapture } from '../../src/lib/services/capture';
import { publishOpportunity, transitionOpportunity } from '../../src/lib/services/publishing';
import { handleTelegramUpdate } from '../../src/lib/telegram/service';
import { generateFixedComment } from '../../src/lib/domain/comments';
import { RecordingMessenger, seedStore, SITE_URL, testEnv } from '../helpers';
import type { AIProvider } from '../../src/lib/ai/provider';

const MULTI_POST_URL = 'https://www.linkedin.com/posts/acme-startup_we-are-hiring-5-roles-7788990011';

const MULTI_POST_TEXT = `
Acme Labs is growing! We have 5 open roles right now:

1. Founder Associate - Full Time - Bengaluru (Onsite)
Work directly with founders on ops & growth.
Salary: 12-18 LPA
Apply: https://acme.test/apply/founder-associate

2. Growth Manager - Full Time - Remote (India)
Lead B2B user acquisition. 3+ years experience.
Salary: 20-30 LPA
Apply: https://acme.test/apply/growth-manager

3. Business Operations Intern - Internship - Mumbai (Hybrid)
Fast-paced business operations role for students/fresh grads.
Stipend: 30000 monthly
Apply via email: jobs@acme.test

4. Product Analyst - Full Time - Bengaluru (Hybrid)
SQL, Amplitude, Python product telemetry.
Apply: https://acme.test/apply/product-analyst

5. Senior Frontend Engineer - Full Time - Remote
React, TypeScript, Tailwind. 4+ years experience.
Salary: 35-50 LPA
Apply: https://acme.test/apply/frontend-engineer
`;

function multiOpeningAI(): AIProvider {
  return {
    name: 'multi-ai',
    async extract(_request): Promise<unknown> {
      return {
        is_genuine_opportunity: true,
        genuine_opportunity_reason: null,
        company_name: 'Acme Labs',
        company_website: 'https://acme.test',
        confidence: 0.98,
        warnings: [],
        openings: [
          {
            job_title: 'Founder Associate',
            company_name: 'Acme Labs',
            category_slug: 'engineering',
            summary: 'Work directly with founders on ops & growth.',
            location: 'Bengaluru, India',
            city: 'Bengaluru',
            country: 'India',
            work_mode: 'onsite',
            employment_type: 'full_time',
            salary_min: 1200000,
            salary_max: 1800000,
            currency: 'INR',
            salary_period: 'annual',
            experience_min_years: 0,
            experience_max_years: 2,
            application_method: 'external_url',
            application_url: 'https://acme.test/apply/founder-associate',
            confidence: 0.95,
          },
          {
            job_title: 'Growth Manager',
            company_name: 'Acme Labs',
            category_slug: 'engineering',
            summary: 'Lead B2B user acquisition and growth across organic and paid channels.',
            location: 'Remote, India',
            city: null,
            country: 'India',
            work_mode: 'remote',
            employment_type: 'full_time',
            salary_min: 2000000,
            salary_max: 3000000,
            currency: 'INR',
            salary_period: 'annual',
            experience_min_years: 3,
            experience_max_years: 6,
            application_method: 'external_url',
            application_url: 'https://acme.test/apply/growth-manager',
            confidence: 0.95,
          },
          {
            job_title: 'Business Operations Intern',
            company_name: 'Acme Labs',
            category_slug: 'engineering',
            summary: 'Fast-paced business operations role for students/fresh grads.',
            location: 'Mumbai, India',
            city: 'Mumbai',
            country: 'India',
            work_mode: 'hybrid',
            employment_type: 'internship',
            salary_min: 30000,
            salary_max: 30000,
            currency: 'INR',
            salary_period: 'monthly',
            experience_min_years: 0,
            experience_max_years: 1,
            application_method: 'email',
            recruitment_email: 'jobs@acme.test',
            confidence: 0.95,
          },
          {
            job_title: 'Product Analyst',
            company_name: 'Acme Labs',
            category_slug: 'engineering',
            summary: 'SQL, Amplitude, Python product telemetry.',
            location: 'Bengaluru, India',
            city: 'Bengaluru',
            country: 'India',
            work_mode: 'hybrid',
            employment_type: 'full_time',
            salary_min: null,
            salary_max: null,
            currency: null,
            salary_period: 'unspecified',
            experience_min_years: 1,
            experience_max_years: 3,
            application_method: 'external_url',
            application_url: 'https://acme.test/apply/product-analyst',
            confidence: 0.95,
          },
          {
            job_title: 'Senior Frontend Engineer',
            company_name: 'Acme Labs',
            category_slug: 'engineering',
            summary: 'React, TypeScript, Tailwind product engineering.',
            location: 'Remote',
            city: null,
            country: null,
            work_mode: 'remote',
            employment_type: 'full_time',
            salary_min: 3500000,
            salary_max: 5000000,
            currency: 'INR',
            salary_period: 'annual',
            experience_min_years: 4,
            experience_max_years: 8,
            application_method: 'external_url',
            application_url: 'https://acme.test/apply/frontend-engineer',
            confidence: 0.95,
          },
        ],
      };
    },
  };
}

describe('Multiple openings from one LinkedIn post (Scenario 1-12)', () => {
  it('extracts all 5 openings, keeps them linked to source, and publishes 3 individually with sequential numbering', async () => {
    const { store } = await seedStore();
    const ai = multiOpeningAI();

    // 1. Submit one LinkedIn post containing five openings
    const submitted = await submitCapture(store, {
      sourceUrl: MULTI_POST_URL,
      rawText: MULTI_POST_TEXT,
      sourceType: 'linkedin_post',
      actor: 'admin:test@example.com',
    });

    expect(submitted.capture.raw_text).toBe(MULTI_POST_TEXT.trim());
    expect(submitted.sourceKey).toBe('linkedin:7788990011');

    // 2. Process capture with AI
    const result = await processCapture(store, ai, submitted.capture.id, {
      actor: 'admin:test@example.com',
      siteUrl: SITE_URL,
    });

    expect(result.genuine).toBe(true);
    // 5 separate opportunity records created
    expect(result.opportunities).toHaveLength(5);
    expect(store.opportunities).toHaveLength(5);

    // 3. Verify each opening has correct individual information and distinct opening_key
    const titles = result.opportunities!.map((o) => o.title);
    expect(titles).toEqual([
      'Founder Associate',
      'Growth Manager',
      'Business Operations Intern',
      'Product Analyst',
      'Senior Frontend Engineer',
    ]);

    const openingKeys = result.opportunities!.map((o) => o.opening_key);
    expect(openingKeys).toEqual([1, 2, 3, 4, 5]);

    // All remain linked to the original LinkedIn post
    for (const opp of result.opportunities!) {
      expect(opp.source_capture_id).toBe(submitted.capture.id);
      expect(opp.status).toBe('pending_review');
      expect(opp.published_at).toBeNull();
      expect(opp.publication_number).toBeNull();
    }

    // 4. Verify every opportunity retains its own correct application URL or email
    const fa = result.opportunities![0];
    expect(fa.application_method).toBe('external_url');
    expect(fa.application_url).toBe('https://acme.test/apply/founder-associate');
    expect(fa.work_mode).toBe('onsite');
    expect(fa.salary_min).toBe(1200000);

    const gm = result.opportunities![1];
    expect(gm.application_method).toBe('external_url');
    expect(gm.application_url).toBe('https://acme.test/apply/growth-manager');
    expect(gm.work_mode).toBe('remote');

    const intern = result.opportunities![2];
    expect(intern.application_method).toBe('email');
    expect(intern.recruitment_email).toBe('jobs@acme.test');
    expect(intern.employment_type).toBe('internship');

    const pa = result.opportunities![3];
    expect(pa.application_method).toBe('external_url');
    expect(pa.application_url).toBe('https://acme.test/apply/product-analyst');

    const fe = result.opportunities![4];
    expect(fe.application_method).toBe('external_url');
    expect(fe.application_url).toBe('https://acme.test/apply/frontend-engineer');

    // 5. Review and approve ONLY THREE openings (e.g., #1, #2, and #3)
    // Reject #4, leave #5 pending_review
    const pub1 = await publishOpportunity(store, fa.id, 'admin:test@example.com', SITE_URL);
    const pub2 = await publishOpportunity(store, gm.id, 'admin:test@example.com', SITE_URL);
    const pub3 = await publishOpportunity(store, intern.id, 'admin:test@example.com', SITE_URL);
    await transitionOpportunity(store, pa.id, 'reject', 'admin:test@example.com', SITE_URL);

    // 6. Verify only those three appear on public search
    const publicSearch = await store.searchPublic({});
    expect(publicSearch.total).toBe(3);
    const publicIds = publicSearch.items.map((item) => item.id);
    expect(publicIds).toContain(fa.id);
    expect(publicIds).toContain(gm.id);
    expect(publicIds).toContain(intern.id);
    expect(publicIds).not.toContain(pa.id); // rejected
    expect(publicIds).not.toContain(fe.id); // pending review

    // 7. Verify each has its own unique working detail page URL
    expect(pub1.listingUrl).toBe(`${SITE_URL}/opportunities/${fa.slug}`);
    expect(pub2.listingUrl).toBe(`${SITE_URL}/opportunities/${gm.slug}`);
    expect(pub3.listingUrl).toBe(`${SITE_URL}/opportunities/${intern.slug}`);
    const uniqueSlugs = new Set([fa.slug, gm.slug, intern.slug, pa.slug, fe.slug]);
    expect(uniqueSlugs.size).toBe(5);

    // 8. Verify atomic sequential comment numbering
    expect(pub1.opportunity.publication_number).toBe(1);
    expect(pub2.opportunity.publication_number).toBe(2);
    expect(pub3.opportunity.publication_number).toBe(3);

    const comment1 = generateFixedComment(pub1.opportunity.publication_number!, SITE_URL);
    const comment2 = generateFixedComment(pub2.opportunity.publication_number!, SITE_URL);
    const comment3 = generateFixedComment(pub3.opportunity.publication_number!, SITE_URL);

    expect(comment1).toBe(`Explore more 1 similar opportunities at Hustler Community: ${SITE_URL}/opportunities`);
    expect(comment2).toBe(`Explore more 2 similar opportunities at Hustler Community: ${SITE_URL}/opportunities`);
    expect(comment3).toBe(`Explore more 3 similar opportunities at Hustler Community: ${SITE_URL}/opportunities`);

    // Verify retry of already published does not re-allocate number
    const retryPub1 = await publishOpportunity(store, fa.id, 'admin:test@example.com', SITE_URL);
    expect(retryPub1.alreadyPublished).toBe(true);
    expect(retryPub1.opportunity.publication_number).toBe(1);

    // 9. Submit the same post again and verify duplicate protection
    await expect(
      submitCapture(store, {
        sourceUrl: MULTI_POST_URL,
        rawText: MULTI_POST_TEXT,
        sourceType: 'linkedin_post',
        actor: 'admin:test@example.com',
      }),
    ).rejects.toMatchObject({ code: 'duplicate', status: 409 });
  });

  it('handles Telegram submission of multi-opening post and individual button approvals', async () => {
    const { store } = await seedStore();
    const messenger = new RecordingMessenger();
    const ai = multiOpeningAI();

    // 10. Admin sends Telegram update with multi-opening post
    await handleTelegramUpdate(
      {
        update_id: 101,
        message: {
          message_id: 101,
          from: { id: 111, first_name: 'Pasha' },
          chat: { id: 999, type: 'private' },
          text: `${MULTI_POST_URL}\n${MULTI_POST_TEXT}`,
        },
      },
      { store, ai, env: testEnv(), messenger },
    );

    // 5 opportunities created in store
    expect(store.opportunities).toHaveLength(5);

    // Bot sent previews for all openings with buttons
    const previews = messenger.sent.filter((m) => m.text.includes('Opportunity preview'));
    expect(previews).toHaveLength(5);

    // Approve the second opening via callback query
    const opening2 = store.opportunities[1];
    await handleTelegramUpdate(
      {
        update_id: 102,
        callback_query: {
          id: 'cb-102',
          from: { id: 111, first_name: 'Pasha' },
          message: { message_id: 502, chat: { id: 999, type: 'private' } },
          data: `pub:${opening2.id}`,
        },
      },
      { store, ai, env: testEnv(), messenger },
    );

    const updated2 = await store.getOpportunityById(opening2.id);
    expect(updated2?.status).toBe('published');
    expect(updated2?.publication_number).toBe(1);

    // Bot edited the message with published link and fixed comment template
    const edit = messenger.edits.find((e) => e.text.includes('Published'));
    expect(edit).toBeTruthy();
    expect(edit?.text).toContain(`${SITE_URL}/opportunities/${opening2.slug}`);
    expect(edit?.text).toContain('Explore more 1 similar opportunities at Hustler Community:');
  });

  it('preserves source capture when Groq AI fails and allows retry', async () => {
    const { store } = await seedStore();

    const submitted = await submitCapture(store, {
      sourceUrl: MULTI_POST_URL,
      rawText: MULTI_POST_TEXT,
      sourceType: 'linkedin_post',
      actor: 'admin:test@example.com',
    });

    const failingAI: AIProvider = {
      name: 'groq-failing',
      async extract(): Promise<unknown> {
        throw new Error('Groq rate limit 429');
      },
    };

    await expect(
      processCapture(store, failingAI, submitted.capture.id, {
        actor: 'admin:test@example.com',
        siteUrl: SITE_URL,
      }),
    ).rejects.toThrow(/rate limit/i);

    const capture = await store.getCapture(submitted.capture.id);
    expect(capture?.status).toBe('extraction_failed');
    expect(capture?.raw_text).toBe(MULTI_POST_TEXT.trim());
    expect(store.opportunities).toHaveLength(0);

    // Safe retry with working AI
    const retried = await retryCapture(store, multiOpeningAI(), submitted.capture.id, {
      actor: 'admin:test@example.com',
      siteUrl: SITE_URL,
    });
    expect(retried.opportunities).toHaveLength(5);
    expect(retried.capture.status).toBe('needs_review');
    expect(retried.capture.attempt_count).toBe(2);
  });

  it('resumes a partially persisted extraction without losing or duplicating openings', async () => {
    const { store } = await seedStore();
    const submitted = await submitCapture(store, {
      sourceUrl: MULTI_POST_URL,
      rawText: MULTI_POST_TEXT,
      sourceType: 'linkedin_post',
      actor: 'admin:test@example.com',
    });

    // Fail exactly one opening, as if a write failed mid-loop after the other
    // openings of the same capture had already been stored.
    const originalCreate = store.createOpportunity.bind(store);
    store.createOpportunity = async (draft) => {
      if (draft.title === 'Business Operations Intern') {
        throw new Error('Database write failed.');
      }
      return originalCreate(draft);
    };

    await expect(
      processCapture(store, multiOpeningAI(), submitted.capture.id, {
        actor: 'admin:test@example.com',
        siteUrl: SITE_URL,
      }),
    ).rejects.toThrow(/Database write failed/);

    // Let the concurrently started openings settle before inspecting the store.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const failed = await store.getCapture(submitted.capture.id);
    expect(failed?.status).toBe('extraction_failed');
    const partial = store.opportunities.filter((o) => o.source_capture_id === submitted.capture.id);
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(5);

    store.createOpportunity = originalCreate;

    const retried = await retryCapture(store, multiOpeningAI(), submitted.capture.id, {
      actor: 'admin:test@example.com',
      siteUrl: SITE_URL,
    });

    const rows = store.opportunities.filter((o) => o.source_capture_id === submitted.capture.id);
    expect(rows).toHaveLength(5);
    expect(rows.map((o) => o.opening_key).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(rows.map((o) => o.title)).size).toBe(5);
    expect(new Set(rows.map((o) => o.slug)).size).toBe(5);
    expect(retried.opportunities).toHaveLength(5);
    expect(retried.capture.status).toBe('needs_review');
    // The capture's own openings must not be reported as duplicates of itself.
    expect(retried.potentialDuplicates).toHaveLength(0);
    expect(retried.warnings.some((w) => /duplicate/i.test(w))).toBe(false);
  });

  it('excludes a capture\'s own openings from duplicate candidates', async () => {
    const { store } = await seedStore();
    const submitted = await submitCapture(store, {
      sourceUrl: MULTI_POST_URL,
      rawText: MULTI_POST_TEXT,
      sourceType: 'linkedin_post',
      actor: 'admin:test@example.com',
    });

    const result = await processCapture(store, multiOpeningAI(), submitted.capture.id, {
      actor: 'admin:test@example.com',
      siteUrl: SITE_URL,
    });
    expect(result.opportunities).toHaveLength(5);

    expect(await store.recentDuplicateCandidates(300)).toHaveLength(5);
    expect(await store.recentDuplicateCandidates(300, submitted.capture.id)).toHaveLength(0);
  });

  it('finds an opportunity by source key and opening key', async () => {
    const { store } = await seedStore();
    const submitted = await submitCapture(store, {
      sourceUrl: MULTI_POST_URL,
      rawText: MULTI_POST_TEXT,
      sourceType: 'linkedin_post',
      actor: 'admin:test@example.com',
    });

    await processCapture(store, multiOpeningAI(), submitted.capture.id, {
      actor: 'admin:test@example.com',
      siteUrl: SITE_URL,
    });

    const third = await store.findOpportunityByOpening('linkedin:7788990011', 3);
    expect(third?.title).toBe('Business Operations Intern');
    expect(await store.findOpportunityByOpening('linkedin:7788990011', 99)).toBeNull();
  });
});
