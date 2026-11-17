import { describe, expect, it } from 'vitest';
import {
  canonicalSourceKey,
  extractLinkedInPostId,
  isSafeEmail,
  isValidHttpUrl,
  normalizeEmail,
  normalizeSourceUrl,
  safeOutboundUrl,
  slugify,
} from '../../src/lib/domain/url';

describe('normalizeSourceUrl', () => {
  it('lowercases the host, drops www/m and tracking parameters', () => {
    expect(
      normalizeSourceUrl('https://WWW.Example.com/Jobs/Founder/?utm_source=linkedin&utm_medium=social&ref=abc#apply'),
    ).toBe('https://example.com/Jobs/Founder');
  });

  it('collapses equivalent LinkedIn post URLs to the activity id', () => {
    const variants = [
      'https://www.linkedin.com/posts/acme_founder-role-1234567890?utm_source=share',
      'https://m.linkedin.com/posts/acme_founder-role-1234567890',
      'https://linkedin.com/posts/acme_founder-role-1234567890/',
    ];
    const normalized = variants.map((url) => normalizeSourceUrl(url));
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe('https://www.linkedin.com/feed/update/urn:li:activity:1234567890');
  });

  it('adds https when the scheme is missing and keeps real query parameters', () => {
    expect(normalizeSourceUrl('example.com/role?team=engineering')).toBe('https://example.com/role?team=engineering');
  });

  it('rejects non-http protocols and invalid input', () => {
    expect(normalizeSourceUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeSourceUrl('ftp://example.com/file')).toBeNull();
    expect(normalizeSourceUrl('')).toBeNull();
    expect(normalizeSourceUrl(null)).toBeNull();
  });
});

describe('LinkedIn post ids', () => {
  it('extracts ids from post, feed and activity URLs', () => {
    expect(extractLinkedInPostId('https://www.linkedin.com/posts/acme_hiring-1234567890')).toBe('1234567890');
    expect(extractLinkedInPostId('https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678')).toBe(
      '7123456789012345678',
    );
    expect(extractLinkedInPostId('https://www.linkedin.com/feed/update/urn:li:share:7123456789012345678')).toBe(
      '7123456789012345678',
    );
  });

  it('returns null for non-post URLs', () => {
    expect(extractLinkedInPostId('https://example.com/careers')).toBeNull();
    expect(extractLinkedInPostId('https://www.linkedin.com/company/acme')).toBeNull();
  });

  it('canonical keys prefer the LinkedIn post id', () => {
    expect(canonicalSourceKey('https://example.com/careers', '1234567890')).toBe('linkedin:1234567890');
    expect(canonicalSourceKey('https://example.com/careers/', null)).toBe('https://example.com/careers');
  });
});

describe('outbound URL and email safety', () => {
  it('only allows http(s) application URLs', () => {
    expect(safeOutboundUrl('https://acme.test/careers')).toBe('https://acme.test/careers');
    expect(safeOutboundUrl('javascript:alert(1)')).toBeNull();
    expect(safeOutboundUrl('mailto:jobs@acme.test')).toBeNull();
    expect(safeOutboundUrl('https://user:pass@acme.test/careers')).toBeNull();
    expect(safeOutboundUrl('')).toBeNull();
  });

  it('validates and normalises email addresses', () => {
    expect(normalizeEmail(' Jobs@Acme.TEST ')).toBe('jobs@acme.test');
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeEmail('line\nbreak@acme.test')).toBeNull();
    expect(isSafeEmail('a@b.co')).toBe(true);
  });

  it('rejects non-http URLs', () => {
    expect(isValidHttpUrl('https://acme.test')).toBe(true);
    expect(isValidHttpUrl('ftp://acme.test')).toBe(false);
    expect(isValidHttpUrl('not a url')).toBe(false);
  });
});

describe('slugify', () => {
  it('creates stable, readable slugs', () => {
    expect(slugify("Founder's Office & Strategy (Remote)")).toBe('founders-office-and-strategy-remote');
    expect(slugify('  ***  ')).toBe('');
  });
});
