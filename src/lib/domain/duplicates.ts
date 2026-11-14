import type { Opportunity } from './types';
import { extractLinkedInPostId, normalizeSourceUrl, slugify } from './url';

export type DuplicateCandidate = {
  id?: string;
  title: string;
  companyName: string | null;
  source_url: string | null;
  normalized_source_key?: string | null;
  original_posted_at?: string | null;
  discovered_at?: string | null;
};

export type DuplicateCheck = {
  exact: boolean;
  exactReason: string | null;
  potential: {
    id: string;
    title: string;
    companyName: string | null;
    source_url: string | null;
    score: number;
    reason: string;
  }[];
};

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'at',
  'of',
  'in',
  'a',
  'an',
  'to',
  'is',
  'are',
  'we',
  'our',
  'hiring',
  'job',
  'role',
  'opening',
  'opportunity',
  'remote',
  'full',
  'time',
  'part',
  'senior',
  'junior',
]);

export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t && t.length > 1 && !STOP_WORDS.has(t)),
  );
}

export function similarity(a: string, b: string): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const token of ta) if (tb.has(token)) shared += 1;
  return shared / Math.max(ta.size, tb.size);
}

export function companyKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const cleaned = name
    .toLowerCase()
    .replace(/\b(private|pvt|limited|ltd|inc|llc|technologies|technology|labs|studio|studios|ventures)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 40);
  return cleaned || null;
}

/**
 * Two layers of duplicate protection:
 *  1. Exact: same canonical source URL / LinkedIn post id — must be blocked.
 *  2. Potential: similar role + same company inside a 60 day window — flagged
 *     for a human, never merged automatically.
 */
export function checkDuplicates(candidate: DuplicateCandidate, existing: DuplicateCandidate[]): DuplicateCheck {
  const candidateUrl = sourceKey(candidate);
  const candidateCompany = companyKey(candidate.companyName);
  const candidateDate = parseDate(candidate.original_posted_at ?? candidate.discovered_at);

  if (candidateUrl) {
    const exact = existing.find((e) => {
      const url = sourceKey(e);
      return url != null && url === candidateUrl;
    });
    if (exact) {
      return {
        exact: true,
        exactReason: 'This source URL has already been captured. Open the existing capture instead of creating a second record.',
        potential: [],
      };
    }
  }

  const potential: DuplicateCheck['potential'] = [];
  for (const e of existing) {
    const score = similarity(candidate.title, e.title);
    const sameCompany = candidateCompany != null && candidateCompany === companyKey(e.companyName);
    const existingDate = parseDate(e.original_posted_at ?? e.discovered_at);
    const daysApart =
      candidateDate != null && existingDate != null
        ? Math.abs(candidateDate.getTime() - existingDate.getTime()) / 86_400_000
        : null;

    let combined = score * (sameCompany ? 1 : 0.55);
    if (daysApart != null) {
      if (daysApart <= 14) combined += 0.08;
      else if (daysApart > 90) combined -= 0.15;
    }
    if (sameCompany && score >= 0.55) combined = Math.max(combined, 0.6);
    if (combined >= 0.55) {
      potential.push({
        id: e.id ?? '',
        title: e.title,
        companyName: e.companyName,
        source_url: e.source_url,
        score: Math.round(combined * 100) / 100,
        reason: sameCompany
          ? `Similar role title at the same company${daysApart != null ? `, ${Math.round(daysApart)} days apart` : ''}.`
          : 'Similar role title. Different company name — confirm before merging.',
      });
    }
  }

  potential.sort((a, b) => b.score - a.score);
  return { exact: false, exactReason: null, potential: potential.slice(0, 5) };
}

export function duplicateGroupKey(o: Pick<Opportunity, 'title' | 'company_id' | 'original_posted_at' | 'discovered_at'>): string {
  const month = (o.original_posted_at ?? o.discovered_at ?? '').slice(0, 7);
  return `${slugify(o.title)}:${o.company_id ?? 'no-company'}:${month}`;
}

/**
 * Canonical identity for a source, so an explicit `linkedin:<id>` key and the
 * equivalent LinkedIn URL compare as the same capture.
 */
export function sourceKey(entry: Pick<DuplicateCandidate, 'source_url' | 'normalized_source_key'>): string | null {
  if (entry.normalized_source_key) {
    if (/^linkedin:/i.test(entry.normalized_source_key)) return entry.normalized_source_key.toLowerCase();
    const normalized = normalizeSourceUrl(entry.normalized_source_key) ?? entry.normalized_source_key;
    const id = extractLinkedInPostId(normalized);
    return id ? `linkedin:${id}` : normalized;
  }
  const normalized = normalizeSourceUrl(entry.source_url);
  if (!normalized) return null;
  const id = extractLinkedInPostId(normalized);
  return id ? `linkedin:${id}` : normalized;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const t = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isFinite(t) ? new Date(t) : null;
}
