import { useState } from 'react';
import type { GeneratedComment } from '../../lib/domain/types';

const STYLE_LABELS: Record<GeneratedComment['style'], string> = {
  professional: 'Professional',
  community: 'Community-focused',
  conversational: 'Short & conversational',
};

function relative(value: string): string {
  const days = Math.floor((Date.now() - Date.parse(value)) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return 'just now';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return `${Math.floor(days / 30)} months ago`;
}

type Props = {
  opportunityId: string;
  initialComments: GeneratedComment[];
  listingUrl: string | null;
  published: boolean;
};

type Notice = { kind: 'success' | 'error'; message: string } | null;

export default function CommentStudio({ opportunityId, initialComments, listingUrl, published }: Props) {
  const [comments, setComments] = useState<GeneratedComment[]>(initialComments);
  const [drafts, setDrafts] = useState<Record<string, string>>(
    Object.fromEntries(initialComments.map((comment) => [comment.id, comment.body])),
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function patchComment(id: string, patch: Record<string, unknown>): Promise<GeneratedComment | null> {
    setBusyId(id);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/comments/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const result = (await response.json().catch(() => null)) as
        | { ok?: boolean; comment?: GeneratedComment; error?: string }
        | null;
      if (!response.ok || !result?.comment) {
        setNotice({ kind: 'error', message: result?.error ?? 'The comment could not be updated.' });
        return null;
      }
      setComments((current) => current.map((comment) => (comment.id === id ? result.comment! : comment)));
      return result.comment;
    } catch {
      setNotice({ kind: 'error', message: 'Network error. The comment was not changed.' });
      return null;
    } finally {
      setBusyId(null);
    }
  }

  async function saveBody(comment: GeneratedComment) {
    const body = (drafts[comment.id] ?? '').trim();
    if (!body) {
      setNotice({ kind: 'error', message: 'A comment cannot be empty.' });
      return;
    }
    const updated = await patchComment(comment.id, { body });
    if (updated) setNotice({ kind: 'success', message: 'Comment saved.' });
  }

  async function select(comment: GeneratedComment) {
    for (const other of comments) {
      if (other.id !== comment.id && other.is_selected) await patchComment(other.id, { is_selected: false });
    }
    const updated = await patchComment(comment.id, { is_selected: true });
    if (updated) setNotice({ kind: 'success', message: `${STYLE_LABELS[comment.style]} comment selected.` });
  }

  async function togglePosted(comment: GeneratedComment) {
    const updated = await patchComment(comment.id, { manually_posted: !comment.manually_posted });
    if (updated) {
      setNotice({
        kind: 'success',
        message: updated.manually_posted
          ? 'Marked as manually posted. Nothing is posted automatically.'
          : 'Marked as not posted.',
      });
    }
  }

  async function copy(comment: GeneratedComment) {
    const text = drafts[comment.id] ?? comment.body;
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ kind: 'success', message: 'Comment copied. Paste it into LinkedIn yourself — no automation runs.' });
    } catch {
      setNotice({ kind: 'error', message: 'Clipboard unavailable. Select the text and copy it manually.' });
    }
  }

  async function regenerate() {
    if (!window.confirm('Regenerate all three comment variants from the saved fields? Manual edits to these variants will be replaced.')) {
      return;
    }
    setRegenerating(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/opportunities/${opportunityId}/comments`, { method: 'POST' });
      const result = (await response.json().catch(() => null)) as
        | { ok?: boolean; comments?: GeneratedComment[]; listingUrl?: string | null; error?: string }
        | null;
      if (!response.ok || !result?.comments) {
        setNotice({ kind: 'error', message: result?.error ?? 'Comments could not be regenerated.' });
        return;
      }
      setComments(result.comments);
      setDrafts(Object.fromEntries(result.comments.map((comment) => [comment.id, comment.body])));
      setNotice({
        kind: 'success',
        message: result.listingUrl
          ? 'Comments regenerated with the public listing URL.'
          : 'Comments regenerated without a URL until the listing is published.',
      });
    } catch {
      setNotice({ kind: 'error', message: 'Network error. Comments were not regenerated.' });
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <section className="panel" id="comments">
      <div className="panel__head">
        <span className="panel__title">Community comments</span>
        <div className="cluster">
          <span className="badge badge--draft">Manual posting only</span>
          <button className="btn btn--outline btn--sm" type="button" onClick={regenerate} disabled={regenerating}>
            {regenerating ? 'Regenerating…' : 'Regenerate all'}
          </button>
        </div>
      </div>
      <div className="panel__body">
        {notice && (
          <div className={`alert ${notice.kind === 'success' ? 'alert--success' : 'alert--error'}`} role="status" style={{ marginBottom: '0.85rem' }}>
            {notice.message}
          </div>
        )}

        <p className="tiny muted" style={{ lineHeight: 1.6, marginBottom: '0.85rem' }}>
          {published && listingUrl
            ? 'The listing is live, so comments may include its public URL.'
            : 'The listing is not published yet. Comments never include a URL before publication.'}{' '}
          We never post to LinkedIn or automate engagement — copy a variant and post it yourself.
        </p>

        {comments.length === 0 ? (
          <div className="table-empty">No comments generated yet. Use “Regenerate all” to create the three variants.</div>
        ) : (
          <div className="stack-sm">
            {comments.map((comment) => (
              <article key={comment.id} className={`comment-card${comment.is_selected ? ' is-selected' : ''}`}>
                <div className="comment-card__head">
                  <span className="comment-card__style">{STYLE_LABELS[comment.style]}</span>
                  <span className="cluster" style={{ gap: '0.35rem' }}>
                    {comment.is_selected && <span className="badge badge--published">Selected</span>}
                    {comment.manually_posted && <span className="badge badge--approved">Posted manually</span>}
                    <span className="badge">{comment.generated_by}</span>
                    <span className="badge">v{comment.version}</span>
                  </span>
                </div>

                <textarea
                  className="textarea"
                  rows={4}
                  value={drafts[comment.id] ?? comment.body}
                  onChange={(event) => setDrafts((current) => ({ ...current, [comment.id]: event.target.value }))}
                  aria-label={`${STYLE_LABELS[comment.style]} comment`}
                  maxLength={2000}
                />

                <div className="comment-card__foot">
                  <button className="btn btn--primary btn--sm" type="button" disabled={busyId === comment.id} onClick={() => saveBody(comment)}>
                    Save edit
                  </button>
                  <button className="btn btn--outline btn--sm" type="button" disabled={busyId === comment.id} onClick={() => copy(comment)}>
                    Copy
                  </button>
                  <button className="btn btn--ghost btn--sm" type="button" disabled={busyId === comment.id || comment.is_selected} onClick={() => select(comment)}>
                    Use this variant
                  </button>
                  <button className="btn btn--ghost btn--sm" type="button" disabled={busyId === comment.id} onClick={() => togglePosted(comment)}>
                    {comment.manually_posted ? 'Mark not posted' : 'Mark posted manually'}
                  </button>
                  <span className="tiny muted" style={{ marginLeft: 'auto' }}>
                    Updated {relative(comment.updated_at)}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
