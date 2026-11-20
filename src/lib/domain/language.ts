import { franc } from 'franc';

export type EnglishContentResult = { ok: true } | { ok: false; reason: string; detected?: string };

type JobText = {
  title?: string | null;
  summary?: string | null;
  responsibilities?: string[] | null;
  requirements?: string[] | null;
  skills?: string[] | null;
  preferred_skills?: string[] | null;
  education_requirements?: string[] | null;
  benefits?: string[] | null;
  application_instructions?: string | null;
};

/**
 * English-only publication guard. franc is an offline language detector; we
 * combine the prose so short titles and bullet points are not classified in
 * isolation, then inspect substantial individual fields to catch mixed-language
 * listings. Language requirements (for example, "Spanish required") are not
 * part of the description and are intentionally excluded.
 */
export function checkEnglishJobContent(job: JobText, sourceText?: string | null): EnglishContentResult {
  const fields = [
    job.title,
    job.summary,
    ...(job.responsibilities ?? []),
    ...(job.requirements ?? []),
    ...(job.skills ?? []),
    ...(job.preferred_skills ?? []),
    ...(job.education_requirements ?? []),
    ...(job.benefits ?? []),
    job.application_instructions,
  ].map((value) => value?.replace(/\s+/g, ' ').trim() ?? '').filter(Boolean);
  const combined = [sourceText?.replace(/\s+/g, ' ').trim(), ...fields].filter(Boolean).join('. ');
  const letters = combined.match(/[\p{L}]/gu)?.length ?? 0;
  if (letters < 80) return { ok: false, reason: 'Add enough English job details to verify the listing language.' };

  // Reject writing systems that franc may not identify, then require every
  // sufficiently long prose field and the combined listing to classify English.
  if (/[\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Hebrew}]/u.test(combined)) {
    return { ok: false, reason: 'Job details must be entirely in English.' };
  }
  const language = franc(combined, { minLength: 80 });
  if (language !== 'eng') return { ok: false, reason: 'Job details must be entirely in English.', detected: language };

  for (const field of fields) {
    if ((field.match(/[\p{L}]/gu)?.length ?? 0) < 80) continue;
    const fieldLanguage = franc(field, { minLength: 80 });
    if (fieldLanguage !== 'eng') {
      return { ok: false, reason: 'Job details must be entirely in English.', detected: fieldLanguage };
    }
  }
  return { ok: true };
}
