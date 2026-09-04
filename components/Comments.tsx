'use client';

// The meeting side panel: the group's chatter, live like the picks. Nothing but
// a list of messages and a box to post one.

import { useEffect, useRef, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { initialsOf } from '@/lib/format';
import type { Comment } from '@/lib/types';

interface Props {
  meetingId: string;
  currentUserId: string;
  initialComments: Comment[];
  names: Record<string, string>;
}

interface RealtimeCommentEvent {
  eventType: 'INSERT' | 'DELETE';
  new: Partial<Comment>;
  old: Partial<Comment>;
}

export function Comments({ meetingId, currentUserId, initialComments, names }: Props) {
  const [comments, setComments] = useState<Comment[]>(initialComments.slice(-5));
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [live, setLive] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof getSupabaseBrowserClient>['channel'] | undefined;
    const supabase = getSupabaseBrowserClient();
    // Unique per mount — see ChatBoard for why a fixed name is not enough.
    const topic = `comments:${meetingId}:${crypto.randomUUID()}`;

    void (async () => {
      // Restore the session and hand its JWT to the realtime socket before
      // subscribing — otherwise the channel joins with anon claims and RLS
      // silently drops every postgres_changes event.
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session !== null) supabase.realtime.setAuth(data.session.access_token);

      channel = supabase
        .channel(topic)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'comments', filter: `meeting_id=eq.${meetingId}` },
          (payload: RealtimeCommentEvent) => {
            if (payload.eventType === 'INSERT') {
              const row = payload.new as Comment;
              setComments((prev) => {
                const next = prev.some((c) => c.id === row.id) ? prev : [...prev, row];
                return next.slice(-5);
              });
            } else if (payload.eventType === 'DELETE') {
              const gone = payload.old as Comment;
              setComments((prev) => prev.filter((c) => c.id !== gone.id));
            }
          },
        )
        .subscribe((status: string) => {
          if (!cancelled) setLive(status === 'SUBSCRIBED');
        });
    })();

    return () => {
      cancelled = true;
      if (channel !== undefined) void supabase.removeChannel(channel);
    };
  }, [meetingId]);

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
      .from('comments')
      .insert({ meeting_id: meetingId, user_id: currentUserId, body: text });
    setPosting(false);
    if (err !== null) {
      setError(err.message);
      return;
    }
    setBody('');
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <h2 className="text-sm font-bold">Comments</h2>
        <span className={`text-xs ${live ? 'text-emerald-600' : 'text-slate-400'}`} aria-live="polite">
          {live ? '● live' : '○ offline'}
        </span>
      </header>

      {comments.length === 0 ? (
        <p className="px-3 py-4 text-center text-sm text-slate-400">No chat yet.</p>
      ) : (
        <ul ref={listRef} className="max-h-64 divide-y divide-slate-50 overflow-y-auto">
          {comments.map((c) => {
            const who = names[c.user_id] ?? '?';
            const mine = c.user_id === currentUserId;
            return (
              <li key={c.id} className="px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold text-slate-700">{mine ? 'You' : who}</span>
                  <span className="text-[10px] text-slate-400">
                    {new Date(c.created_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{c.body}</p>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-2">
        <span
          aria-hidden
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white"
        >
          {initialsOf(names[currentUserId] ?? '?')}
        </span>
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void post();
          }}
          placeholder="Say something…"
          maxLength={500}
          aria-label="Comment"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-900"
        />
        <button
          type="button"
          onClick={() => void post()}
          disabled={posting || body.trim() === ''}
          className="tap rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          {posting ? '…' : 'Post'}
        </button>
      </div>

      {error !== undefined && (
        <p role="alert" className="border-t border-slate-100 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
