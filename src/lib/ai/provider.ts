/**
 * AI provider abstraction. Gemini is the first implementation; adding another
 * provider means implementing this interface and selecting it in
 * `createAIProvider`. Nothing else in the app depends on Gemini specifics.
 */

import type { SourceComment } from '../domain/types';

export type ExtractionRequest = {
  sourceText: string;
  sourceUrl: string | null;
  submittedCompany: string | null;
  categorySlugs: { slug: string; name: string }[];
  /** Retrieved provenance, when available. The source text already includes it. */
  sourceMeta?: {
    author: string | null;
    postedAt: string | null;
    headline: string | null;
    comments: SourceComment[];
    hasSharedContent: boolean;
  } | null;
};

export interface AIProvider {
  readonly name: string;
  extract(request: ExtractionRequest): Promise<unknown>;
  /**
   * Optional cheap second call that lists every role title mentioned in the
   * source. Used to flag coverage gaps on multi-opening posts. Providers may
   * omit it; extraction must never fail because coverage checking is missing.
   */
  listRoles?(request: ExtractionRequest): Promise<string[]>;
}

export type AIErrorKind =
  | 'not_configured'
  | 'quota'
  | 'timeout'
  | 'auth'
  | 'malformed'
  | 'unavailable'
  | 'invalid_response';

export class AIError extends Error {
  kind: AIErrorKind;
  retryable: boolean;
  constructor(kind: AIErrorKind, message: string, retryable = false) {
    super(message);
    this.name = 'AIError';
    this.kind = kind;
    this.retryable = retryable;
  }
}

/** Remove code fences and surrounding prose before JSON parsing. */
export function extractJsonPayload(text: string): unknown {
  const cleaned = text
    .replace(/^\uFEFF/, '')
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    throw new AIError('malformed', 'The AI provider returned a response that was not valid JSON.', true);
  }
}
