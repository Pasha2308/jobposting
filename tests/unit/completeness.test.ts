import { describe, expect, it } from 'vitest';
import { computeCompleteness } from '../../src/lib/domain/completeness';

const FULL = {
  title: 'Founder Associate',
  company_name: 'Acme Labs',
  summary: 'Work directly with founders on operations and growth.',
  responsibilities: ['Own ops'],
  requirements: ['1+ years experience'],
  skills: ['Excel', 'SQL'],
  location_text: 'Bengaluru, India',
  work_mode: 'onsite',
  employment_type: 'full_time',
  salary_min: 1200000,
  salary_max: 1800000,
  experience_min_years: 1,
  experience_max_years: 3,
  application_method: 'external_url',
  application_url: 'https://acme.test/apply/fa',
  deadline: '2026-03-01',
  education_requirements: ["Bachelor's degree"],
};

describe('computeCompleteness', () => {
  it('scores a fully specified opening at 1 with no flags', () => {
    const result = computeCompleteness(FULL);
    expect(result.score).toBe(1);
    expect(result.flags).toEqual([]);
  });

  it('reports missing fields as flags and lowers the score', () => {
    const result = computeCompleteness({ title: 'Founder Associate' });
    expect(result.score).toBeCloseTo(0.12, 3);
    expect(result.flags).toEqual(
      expect.arrayContaining([
        'missing_company',
        'no_description',
        'missing_location',
        'missing_salary',
        'missing_experience',
        'missing_application_route',
      ]),
    );
  });

  it('treats unspecified work mode/employment type as incomplete', () => {
    const result = computeCompleteness({ ...FULL, work_mode: 'unspecified', employment_type: 'unspecified' });
    expect(result.flags).toContain('unspecified_work_mode');
    expect(result.score).toBeCloseTo(0.92, 3);
  });

  it('flags low AI confidence without changing the field score', () => {
    const result = computeCompleteness({ ...FULL, confidence: 0.4 });
    expect(result.flags).toContain('low_confidence');
    expect(result.score).toBe(1);
  });

  it('accepts an explicit application route decision', () => {
    const withoutRoute = { ...FULL, application_url: null, application_method: 'none' };
    const result = computeCompleteness(withoutRoute, { hasApplicationRoute: true });
    expect(result.flags).not.toContain('missing_application_route');
  });

  it('never exceeds 1 or drops below 0', () => {
    const result = computeCompleteness({ ...FULL, salary_min: 1 });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});
