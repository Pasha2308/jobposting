/**
 * AI provider abstraction. Gemini is the first implementation; adding another
 * provider means implementing this interface and selecting it in
 * `createAIProvider`. Nothing else in the app depends on Gemini specifics.
 */

export type ExtractionRequest = {
  sourceText: string;
  sourceUrl: string | null;
  submittedCompany: string | null;
  categorySlugs: { slug: string; name: string }[];
};

export interface AIProvider {
  readonly name: string;
  extract(request: ExtractionRequest): Promise<unknown>;
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
