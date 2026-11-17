import { describe, expect, it } from 'vitest';
import {
  assembleSourceText,
  decodeHtmlEntities,
  extractJsonLdBlocks,
  parseLinkedInHtml,
} from '../../src/lib/linkedin/parse';
import { canonicalLinkedInPostUrl } from '../../src/lib/domain/url';

const CANONICAL = canonicalLinkedInPostUrl('1234567890');

function page(blocks: string[]): string {
  return `<!doctype html><html><head>${blocks
    .map((block) => `<script type="application/ld+json">${block}</script>`)
    .join('')}</head><body></body></html>`;
}

const PUBLIC_POST = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'SocialMediaPosting',
  author: { '@type': 'Person', name: 'Acme Founder' },
  datePublished: '2026-02-01T09:30:00.000Z',
  headline: 'We are hiring a Founder Associate',
  articleBody:
    'Acme Labs is hiring a Founder Associate to work directly with the founders. Apply: https://acme.test/apply/founder-associate',
});

describe('parseLinkedInHtml', () => {
  it('extracts the public post body, author and date', () => {
    const post = parseLinkedInHtml(page([PUBLIC_POST]), CANONICAL, '1234567890');
    expect(post).not.toBeNull();
    expect(post?.author).toBe('Acme Founder');
    expect(post?.postedAt).toBe('2026-02-01T09:30:00.000Z');
    expect(post?.headline).toBe('We are hiring a Founder Associate');
    expect(post?.articleBody).toContain('Acme Labs is hiring a Founder Associate');
    expect(post?.text).toContain('Post author: Acme Founder');
    expect(post?.text).toContain('https://acme.test/apply/founder-associate');
    expect(post?.metadata.activity_id).toBe('1234567890');
  });

  it('includes reposted/shared content in the source text', () => {
    const repost = JSON.stringify({
      '@type': 'SocialMediaPosting',
      author: { name: 'Sharer' },
      headline: 'Sharing this great role',
      articleBody: 'My comment on the repost.',
      sharedContent: {
        '@type': 'Article',
        headline: 'Senior Backend Engineer',
        articleBody: 'We are hiring a Senior Backend Engineer. Apply: https://acme.test/apply/backend',
      },
    });

    const post = parseLinkedInHtml(page([repost]), CANONICAL, '1234567890');
    expect(post).not.toBeNull();
    expect(post?.sharedContent?.headline).toBe('Senior Backend Engineer');
    expect(post?.text).toContain('Reposted / shared content');
    expect(post?.text).toContain('We are hiring a Senior Backend Engineer');
    expect(post?.metadata.has_shared_content).toBe(true);
  });

  it('preserves author comment links that carry per-role apply routes', () => {
    const withComment = JSON.stringify({
      '@type': 'SocialMediaPosting',
      author: { name: 'Acme Founder' },
      articleBody: 'Five roles open at Acme Labs.',
      comment: [
        {
          '@type': 'Comment',
          author: { name: 'Acme Founder' },
          text: 'Founder Associate: https://acme.test/apply/founder-associate\nGrowth Manager: https://acme.test/apply/growth',
        },
        {
          '@type': 'Comment',
          author: { name: 'Someone Else' },
          text: 'Is this remote?',
        },
      ],
    });

    const post = parseLinkedInHtml(page([withComment]), CANONICAL, '1234567890');
    expect(post?.comments).toHaveLength(2);
    expect(post?.comments[0].is_author).toBe(true);
    expect(post?.comments[0].links).toEqual([
      'https://acme.test/apply/founder-associate',
      'https://acme.test/apply/growth',
    ]);
    expect(post?.comments[1].is_author).toBe(false);
    expect(post?.text).toContain('Links in this comment');
  });

  it('returns null when the page has no post content', () => {
    const organisation = JSON.stringify({
      '@type': 'Organization',
      name: 'Acme Labs',
      url: 'https://acme.test',
    });
    expect(parseLinkedInHtml(page([organisation]), CANONICAL, '1234567890')).toBeNull();
    expect(parseLinkedInHtml('<html><body>Nothing here</body></html>', CANONICAL, null)).toBeNull();
  });

  it('skips malformed JSON-LD blocks instead of failing the page', () => {
    const html = page(['{"@type": "SocialMediaPosting", broken', PUBLIC_POST]);
    const post = parseLinkedInHtml(html, CANONICAL, '1234567890');
    expect(post).not.toBeNull();
    expect(post?.articleBody).toContain('Founder Associate');
  });

  it('handles @graph wrappers and multiple blocks', () => {
    const graph = JSON.stringify({
      '@graph': [
        { '@type': 'Organization', name: 'Acme Labs' },
        {
          '@type': 'SocialMediaPosting',
          author: { name: 'Acme Founder' },
          articleBody: 'Hiring a Product Analyst.',
        },
      ],
    });
    const post = parseLinkedInHtml(page([graph]), CANONICAL, '1234567890');
    expect(post?.author).toBe('Acme Founder');
    expect(post?.articleBody).toBe('Hiring a Product Analyst.');
  });
});

describe('extractJsonLdBlocks', () => {
  it('returns each valid object and ignores invalid JSON', () => {
    const blocks = extractJsonLdBlocks(
      page([JSON.stringify({ '@type': 'Article', articleBody: 'x' }), 'not-json']),
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]['@type']).toBe('Article');
  });
});

describe('decodeHtmlEntities / assembleSourceText', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeHtmlEntities('R&amp;D&nbsp;role &#39;remote&#39; &#x2713;')).toBe("R&D role 'remote' ✓");
  });

  it('keeps sections separated and adds a links line', () => {
    const text = assembleSourceText({
      canonicalUrl: CANONICAL,
      activityId: '1234567890',
      author: 'Acme Founder',
      postedAt: '2026-02-01',
      headline: 'Hiring',
      articleBody: 'Two roles.',
      sharedContent: { headline: 'Reposted role', description: null, articleBody: 'Backend.' },
      comments: [{ author: 'Acme Founder', text: 'Apply for role 1', links: ['https://acme.test/1'], is_author: true }],
    });
    expect(text).toContain('Post author: Acme Founder');
    expect(text).toContain('--- Reposted / shared content ---');
    expect(text).toContain('--- Comments on the post');
    expect(text).toContain('Comment by the post author:');
    expect(text).toContain('Links in this comment: https://acme.test/1');
  });
});
