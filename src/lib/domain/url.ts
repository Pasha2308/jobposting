/**
 * URL normalisation and slug helpers. Pure functions — heavily unit tested.
 */

const TRACKING_PARAM_PATTERNS = [
  /^utm_/i,
  /^trk$/i,
  /^tracking/i,
  /^ref$/i,
  /^ref_src$/i,
  /^source$/i,
  /^original_referer$/i,
  /^lipi$/i,
  /^rcm$/i,
  /^fbclid$/i,
  /^gclid$/i,
];

export function isValidHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (!url.hostname.includes('.')) return false;
    if (url.username || url.password) return false;
    return true;
  } catch {
    return false;
  }
}

export function isSafeEmail(value: string | null | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length > 254 || /[\r\n]/.test(trimmed)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}

/**
 * Removes tracking junk, lowercases the host, strips hash fragments and a
 * trailing slash so equivalent LinkedIn URLs collapse to one canonical key.
 * LinkedIn post URLs are additionally reduced to their activity id when one
 * is present.
 */
export function normalizeSourceUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  let raw = input.trim();
  if (!raw) return null;

  // Reject any explicit non-http(s) scheme before we consider adding one.
  const scheme = raw.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme) {
    if (!/^https?$/i.test(scheme[1])) return null;
  } else {
    raw = `https://${raw}`;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname.includes('.')) return null;

  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  url.hash = '';

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM_PATTERNS.some((p) => p.test(key))) url.searchParams.delete(key);
  }
  url.searchParams.sort();

  if (url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com')) {
    const postId = extractLinkedInPostId(url);
    // `/posts/<id>` returns an empty page; the feed-update URN is the URL that
    // actually exposes public post content, so it is the canonical stored form.
    if (postId) return canonicalLinkedInPostUrl(postId);
  }

  let pathname = url.pathname.replace(/\/+$/, '');
  if (pathname === '') pathname = '/';
  const query = url.searchParams.toString();
  return `${url.protocol}//${url.hostname}${pathname}${query ? `?${query}` : ''}`;
}

export function extractLinkedInPostId(input: string | URL): string | null {
  const path = typeof input === 'string' ? safePath(input) : input.pathname;
  if (!path) return null;
  const patterns = [
    /\/feed\/update\/urn:li:activity:(\d+)/,
    /\/feed\/update\/urn:li:(?:share|ugcPost):(\d+)/,
    // LinkedIn /posts/ URLs may append a four-character share code after the
    // numeric activity id (e.g. ...-7526946904958668801-Aogk).
    /\/posts\/[^/?#]*[-_](\d{10,})(?:-[A-Za-z0-9]{4})?(?:[/?#]|$)/,
    /\/posts\/(\d{10,})(?:-[A-Za-z0-9]{4})?(?:[/?#]|$)/,
    /activity[:-](\d{10,})/,
    /\/pulse\/([A-Za-z0-9-]{6,})/,
  ];
  for (const p of patterns) {
    const m = path.match(p);
    if (m?.[1] && !['posts', 'update'].includes(m[1])) return m[1];
  }
  return null;
}

function safePath(value: string): string | null {
  try {
    return new URL(value, 'https://linkedin.com').pathname + new URL(value, 'https://linkedin.com').search;
  } catch {
    return null;
  }
}

export function canonicalSourceKey(sourceUrl: string | null, sourcePostId: string | null): string | null {
  if (sourcePostId) return `linkedin:${sourcePostId}`;
  return normalizeSourceUrl(sourceUrl);
}

/** Canonical public URL for a LinkedIn activity id. */
export function canonicalLinkedInPostUrl(postId: string): string {
  return `https://www.linkedin.com/feed/update/urn:li:activity:${postId}`;
}

export function isLinkedInHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return host === 'linkedin.com' || host === 'www.linkedin.com' || host === 'm.linkedin.com' || host === 'lnkd.in';
}

export function isLinkedInPostUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return isLinkedInHost(url.hostname) && extractLinkedInPostId(url) !== null;
  } catch {
    return false;
  }
}

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}

export function buildOpportunitySlug(title: string, company: string, discriminator?: string): string {
  const base = slugify(`${title}-${company}`) || 'opportunity';
  const suffix = (discriminator || '').replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase();
  return suffix ? `${base}-${suffix}` : base;
}

/**
 * Only http(s) URLs are allowed for outbound application actions. mailto: is
 * constructed separately from a validated email address.
 */
export function safeOutboundUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!isValidHttpUrl(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return isSafeEmail(trimmed) ? trimmed : null;
}

export function linkedInPostUrl(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null;
  const normalized = normalizeSourceUrl(sourceUrl);
  if (!normalized) return null;
  try {
    const host = new URL(normalized).hostname;
    return host === 'linkedin.com' || host.endsWith('.linkedin.com') ? normalized : null;
  } catch {
    return null;
  }
}
