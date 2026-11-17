import type { RetrievalMethod, SourceComment } from '../domain/types';

/**
 * Why a retrieval attempt did not produce usable source text.
 *
 * - retrieval_not_authorised: no authorised adapter is enabled. The URL is kept.
 * - unsupported_url: not a LinkedIn post/activity URL.
 * - blocked_host: redirect or URL left the LinkedIn allowlist.
 * - login_required: LinkedIn served an authwall/signup page. Never bypassed.
 * - not_found: the post does not exist or was deleted.
 * - no_content: page loaded but no parseable public post content.
 * - rate_limited: LinkedIn returned 429/999.
 * - http_error: another non-success status.
 * - timeout: the request exceeded the deadline.
 * - too_large: response exceeded the size cap.
 * - network_error: transport failure.
 */
export type RetrievalErrorCode =
  | 'retrieval_not_authorised'
  | 'unsupported_url'
  | 'blocked_host'
  | 'login_required'
  | 'not_found'
  | 'no_content'
  | 'rate_limited'
  | 'http_error'
  | 'timeout'
  | 'too_large'
  | 'network_error';

export type RetrievedPost = {
  canonicalUrl: string;
  activityId: string | null;
  author: string | null;
  postedAt: string | null;
  headline: string | null;
  articleBody: string | null;
  sharedContent: {
    headline: string | null;
    description: string | null;
    articleBody: string | null;
  } | null;
  comments: SourceComment[];
  /** Assembled text handed to the AI; includes author, repost and comments. */
  text: string;
  metadata: Record<string, unknown>;
};

export type RetrievalSuccess = {
  ok: true;
  method: RetrievalMethod;
  httpStatus: number;
  post: RetrievedPost;
};

export type RetrievalFailure = {
  ok: false;
  method: RetrievalMethod | null;
  errorCode: RetrievalErrorCode;
  httpStatus: number | null;
  message: string;
  /** True only for transient transport/HTTP failures; never for access blocks. */
  retryable: boolean;
};

export type RetrievalResult = RetrievalSuccess | RetrievalFailure;

export type RetrievalFn = (url: string) => Promise<RetrievalResult>;

export function retrievalFailure(
  errorCode: RetrievalErrorCode,
  message: string,
  opts: { method?: RetrievalMethod | null; httpStatus?: number | null; retryable?: boolean } = {},
): RetrievalFailure {
  return {
    ok: false,
    method: opts.method ?? null,
    errorCode,
    httpStatus: opts.httpStatus ?? null,
    message,
    retryable: opts.retryable ?? false,
  };
}
