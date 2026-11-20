import { describe, expect, it } from 'vitest';
import { excerpt, plainText } from '../../src/lib/domain/text';

describe('plainText', () => {
  it('cleans escaped HTML descriptions and decodes common entities', () => {
    const source = '&lt;div&gt;&lt;h2&gt;Who we are&lt;/h2&gt;&lt;p&gt;Stripe is &amp;mdash; building payments.&lt;/p&gt;';
    expect(plainText(source)).toBe('Who we are\nStripe is — building payments.');
  });

  it('removes scripts, styles and nested escaping without leaving markup', () => {
    expect(plainText('&amp;lt;p&amp;gt;Good&amp;lt;/p&amp;gt;&lt;script&gt;bad()&lt;/script&gt;'))
      .toBe('Good');
  });

  it('keeps bounded excerpts readable', () => {
    expect(excerpt('<p>One two three four five</p>', 12)).toBe('One two…');
  });
});
