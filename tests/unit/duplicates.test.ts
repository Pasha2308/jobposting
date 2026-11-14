import { describe, expect, it } from 'vitest';
import { checkDuplicates, companyKey, similarity } from '../../src/lib/domain/duplicates';

const existing = [
  {
    id: 'one',
    title: 'Founding Full Stack Engineer',
    companyName: 'Acme Labs',
    source_url: 'https://www.linkedin.com/posts/acme_founder-1234567890',
    discovered_at: '2026-01-10T10:00:00.000Z',
  },
  {
    id: 'two',
    title: 'Product Designer',
    companyName: 'Beta Studio',
    source_url: 'https://example.com/jobs/product-designer',
    discovered_at: '2026-01-10T10:00:00.000Z',
  },
];

describe('checkDuplicates', () => {
  it('blocks an exact duplicate through normalised URLs', () => {
    const result = checkDuplicates(
      {
        title: 'Founding Full Stack Engineer',
        companyName: 'Acme Labs',
        source_url: 'https://m.linkedin.com/posts/acme_founder-1234567890?utm_source=share',
        discovered_at: '2026-01-12T10:00:00.000Z',
      },
      existing,
    );
    expect(result.exact).toBe(true);
    expect(result.exactReason).toMatch(/already been captured/i);
    expect(result.potential).toHaveLength(0);
  });

  it('blocks an exact duplicate through an explicit canonical key', () => {
    const result = checkDuplicates(
      {
        title: 'Anything',
        companyName: 'Anything',
        source_url: null,
        normalized_source_key: 'linkedin:1234567890',
        discovered_at: '2026-01-12T10:00:00.000Z',
      },
      existing,
    );
    expect(result.exact).toBe(true);
  });

  it('flags a similar role at the same company without merging', () => {
    const result = checkDuplicates(
      {
        title: 'Senior Full Stack Engineer',
        companyName: 'Acme Labs Pvt Ltd',
        source_url: 'https://example.com/other-post',
        discovered_at: '2026-01-20T10:00:00.000Z',
      },
      existing,
    );
    expect(result.exact).toBe(false);
    expect(result.potential.length).toBeGreaterThan(0);
    expect(result.potential[0].title).toBe('Founding Full Stack Engineer');
    expect(result.potential[0].reason).toMatch(/same company/i);
  });

  it('does not flag an unrelated role', () => {
    const result = checkDuplicates(
      {
        title: 'Growth Marketing Lead',
        companyName: 'Gamma Ventures',
        source_url: 'https://example.com/growth',
        discovered_at: '2026-01-20T10:00:00.000Z',
      },
      existing,
    );
    expect(result.exact).toBe(false);
    expect(result.potential).toHaveLength(0);
  });

  it('normalises company suffixes for comparison', () => {
    expect(companyKey('Acme Technologies Pvt. Ltd.')).toBe(companyKey('Acme'));
    expect(similarity('Founding Engineer', 'Founding Engineer')).toBe(1);
  });
});
