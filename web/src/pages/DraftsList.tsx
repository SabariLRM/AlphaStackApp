import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MdDeleteOutline, MdDrafts, MdRefresh } from 'react-icons/md';
import { useCompose } from '../components/Compose';
import { Spinner, useUi } from '../components/ui';
import { api } from '../lib/api';
import { listDate } from '../lib/format';

export function DraftsList() {
  const qc = useQueryClient();
  const ui = useUi();
  const compose = useCompose();
  const drafts = useQuery({ queryKey: ['drafts'], queryFn: api.drafts });
  const items = drafts.data?.items ?? [];

  const remove = async (id: string) => {
    await api.deleteDraft(id);
    void qc.invalidateQueries({ queryKey: ['drafts'] });
    void qc.invalidateQueries({ queryKey: ['counts'] });
    ui.toast('Draft discarded.');
  };

  return (
    <>
      <div className="toolbar">
        <button className="icon-btn" aria-label="Refresh" onClick={() => void drafts.refetch()}>
          <MdRefresh />
        </button>
        <span className="spacer" />
        {items.length > 0 && <span className="range">{items.length} draft{items.length === 1 ? '' : 's'}</span>}
      </div>
      <div className="list" role="list" aria-label="Drafts">
        {drafts.isLoading && <Spinner />}
        {drafts.isSuccess && items.length === 0 && (
          <div className="empty">
            <MdDrafts />
            <p>You don't have any saved drafts. Saving a draft allows you to keep a message you aren't ready to send yet.</p>
          </div>
        )}
        {items.map((d) => {
          const to = d.conversationId ? d.to : d.to.concat(d.cc);
          return (
            <div
              key={d.id}
              role="listitem"
              className="row unread"
              tabIndex={0}
              onClick={() => compose.open({ mode: 'new', draft: d })}
              onKeyDown={(e) => e.key === 'Enter' && compose.open({ mode: 'new', draft: d })}
            >
              <span />
              <span />
              <span className="who">
                <span style={{ color: 'var(--danger)', fontWeight: 500 }}>Draft</span> {to.length ? `· ${to.join(', ')}` : ''}
              </span>
              <span className="what">
                {d.subject || '(no subject)'}
                {d.body.trim() && <span className="snippet"> - {d.body.trim().slice(0, 140)}</span>}
                {d.conversationId && <span className="tag" style={{ marginLeft: 8 }}>Chat draft</span>}
              </span>
              <span className="when">
                <span className="date">{listDate(d.updatedAt)}</span>
                <span className="hover-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="icon-btn sm" title="Discard draft" aria-label="Discard draft" onClick={() => void remove(d.id)}>
                    <MdDeleteOutline />
                  </button>
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
