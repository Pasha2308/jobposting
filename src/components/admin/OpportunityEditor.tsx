import { useState } from 'react';
import type { Category, Company, OpportunityWithRelations } from '../../lib/domain/types';
import {
  APPLICATION_METHODS,
  DATE_PRECISIONS,
  EMPLOYMENT_TYPES,
  SALARY_PERIODS,
  SOURCE_TYPES,
  VERIFICATION_STATUSES,
  WORK_MODES,
} from '../../lib/domain/types';
import {
  APPLICATION_METHOD_LABELS,
  DATE_PRECISION_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  SALARY_PERIOD_LABELS,
  VERIFICATION_LABELS,
  WORK_MODE_LABELS,
  formatDateTime,
} from '../../lib/domain/format';

const SOURCE_LABELS: Record<(typeof SOURCE_TYPES)[number], string> = {
  linkedin_post: 'LinkedIn post',
  company_website: 'Company website',
  recruiter_announcement: 'Recruiter announcement',
  public_submission: 'Public submission',
  other: 'Other',
};

type Props = {
  opportunity: OpportunityWithRelations | null;
  categories: Category[];
  companies: Company[];
  mode: 'create' | 'edit';
};

type Feedback = { kind: 'success' | 'error' | 'warning'; message: string; details?: string[] } | null;

export default function OpportunityEditor({ opportunity, categories, companies, mode }: Props) {
  const o = opportunity;
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: { preventDefault: () => void; currentTarget: HTMLFormElement }) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    const text = (key: string): string => String(data.get(key) ?? '').trim();
    const nullable = (key: string): string | null => text(key) || null;
    const numberOrNull = (key: string): number | null => {
      const value = text(key);
      if (!value) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const lines = (key: string): string[] =>
      text(key)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const tags = (key: string): string[] =>
      text(key)
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean);

    const payload = {
      title: text('title'),
      company_id: nullable('company_id'),
      category_id: nullable('category_id'),
      summary: nullable('summary'),
      responsibilities: lines('responsibilities'),
      requirements: lines('requirements'),
      skills: tags('skills'),
      preferred_skills: tags('preferred_skills'),
      location_text: nullable('location_text'),
      city: nullable('city'),
      country: nullable('country'),
      country_code: nullable('country_code'),
      work_mode: text('work_mode'),
      employment_type: text('employment_type'),
      salary_min: numberOrNull('salary_min'),
      salary_max: numberOrNull('salary_max'),
      currency: nullable('currency'),
      salary_period: text('salary_period') || 'unspecified',
      experience_min_years: numberOrNull('experience_min_years'),
      experience_max_years: numberOrNull('experience_max_years'),
      application_method: text('application_method'),
      application_url: nullable('application_url'),
      recruitment_email: nullable('recruitment_email'),
      careers_url: nullable('careers_url'),
      application_instructions: nullable('application_instructions'),
      source_url: nullable('source_url'),
      source_type: nullable('source_type'),
      deadline: nullable('deadline'),
      original_posted_at: nullable('original_posted_at'),
      original_date_precision: text('original_date_precision') || 'unknown',
      original_date_text: nullable('original_date_text'),
      verification_status: text('verification_status') || 'not_verified',
      is_featured: data.get('is_featured') === 'on',
      admin_notes: nullable('admin_notes'),
      company_name: nullable('company_name'),
    };

    setBusy(true);
    setFeedback(null);
    try {
      const endpoint = mode === 'create' ? '/api/admin/opportunities/create' : `/api/admin/opportunities/${o?.id}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            opportunity?: { id: string };
            warnings?: string[];
            error?: string;
            blocking?: string[];
            issues?: { field: string; message: string }[];
          }
        | null;

      if (!response.ok || !result) {
        const details = result?.issues?.map((issue) => `${issue.field}: ${issue.message}`) ?? result?.blocking ?? [];
        setFeedback({ kind: 'error', message: result?.error ?? 'The opportunity could not be saved.', details });
        setBusy(false);
        return;
      }

      if (mode === 'create' && result.opportunity?.id) {
        window.location.href = `/admin/opportunities/${result.opportunity.id}?created=1`;
        return;
      }

      setFeedback({
        kind: result.warnings?.length ? 'warning' : 'success',
        message: result.warnings?.length
          ? 'Saved. Review the warnings before publishing.'
          : 'Changes saved.',
        details: result.warnings,
      });
      setBusy(false);
    } catch {
      setFeedback({ kind: 'error', message: 'Network error. Nothing was saved.' });
      setBusy(false);
    }
  }

  async function transition(action: string) {
    if (!o) return;
    if (['close', 'reject', 'archive'].includes(action)) {
      if (!window.confirm(`Apply “${action}” to this opportunity? The action is logged.`)) return;
    }
    if (action === 'publish' && !window.confirm('Publish this listing? Publication revalidates every field and the application route.')) {
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/opportunities/${o.id}/transition`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const result = (await response.json().catch(() => null)) as
        | { ok?: boolean; status?: string; warnings?: string[]; error?: string; blocking?: string[] }
        | null;
      if (!response.ok || !result) {
        setFeedback({
          kind: 'error',
          message: result?.error ?? 'The status action failed.',
          details: result?.blocking ?? [],
        });
        setBusy(false);
        return;
      }
      if (action === 'publish' && result.status === 'published') {
        setFeedback({ kind: 'success', message: 'Published. The public page is live.' });
        window.setTimeout(() => window.location.reload(), 600);
        return;
      }
      setFeedback({
        kind: 'success',
        message: `Status updated to ${String(result.status ?? '').replace(/_/g, ' ')}.`,
        details: result.warnings,
      });
      window.setTimeout(() => window.location.reload(), 500);
    } catch {
      setFeedback({ kind: 'error', message: 'Network error. The status was not changed.' });
      setBusy(false);
    }
  }

  async function deleteOpportunity() {
    if (!o) return;
    const confirmation = window.prompt('This permanently deletes the opportunity and its comments. Type DELETE to confirm.');
    if (confirmation !== 'DELETE') return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/opportunities/${o.id}/delete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        setFeedback({ kind: 'error', message: result?.error ?? 'Deletion failed.' });
        setBusy(false);
        return;
      }
      window.location.href = '/admin/opportunities';
    } catch {
      setFeedback({ kind: 'error', message: 'Network error. Nothing was deleted.' });
      setBusy(false);
    }
  }

  const status = o?.status ?? 'draft';
  const actionButtons: { action: string; label: string; variant: string; show: boolean }[] = [
    { action: 'submit_for_review', label: 'Send to review', variant: 'btn--outline', show: status === 'draft' },
    { action: 'approve', label: 'Approve', variant: 'btn--outline', show: status === 'pending_review' },
    { action: 'publish', label: 'Publish', variant: 'btn--primary', show: ['draft', 'pending_review', 'closed', 'expired'].includes(status) },
    { action: 'close', label: 'Close', variant: 'btn--outline', show: status === 'published' },
    { action: 'reopen', label: 'Reopen', variant: 'btn--outline', show: ['closed', 'expired'].includes(status) },
    { action: 'reject', label: 'Reject', variant: 'btn--danger', show: ['draft', 'pending_review'].includes(status) },
    { action: 'archive', label: 'Archive', variant: 'btn--ghost', show: !['archived', 'published'].includes(status) },
    { action: 'restore', label: 'Restore to draft', variant: 'btn--ghost', show: ['archived', 'rejected', 'closed', 'expired'].includes(status) },
  ];

  return (
    <form onSubmit={submit} className="stack" style={{ gap: '1rem' }} noValidate>
      {feedback && (
        <div
          className={`alert ${feedback.kind === 'success' ? 'alert--success' : feedback.kind === 'warning' ? 'alert--warning' : 'alert--error'}`}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          <strong>{feedback.message}</strong>
          {feedback.details && feedback.details.length > 0 && (
            <ul style={{ margin: '0.5rem 0 0 1rem', padding: 0 }}>
              {feedback.details.map((detail) => (
                <li key={detail} style={{ marginBottom: '0.2rem' }}>{detail}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="admin-columns" style={{ alignItems: 'start' }}>
        <div className="stack" style={{ gap: '1rem' }}>
          <section className="panel">
            <div className="panel__head"><span className="panel__title">Role basics</span></div>
            <div className="panel__body form-grid">
              <div className="field col-span-2">
                <label htmlFor="title">Role title</label>
                <input className="input" id="title" name="title" type="text" required minLength={3} maxLength={160} defaultValue={o?.title ?? ''} placeholder="e.g. Founder's Office Associate" />
              </div>
              <div className="field">
                <label htmlFor="company_id">Existing company</label>
                <select className="select" id="company_id" name="company_id" defaultValue={o?.company_id ?? ''}>
                  <option value="">— Select company —</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>{company.name}</option>
                  ))}
                </select>
                <p className="field__hint">Choose an existing company, or type a name below.</p>
              </div>
              <div className="field">
                <label htmlFor="company_name">New company name</label>
                <input className="input" id="company_name" name="company_name" type="text" maxLength={160} defaultValue={o?.company?.name ?? ''} placeholder="Only used when no company is selected" />
              </div>
              <div className="field col-span-2">
                <label htmlFor="category_id">Category</label>
                <select className="select" id="category_id" name="category_id" defaultValue={o?.category_id ?? ''} required>
                  <option value="">— Select category —</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </div>
              <div className="field col-span-2">
                <label htmlFor="summary">Factual summary</label>
                <textarea className="textarea" id="summary" name="summary" rows={5} maxLength={1500} defaultValue={o?.summary ?? ''} placeholder="Summarise only what the source states. Minimum 30 characters to publish." />
                <p className="field__hint">Do not add benefits, salary or requirements the source did not state.</p>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel__head"><span className="panel__title">Role detail</span></div>
            <div className="panel__body form-grid">
              <div className="field">
                <label htmlFor="responsibilities">Responsibilities (one per line)</label>
                <textarea className="textarea" id="responsibilities" name="responsibilities" rows={5} defaultValue={o?.responsibilities.join('\n') ?? ''} />
              </div>
              <div className="field">
                <label htmlFor="requirements">Requirements (one per line)</label>
                <textarea className="textarea" id="requirements" name="requirements" rows={5} defaultValue={o?.requirements.join('\n') ?? ''} />
              </div>
              <div className="field">
                <label htmlFor="skills">Stated skills (comma separated)</label>
                <input className="input" id="skills" name="skills" type="text" defaultValue={o?.skills.join(', ') ?? ''} />
              </div>
              <div className="field">
                <label htmlFor="preferred_skills">Nice to have (comma separated)</label>
                <input className="input" id="preferred_skills" name="preferred_skills" type="text" defaultValue={o?.preferred_skills.join(', ') ?? ''} />
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel__head"><span className="panel__title">Location & work mode</span></div>
            <div className="panel__body form-grid">
              <div className="field col-span-2">
                <label htmlFor="location_text">Location as stated</label>
                <input className="input" id="location_text" name="location_text" type="text" maxLength={160} defaultValue={o?.location_text ?? ''} placeholder="e.g. Bengaluru, India · Hybrid" />
              </div>
              <div className="field">
                <label htmlFor="city">City</label>
                <input className="input" id="city" name="city" type="text" maxLength={100} defaultValue={o?.city ?? ''} />
              </div>
              <div className="field">
                <label htmlFor="country">Country</label>
                <input className="input" id="country" name="country" type="text" maxLength={100} defaultValue={o?.country ?? ''} />
              </div>
              <div className="field">
                <label htmlFor="country_code">Country code</label>
                <input className="input" id="country_code" name="country_code" type="text" maxLength={2} defaultValue={o?.country_code ?? ''} placeholder="IN" />
              </div>
              <div className="field">
                <label htmlFor="work_mode">Work mode</label>
                <select className="select" id="work_mode" name="work_mode" defaultValue={o?.work_mode ?? 'unspecified'}>
                  {WORK_MODES.map((value) => <option key={value} value={value}>{WORK_MODE_LABELS[value]}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="employment_type">Employment type</label>
                <select className="select" id="employment_type" name="employment_type" defaultValue={o?.employment_type ?? 'unspecified'}>
                  {EMPLOYMENT_TYPES.map((value) => <option key={value} value={value}>{EMPLOYMENT_TYPE_LABELS[value]}</option>)}
                </select>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel__head"><span className="panel__title">Compensation & experience</span></div>
            <div className="panel__body form-grid">
              <div className="field">
                <label htmlFor="salary_min">Salary minimum</label>
                <input className="input" id="salary_min" name="salary_min" type="number" min={0} step="any" defaultValue={o?.salary_min ?? ''} />
              </div>
              <div className="field">
                <label htmlFor="salary_max">Salary maximum</label>
                <input className="input" id="salary_max" name="salary_max" type="number" min={0} step="any" defaultValue={o?.salary_max ?? ''} />
              </div>
              <div className="field">
                <label htmlFor="currency">Currency</label>
                <input className="input" id="currency" name="currency" type="text" maxLength={3} defaultValue={o?.currency ?? ''} placeholder="INR" />
              </div>
              <div className="field">
                <label htmlFor="salary_period">Pay period</label>
                <select className="select" id="salary_period" name="salary_period" defaultValue={o?.salary_period ?? 'unspecified'}>
                  {SALARY_PERIODS.map((value) => <option key={value} value={value}>{SALARY_PERIOD_LABELS[value] || 'Not specified'}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="experience_min_years">Experience min (years)</label>
                <input className="input" id="experience_min_years" name="experience_min_years" type="number" min={0} max={60} step="1" defaultValue={o?.experience_min_years ?? ''} />
              </div>
              <div className="field">
                <label htmlFor="experience_max_years">Experience max (years)</label>
                <input className="input" id="experience_max_years" name="experience_max_years" type="number" min={0} max={60} step="1" defaultValue={o?.experience_max_years ?? ''} />
              </div>
            </div>
          </section>
        </div>

        <div className="stack" style={{ gap: '1rem' }}>
          <section className="panel">
            <div className="panel__head">
              <span className="panel__title">Status</span>
              <span className={`badge badge--${status}`}>{status.replace(/_/g, ' ')}</span>
            </div>
            <div className="panel__body">
              <p className="tiny muted" style={{ lineHeight: 1.6 }}>
                Publication revalidates the title, company, category, summary, location and at least one usable
                application route. Database triggers enforce the same lifecycle.
              </p>
              <div className="stack-sm" style={{ marginTop: '0.85rem' }}>
                {actionButtons.filter((button) => button.show).map((button) => (
                  <button
                    key={button.action}
                    type="button"
                    className={`btn ${button.variant} btn--block btn--sm`}
                    disabled={busy}
                    onClick={() => transition(button.action)}
                  >
                    {button.label}
                  </button>
                ))}
              </div>
              {o?.published_at && (
                <p className="tiny muted" style={{ marginTop: '0.75rem' }}>
                  Published {formatDateTime(o.published_at)}
                  {o.slug && (
                    <>
                      {' · '}
                      <a href={`/opportunities/${o.slug}`} target="_blank" rel="noopener" style={{ textDecoration: 'underline' }}>
                        View public page
                      </a>
                    </>
                  )}
                </p>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel__head"><span className="panel__title">Application route</span></div>
            <div className="panel__body form-grid">
              <div className="field col-span-2">
                <label htmlFor="application_method">Primary method</label>
                <select className="select" id="application_method" name="application_method" defaultValue={o?.application_method ?? 'external_url'}>
                  {APPLICATION_METHODS.map((value) => <option key={value} value={value}>{APPLICATION_METHOD_LABELS[value]}</option>)}
                </select>
              </div>
              <div className="field col-span-2">
                <label htmlFor="application_url">Application URL</label>
                <input className="input" id="application_url" name="application_url" type="url" maxLength={1000} defaultValue={o?.application_url ?? ''} placeholder="https://…" />
              </div>
              <div className="field col-span-2">
                <label htmlFor="recruitment_email">Recruitment email</label>
                <input className="input" id="recruitment_email" name="recruitment_email" type="email" maxLength={254} defaultValue={o?.recruitment_email ?? ''} placeholder="careers@company.com" />
                <p className="field__hint">Never invent an address. Leave blank if the source does not state one.</p>
              </div>
              <div className="field col-span-2">
                <label htmlFor="careers_url">Company careers page</label>
                <input className="input" id="careers_url" name="careers_url" type="url" maxLength={1000} defaultValue={o?.careers_url ?? ''} />
              </div>
              <div className="field col-span-2">
                <label htmlFor="application_instructions">Application instructions</label>
                <textarea className="textarea" id="application_instructions" name="application_instructions" rows={3} maxLength={1500} defaultValue={o?.application_instructions ?? ''} placeholder="Exactly what the original post says about applying." />
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel__head"><span className="panel__title">Source & dates</span></div>
            <div className="panel__body form-grid">
              <div className="field col-span-2">
                <label htmlFor="source_url">Source URL</label>
                <input className="input" id="source_url" name="source_url" type="url" maxLength={1000} defaultValue={o?.source_url ?? ''} />
              </div>
              <div className="field">
                <label htmlFor="source_type">Source type</label>
                <select className="select" id="source_type" name="source_type" defaultValue={o?.source_type ?? ''}>
                  <option value="">Not specified</option>
                  {SOURCE_TYPES.map((value) => <option key={value} value={value}>{SOURCE_LABELS[value]}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="verification_status">Verification</label>
                <select className="select" id="verification_status" name="verification_status" defaultValue={o?.verification_status ?? 'not_verified'}>
                  {VERIFICATION_STATUSES.map((value) => <option key={value} value={value}>{VERIFICATION_LABELS[value]}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="original_posted_at">Original post date</label>
                <input className="input" id="original_posted_at" name="original_posted_at" type="date" defaultValue={o?.original_posted_at ?? ''} />
              </div>
              <div className="field">
                <label htmlFor="original_date_precision">Date precision</label>
                <select className="select" id="original_date_precision" name="original_date_precision" defaultValue={o?.original_date_precision ?? 'unknown'}>
                  {DATE_PRECISIONS.map((value) => <option key={value} value={value}>{DATE_PRECISION_LABELS[value]}</option>)}
                </select>
              </div>
              <div className="field col-span-2">
                <label htmlFor="original_date_text">Original date text</label>
                <input className="input" id="original_date_text" name="original_date_text" type="text" maxLength={200} defaultValue={o?.original_date_text ?? ''} placeholder="e.g. “Posted last week”" />
              </div>
              <div className="field col-span-2">
                <label htmlFor="deadline">Application deadline</label>
                <input className="input" id="deadline" name="deadline" type="date" defaultValue={o?.deadline ?? ''} />
              </div>
              <div className="field col-span-2">
                <label htmlFor="admin_notes">Internal notes</label>
                <textarea className="textarea" id="admin_notes" name="admin_notes" rows={3} maxLength={4000} defaultValue={o?.admin_notes ?? ''} placeholder="Never shown publicly." />
              </div>
              <label className="cluster tiny" style={{ gap: '0.5rem', color: 'var(--text-dim)' }}>
                <input type="checkbox" name="is_featured" defaultChecked={o?.is_featured ?? false} /> Feature this listing
              </label>
            </div>
          </section>

          {o && (
            <section className="panel">
              <div className="panel__head"><span className="panel__title">System timestamps</span></div>
              <div className="panel__body">
                <div className="meta-list">
                  <div className="meta-list__row"><span className="meta-list__key">Discovered</span><span className="meta-list__val">{formatDateTime(o.discovered_at)}</span></div>
                  <div className="meta-list__row"><span className="meta-list__key">Published</span><span className="meta-list__val">{o.published_at ? formatDateTime(o.published_at) : 'Not published'}</span></div>
                  <div className="meta-list__row"><span className="meta-list__key">Last verified</span><span className="meta-list__val">{o.last_verified_at ? formatDateTime(o.last_verified_at) : 'Never'}</span></div>
                  <div className="meta-list__row"><span className="meta-list__key">Closed</span><span className="meta-list__val">{o.closed_at ? formatDateTime(o.closed_at) : '—'}</span></div>
                  <div className="meta-list__row"><span className="meta-list__key">Last updated</span><span className="meta-list__val">{formatDateTime(o.updated_at)}</span></div>
                </div>
                <p className="tiny muted" style={{ marginTop: '0.6rem' }}>
                  These timestamps are system-generated. They are never read from the AI extraction or the edit form.
                </p>
              </div>
            </section>
          )}

          {mode === 'edit' && o && (
            <section className="panel" style={{ borderColor: 'rgba(255,123,107,0.25)' }}>
              <div className="panel__head"><span className="panel__title">Danger zone</span></div>
              <div className="panel__body">
                <p className="tiny muted" style={{ lineHeight: 1.6 }}>
                  Prefer closing or archiving a listing. Permanent deletion removes the opportunity and its generated
                  comments and cannot be undone.
                </p>
                <button className="btn btn--danger btn--sm btn--block" type="button" disabled={busy} onClick={deleteOpportunity} style={{ marginTop: '0.75rem' }}>
                  Delete permanently
                </button>
              </div>
            </section>
          )}
        </div>
      </div>

      <div className="panel" style={{ position: 'sticky', bottom: '0.75rem', zIndex: 20 }}>
        <div className="panel__body cluster" style={{ justifyContent: 'space-between' }}>
          <p className="tiny muted" style={{ maxWidth: '46ch', lineHeight: 1.6 }}>
            Saving never publishes. Use the status actions to submit for review, publish or close.
          </p>
          <div className="cluster">
            <a className="btn btn--ghost btn--sm" href="/admin/opportunities">Cancel</a>
            <button className="btn btn--primary btn--sm" type="submit" disabled={busy}>
              {busy ? 'Saving…' : mode === 'create' ? 'Create draft' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
