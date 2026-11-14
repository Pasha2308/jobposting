import type { CommentStyle } from './types';

export type CommentSource = {
  title: string;
  companyName: string;
  categoryName: string | null;
  location: string | null;
  isRemote: boolean;
  isInternship: boolean;
  listingUrl: string | null;
  isPublished: boolean;
};

export type GeneratedCommentSet = {
  style: CommentStyle;
  body: string;
  includesListingUrl: boolean;
};

/**
 * Deterministic, factual comment generator. It deliberately does not call an
 * LLM: every sentence here can only be produced from fields the administrator
 * has reviewed, so it cannot invent salary, benefits or requirements. When the
 * listing is not published yet, no URL is included and the copy does not claim
 * that it is live.
 */
export function generateComments(source: CommentSource): GeneratedCommentSet[] {
  if (!source.title || !source.companyName) {
    throw new Error('Comments require a role title and company name.');
  }

  const title = clean(source.title);
  const company = clean(source.companyName);
  const category = source.categoryName ? clean(source.categoryName) : null;
  const place = source.location ? clean(source.location) : null;
  const url = source.isPublished ? source.listingUrl : null;
  const includesListingUrl = Boolean(url);

  const rolePhrase = category ? `${category} role` : 'role';
  const where = source.isRemote ? 'remote' : place ? `in ${place}` : null;
  const whereClause = where ? ` (${where})` : '';
  const intern = source.isInternship;

  const liveLine = url
    ? `I've added a concise, factual listing to our free startup opportunities directory — it includes the details and the original application source.\n\n${url}`
    : `I've put together a concise, factual listing for our free startup opportunities directory. It isn't live yet; I'll share the link once it has been reviewed.`;

  const professional = [
    `Sharing for anyone exploring ${rolePhrase}s: ${company} is hiring a ${title}${whereClause}.`,
    liveLine,
    `Applications go through the original source, not this post.`,
  ].join('\n\n');

  const community = [
    `${company} is looking for a ${title}${whereClause}.`,
    intern
      ? `Early-career and internship opportunities like this are exactly why we keep the directory free and curated.`
      : `Roles that sit close to founders and small teams are often the fastest way to learn how companies are actually built.`,
    liveLine,
    `If it isn't the right fit for you, passing it to someone who is building their next step genuinely helps.`,
  ].join('\n\n');

  const conversational = [
    `Found a ${title} opening at ${company}${whereClause}.`,
    url
      ? `Listed it (free, no sign-up) in the startup opportunities directory with the original application link: ${url}`
      : `It's queued for review in our free startup opportunities directory. I'll drop the link when it's live.`,
    `Take a look if it's your kind of role.`,
  ].join('\n\n');

  return [
    { style: 'professional', body: professional, includesListingUrl },
    { style: 'community', body: community, includesListingUrl },
    { style: 'conversational', body: conversational, includesListingUrl },
  ];
}

export function validateComment(body: string, options: { isPublished: boolean; listingUrl: string | null }): {
  ok: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  if (!body.trim()) issues.push('Comment is empty.');
  if (body.length > 2000) issues.push('Comment exceeds 2,000 characters.');
  if (!options.isPublished && options.listingUrl && body.includes(options.listingUrl)) {
    issues.push('Unpublished listings must not include the public listing URL.');
  }
  if (/\b(guaranteed|guarantee|100%|instantly hired|dream job)\b/i.test(body)) {
    issues.push('Avoid guarantees or exaggerated claims.');
  }
  return { ok: issues.length === 0, issues };
}

export const COMMENT_STYLE_LABELS: Record<CommentStyle, string> = {
  professional: 'Professional',
  community: 'Community-focused',
  conversational: 'Short & conversational',
};

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
