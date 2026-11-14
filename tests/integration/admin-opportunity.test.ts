import { describe, expect, it } from 'vitest';
import {
  createOpportunityManually,
  saveOpportunity,
  setVerification,
} from '../../src/lib/services/admin-opportunity';
import { publishOpportunity } from '../../src/lib/services/publishing';
import { ServiceError } from '../../src/lib/services/errors';
import { seedStore, SITE_URL, VALID_OPPORTUNITY_INPUT } from '../helpers';

describe('admin opportunity editing', () => {
  it('creates a draft even when the form looks publishable', async () => {
    const { store, categoryId, companyId } = await seedStore();
    const result = await createOpportunityManually(
      store,
      {
        ...VALID_OPPORTUNITY_INPUT,
        category_id: categoryId,
        company_id: companyId,
      },
      { actor: 'admin:test@example.com', siteUrl: SITE_URL },
    );

    expect(result.opportunity.status).toBe('draft');
    expect(result.opportunity.published_at).toBeNull();
    expect(result.opportunity.company?.name).toBe('Acme Labs');
    expect(result.opportunity.category?.name).toBe('Engineering');
    expect(result.opportunity.canonical_source_key).toBe('linkedin:1234567890');
  });

  it('requires a category before creating a draft', async () => {
    const { store, companyId } = await seedStore();
    await expect(
      createOpportunityManually(
        store,
        { ...VALID_OPPORTUNITY_INPUT, category_id: null, company_id: companyId },
        { actor: 'admin:test@example.com', siteUrl: SITE_URL },
      ),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it('saves edits and records verification without changing system timestamps', async () => {
    const { store, categoryId, companyId } = await seedStore();
    const created = await createOpportunityManually(
      store,
      { ...VALID_OPPORTUNITY_INPUT, category_id: categoryId, company_id: companyId },
      { actor: 'admin:test@example.com', siteUrl: SITE_URL },
    );
    const discoveredAt = created.opportunity.discovered_at;

    const saved = await saveOpportunity(
      store,
      created.opportunity.id,
      {
        ...VALID_OPPORTUNITY_INPUT,
        category_id: categoryId,
        company_id: companyId,
        title: 'Founding Product Engineer',
      },
      { actor: 'admin:test@example.com', siteUrl: SITE_URL },
    );
    expect(saved.opportunity.title).toBe('Founding Product Engineer');
    expect(saved.opportunity.discovered_at).toBe(discoveredAt);
    expect(saved.opportunity.published_at).toBeNull();

    const verified = await setVerification(store, created.opportunity.id, 'source_open', 'admin:test@example.com');
    expect(verified.verification_status).toBe('source_open');
    expect(verified.last_verified_at).toBeTruthy();
  });

  it('does not allow a published listing to be saved into an invalid state', async () => {
    const { store, categoryId, companyId } = await seedStore();
    const created = await createOpportunityManually(
      store,
      { ...VALID_OPPORTUNITY_INPUT, category_id: categoryId, company_id: companyId },
      { actor: 'admin:test@example.com', siteUrl: SITE_URL },
    );
    await publishOpportunity(store, created.opportunity.id, 'admin:test@example.com', SITE_URL);

    await expect(
      saveOpportunity(
        store,
        created.opportunity.id,
        {
          ...VALID_OPPORTUNITY_INPUT,
          category_id: categoryId,
          company_id: companyId,
          application_method: 'external_url',
          application_url: null,
          careers_url: null,
          recruitment_email: null,
        },
        { actor: 'admin:test@example.com', siteUrl: SITE_URL },
      ),
    ).rejects.toMatchObject({ code: 'not_publishable' });

    const unchanged = await store.getOpportunityById(created.opportunity.id);
    expect(unchanged?.application_url).toBe('https://acme.test/careers/founding-engineer');
  });
});
