import { describe, expect, it } from 'vitest';
import {
  checkTransition,
  isExpired,
  isPubliclyVisible,
  targetStatusFor,
} from '../../src/lib/domain/lifecycle';

describe('checkTransition', () => {
  it('allows the documented transitions', () => {
    expect(checkTransition('draft', 'submit_for_review')).toEqual({ ok: true, next: 'pending_review' });
    expect(checkTransition('pending_review', 'publish')).toEqual({ ok: true, next: 'published' });
    expect(checkTransition('published', 'close')).toEqual({ ok: true, next: 'closed' });
    expect(checkTransition('closed', 'reopen')).toEqual({ ok: true, next: 'published' });
    expect(checkTransition('archived', 'restore')).toEqual({ ok: true, next: 'draft' });
  });

  it('rejects transitions that skip the lifecycle', () => {
    expect(checkTransition('draft', 'close').ok).toBe(false);
    expect(checkTransition('rejected', 'publish').ok).toBe(false);
    expect(checkTransition('published', 'publish').ok).toBe(false);
    expect(checkTransition('archived', 'publish').ok).toBe(false);
  });

  it('maps every action to its target status', () => {
    expect(targetStatusFor('submit_for_review')).toBe('pending_review');
    expect(targetStatusFor('approve')).toBe('pending_review');
    expect(targetStatusFor('publish')).toBe('published');
    expect(targetStatusFor('close')).toBe('closed');
    expect(targetStatusFor('expire')).toBe('expired');
    expect(targetStatusFor('reject')).toBe('rejected');
    expect(targetStatusFor('archive')).toBe('archived');
    expect(targetStatusFor('restore')).toBe('draft');
  });
});

describe('isPubliclyVisible', () => {
  const base = {
    status: 'published' as const,
    published_at: '2026-01-01T00:00:00.000Z',
    deadline: null,
    closed_at: null,
  };

  it('only exposes live published records', () => {
    expect(isPubliclyVisible(base)).toBe(true);
    expect(isPubliclyVisible({ ...base, status: 'pending_review' })).toBe(false);
    expect(isPubliclyVisible({ ...base, published_at: null })).toBe(false);
    expect(isPubliclyVisible({ ...base, closed_at: '2026-01-02T00:00:00.000Z' })).toBe(false);
  });

  it('hides a listing once its deadline has passed', () => {
    expect(isPubliclyVisible({ ...base, deadline: '2020-01-01' })).toBe(false);
  });

  it('hides a listing once its original 90-day expiry date arrives', () => {
    expect(isPubliclyVisible({ ...base, expires_at: '2020-01-01' })).toBe(false);
    expect(isPubliclyVisible({ ...base, expires_at: '2999-01-01' })).toBe(true);
  });

  it('hides a listing published in the future', () => {
    expect(isPubliclyVisible({ ...base, published_at: '2999-01-01T00:00:00.000Z' })).toBe(false);
  });
});

describe('isExpired', () => {
  it('compares the deadline at end of day', () => {
    expect(isExpired('2020-01-01')).toBe(true);
    expect(isExpired(null)).toBe(false);
    expect(isExpired('2999-01-01')).toBe(false);
  });
});
