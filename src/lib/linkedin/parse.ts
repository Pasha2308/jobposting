import type { SourceComment } from '../domain/types';
import type { RetrievedPost } from './types';

const PARSER_VERSION = 'linkedin-jsonld-1';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)));
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Every JSON-LD block on the page, parsed independently. Malformed blocks are skipped. */
export function extractJsonLdBlocks(html: string): JsonObject[] {
  const blocks: JsonObject[] = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) blocks.push(...parsed.filter(isObject));
      else if (isObject(parsed)) blocks.push(parsed);
    } catch {
      // A malformed block must not break the whole page.
    }
  }
  return blocks;
}

function flatten(objects: JsonObject[]): JsonObject[] {
  const out: JsonObject[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (depth > 4 || !value) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (!isObject(value)) return;
    out.push(value);
    const graph = value['@graph'];
    if (graph) visit(graph, depth + 1);
  };
  for (const object of objects) visit(object, 0);
  return out;
}

function typeNames(object: JsonObject): string[] {
  const raw = object['@type'];
  if (typeof raw === 'string') return [raw.toLowerCase()];
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase());
  return [];
}

function nameOf(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return stripTags(value);
  if (isObject(value)) {
    const name = value.name;
    if (typeof name === 'string' && name.trim()) return stripTags(name);
  }
  return null;
}

function firstText(object: JsonObject, keys: string[]): string | null {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === 'string' && value.trim()) return stripTags(value);
  }
  return null;
}

function candidateScore(object: JsonObject): number {
  const types = typeNames(object);
  let score = 0;
  if (types.includes('socialmediaposting')) score += 5;
  if (types.includes('article') || types.includes('blogposting')) score += 2;
  if (typeof object.articleBody === 'string' && object.articleBody.trim()) score += 4;
  if (typeof object.headline === 'string' && object.headline.trim()) score += 2;
  if (object.comment) score += 1;
  if (object.sharedContent) score += 2;
  if (object.datePublished) score += 1;
  return score;
}

function uniqueLinks(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  return [...new Set(found.map((link) => link.replace(/[.,;:]+$/, '')))];
}

function collectComments(object: JsonObject, author: string | null): SourceComment[] {
  const raw = object.comment;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const comments: SourceComment[] = [];
  for (const item of list) {
    if (!isObject(item)) continue;
    const body = firstText(item, ['text', 'commentText', 'description']);
    if (!body) continue;
    const commentAuthor = nameOf(item.author);
    const extra = firstText(item, ['url', '@id']);
    const links = uniqueLinks(body);
    if (extra && /^https?:\/\//i.test(extra) && !links.includes(extra)) links.push(extra);
    comments.push({
      author: commentAuthor,
      text: body.slice(0, 4000),
      links,
      is_author: Boolean(
        author && commentAuthor && commentAuthor.trim().toLowerCase() === author.trim().toLowerCase(),
      ),
    });
  }
  return comments;
}

function sharedContentOf(object: JsonObject): RetrievedPost['sharedContent'] {
  const raw = object.sharedContent;
  if (!isObject(raw)) return null;
  const shared = {
    headline: firstText(raw, ['headline', 'name']),
    description: firstText(raw, ['description', 'articleBody']),
    articleBody: firstText(raw, ['articleBody']),
  };
  return shared.headline || shared.description || shared.articleBody ? shared : null;
}

export function assembleSourceText(post: Omit<RetrievedPost, 'text' | 'metadata'>): string {
  const lines: string[] = [];
  if (post.author) lines.push(`Post author: ${post.author}`);
  if (post.postedAt) lines.push(`Posted: ${post.postedAt}`);
  if (post.headline) lines.push('', post.headline);
  if (post.articleBody) lines.push('', post.articleBody);
  if (post.sharedContent) {
    lines.push('', '--- Reposted / shared content ---');
    if (post.sharedContent.headline) lines.push(post.sharedContent.headline);
    if (post.sharedContent.description) lines.push(post.sharedContent.description);
    if (post.sharedContent.articleBody) lines.push(post.sharedContent.articleBody);
  }
  if (post.comments.length > 0) {
    lines.push('', '--- Comments on the post (may contain application links for individual roles) ---');
    for (const comment of post.comments) {
      lines.push(`Comment${comment.is_author ? ' by the post author' : comment.author ? ` by ${comment.author}` : ''}:`);
      lines.push(comment.text);
      if (comment.links.length > 0) lines.push(`Links in this comment: ${comment.links.join(' ')}`);
      lines.push('');
    }
  }
  return lines.join('\n').trim();
}

export function buildRetrievedPost(
  object: JsonObject,
  canonicalUrl: string,
  activityId: string | null,
): RetrievedPost | null {
  const author = nameOf(object.author) ?? nameOf(object.creator);
  const postedAt = firstText(object, ['datePublished', 'dateCreated', 'dateModified']);
  const headline = firstText(object, ['headline', 'name']);
  const articleBody = firstText(object, ['articleBody', 'description']);
  const sharedContent = sharedContentOf(object);
  const comments = collectComments(object, author);

  const hasContent = Boolean(articleBody || headline || sharedContent || comments.length);
  if (!hasContent) return null;

  const base = {
    canonicalUrl,
    activityId,
    author,
    postedAt,
    headline,
    articleBody,
    sharedContent,
    comments,
  };
  const text = assembleSourceText(base);
  if (!text.trim()) return null;

  return {
    ...base,
    text,
    metadata: {
      parser_version: PARSER_VERSION,
      types: typeNames(object),
      activity_id: activityId,
      comment_count: comments.length,
      has_shared_content: Boolean(sharedContent),
      article_body_chars: articleBody?.length ?? 0,
      source_chars: text.length,
    },
  };
}

/**
 * Parses LinkedIn's public JSON-LD. Returns null when the page contains no
 * usable post object, so callers classify it as `no_content` rather than
 * pretending extraction succeeded.
 */
export function parseLinkedInHtml(html: string, canonicalUrl: string, activityId: string | null): RetrievedPost | null {
  const candidates = flatten(extractJsonLdBlocks(html))
    .filter((object) => candidateScore(object) > 0)
    .sort((a, b) => candidateScore(b) - candidateScore(a));

  for (const candidate of candidates) {
    // A separate sharedContent object may carry the repost text; merge it in.
    let enriched = candidate;
    if (!candidate.sharedContent && candidates.length > 1) {
      const shared = candidates.find((other) => other !== candidate && candidateScore(other) > 0 && other.articleBody);
      if (shared && !shared.comment) enriched = { ...candidate, sharedContent: shared };
    }
    const post = buildRetrievedPost(enriched, canonicalUrl, activityId);
    if (post) return post;
  }
  return null;
}
