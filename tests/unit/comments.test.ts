import { describe, expect, it } from 'vitest';
import { generateComments, validateComment } from '../../src/lib/domain/comments';

const base = {
  title: 'Founding Full Stack Engineer',
  companyName: 'Acme Labs',
  categoryName: 'Engineering',
  location: 'Bengaluru, India',
  isRemote: false,
  isInternship: false,
  listingUrl: 'https://opportunities.test/opportunities/founding-engineer',
  isPublished: false,
};

describe('generateComments', () => {
  it('creates exactly three distinct styles', () => {
    const comments = generateComments(base);
    expect(comments.map((comment) => comment.style)).toEqual(['professional', 'community', 'conversational']);
    expect(new Set(comments.map((comment) => comment.body)).size).toBe(3);
  });

  it('never includes a listing URL before publication', () => {
    const comments = generateComments(base);
    for (const comment of comments) {
      expect(comment.includesListingUrl).toBe(false);
      expect(comment.body).not.toContain(base.listingUrl);
      expect(comment.body).toMatch(/isn't live yet|queued for review/i);
    }
  });

  it('includes the public URL only after publication', () => {
    const comments = generateComments({ ...base, isPublished: true });
    for (const comment of comments) {
      expect(comment.includesListingUrl).toBe(true);
      expect(comment.body).toContain(base.listingUrl);
    }
  });

  it('only repeats reviewed facts and does not invent salary or benefits', () => {
    const comments = generateComments(base);
    const text = comments.map((comment) => comment.body).join(' ');
    expect(text).toContain('Acme Labs');
    expect(text).toContain('Founding Full Stack Engineer');
    expect(text).toContain('Bengaluru, India');
    expect(text).not.toMatch(/salary|stock options|equity|health insurance|bonus/i);
  });

  it('requires a title and company', () => {
    expect(() => generateComments({ ...base, title: '' })).toThrow();
    expect(() => generateComments({ ...base, companyName: '' })).toThrow();
  });
});

describe('validateComment', () => {
  it('accepts a factual comment', () => {
    expect(validateComment('Acme Labs is hiring a Founding Engineer.', { isPublished: false, listingUrl: null }).ok).toBe(
      true,
    );
  });

  it('rejects empty and oversized comments', () => {
    expect(validateComment('   ', { isPublished: false, listingUrl: null }).ok).toBe(false);
    expect(validateComment('a'.repeat(2001), { isPublished: false, listingUrl: null }).ok).toBe(false);
  });

  it('blocks a public URL before the listing is published', () => {
    const result = validateComment('Read more: https://opportunities.test/opportunities/founding', {
      isPublished: false,
      listingUrl: 'https://opportunities.test/opportunities/founding',
    });
    expect(result.ok).toBe(false);
    expect(result.issues.join(' ')).toMatch(/must not include/i);
  });

  it('blocks guarantees and exaggerated claims', () => {
    const result = validateComment('This is a guaranteed dream job. 100% placement.', {
      isPublished: true,
      listingUrl: null,
    });
    expect(result.ok).toBe(false);
    expect(result.issues.join(' ')).toMatch(/guarantees/i);
  });
});
