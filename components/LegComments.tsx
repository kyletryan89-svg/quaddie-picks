'use client';

// Per-leg comment thread: one small box beside each leg. Members post, see
// author + time (newest last), and new comments arrive live. Plain text, 280
// chars, delete own only.

import { useEffect, useRef, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { initialsOf } from '@/lib/format';
import type { LegComment } from '@/lib/types';

interface Props {
  legId: string;
  currentUserId: string;
  names: Record<string, string>;
}

interface RealtimeCommentEvent {
  eventType: 'INSERT' | 'DELETE';
  new: Partial<LegComment>;
  old: Partial<LegComment>;
}

const MAX_LENGTH = 280;

export function LegComments({ legId, currentUserId, names }: Props) {
  const [comments, setComments] = useState<LegComment[]>([]);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabaseBrowserClient();

    void (async () => {
      const { data } = await supabase
        .from('leg_comments')
        .select('*')
        .eq('leg_id', legId)
        .order('created_at', { ascending: true });
      if (cancelled) return;
      setComments((data ?? []) as LegComment[]);
      setLoaded(true);

      const { data: session } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session.session !== null) supabase.realtime.setAuth(session.session.access_token);

      const channel = supabase
        .channel(`leg-comments:${legId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'leg_comments', filter: `leg_id=eq.${legId}` },
          (payload: RealtimeCommentEvent) => {
            if (payload.eventType === 'INSERT') {
              const row = payload.new as LegComment;
              setComments((prev) => (prev.some((c) => c.id === row.id) ? prev : [...prev, row]));
            } else if (payload.eventType === 'DELETE') {
              const gone = payload.old as LegComment;
              setComments((prev) => prev.filter((c) => c.id !== gone.id));
            }
          },
        )
        .subscribe();

      if (cancelled) void supabase.removeChannel(channel);
    })();

    return () => {
      cancelled = true;
    };
  }, [legId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [comments.length]);

  async function post(): Promise<void> {
    const text = body.trim();
    if (text === '' || posting) return;
    setPosting(true);
    setError(undefined);
    const supabase = getSupabaseBrowserClient();
    const { error: err } = await supabase
      .from('leg_comments')
      .insert({ leg_id: legId, user_id: currentUserId, body: text });
    setPosting(false);
    if (err !== null) {
      setError(err.message);
      return;
    }
    setBody('');
  }

  async function remove(id: string): Promise<void> {
    const supabase = getSupabaseBrowserClient();
    const { error: err } = await supabase.from('leg_comments').delete().eq('id', id);
    if (err !== null) setError(err.message);
  }

  return (
    <div className="border-t border-slate-100 bg-slate-50/50">
      {comments.length === 0 ? (
        <p className="px-3 py-2 text-xs text-slate-400">{loaded ? 'No comments on this leg.' : '…'}</p>
      ) : (
        <ul ref={listRef} className="max-h-40 divide-y divide-slate-100 overflow-y-auto">
          {comments.map((c) => {
            const who = names[c.user_id] ?? '?';
            const mine = c.user_id === currentUserId;
            return (
              <li key={c.id} className="group flex items-start gap-2 px-3 py-1.5">
                <span
                  aria-hidden
                  className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[9px] font-bold text-slate-600"
                >
                  {initialsOf(who)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[11px] font-semibold text-slate-700">{mine ? 'You' : who}</span>
                    <span className="text-[10px] text-slate-400">
                      {new Date(c.created_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
                    </span>
                    {mine && (
                      <button
                        type="button"
                        onClick={() => void remove(c.id)}
                        className="hidden text-[10px] text-slate-400 underline group-hover:inline"
                      >
                        delete
                      </button>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-xs text-slate-700">{c.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center gap-2 px-3 py-2">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void post();
          }}
          placeholder="Comment on this leg…"
          maxLength={MAX_LENGTH}
          aria-label={`Comment on leg`}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-slate-900"
        />
        <button
          type="button"
          onClick={() => void post()}
          disabled={posting || body.trim() === ''}
          className="rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          {posting ? '…' : 'Add'}
        </button>
      </div>

      {error !== undefined && (
        <p role="alert" className="border-t border-slate-100 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
