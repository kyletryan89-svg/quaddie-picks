'use client';

// The group chat board on the meetings list page. Side column on desktop,
// collapsible panel on mobile. Members post (newest last), it updates live, and
// a toggle lets a member post anonymously — anonymous messages read "Anonymous"
// to everyone including the poster, and their user_id never reaches the client
// (reads go through chat_messages_view, which omits it).

import { useEffect, useRef, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { initialsOf } from '@/lib/format';
import type { ChatMessage } from '@/lib/types';

interface Props {
  currentUserId: string;
  names: Record<string, string>;
}

const MAX_LENGTH = 500;

export function ChatBoard({ currentUserId, names }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [body, setBody] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [live, setLive] = useState(false);
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof getSupabaseBrowserClient>['channel'] | undefined;
    const supabase = getSupabaseBrowserClient();
    // Unique per mount: the client reuses a channel by topic, and a removed
    // channel is not synchronously gone from it, so a fixed name would hand the
    // next mount an already-subscribed channel ("cannot add callbacks after
    // subscribe()"). A fresh topic guarantees a fresh channel each mount.
    const topic = `chat:${crypto.randomUUID()}`;

    // Read through the view so anonymous rows arrive with user_id already null.
    async function refresh(): Promise<void> {
      const { data } = await supabase.from('chat_messages_view').select('*').order('created_at', { ascending: true });
      if (!cancelled && data !== null) setMessages(data as ChatMessage[]);
    }

    void (async () => {
      await refresh();
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session !== null) supabase.realtime.setAuth(data.session.access_token);

      channel = supabase
        .channel(topic)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, () => {
          void refresh();
        })
        .subscribe((status: string) => {
          if (!cancelled) setLive(status === 'SUBSCRIBED');
        });
    })();

    return () => {
      cancelled = true;
      if (channel !== undefined) void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  async function post(): Promise<void> {
    const text = body.trim();
    if (text === '' || posting) return;
    setPosting(true);
    setError(undefined);
    const supabase = getSupabaseBrowserClient();
    const { error: err } = await supabase
      .from('chat_messages')
      .insert({ user_id: currentUserId, body: text, is_anonymous: anonymous });
    setPosting(false);
    if (err !== null) {
      setError(err.message);
      return;
    }
    setBody('');
    setAnonymous(false);
  }

  async function remove(id: string): Promise<void> {
    const supabase = getSupabaseBrowserClient();
    const { error: err } = await supabase.from('chat_messages').delete().eq('id', id);
    if (err !== null) setError(err.message);
  }

  return (
    <aside className="rounded-xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-16">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2"
      >
        <span className="text-sm font-bold">Chat</span>
        <span className={`text-xs ${live ? 'text-emerald-600' : 'text-slate-400'}`} aria-live="polite">
          {live ? '● live' : '○ offline'}
        </span>
      </button>

      <div className={`${open ? 'block' : 'hidden'} lg:block`}>
        {messages.length === 0 ? (
          <p className="px-3 py-4 text-center text-sm text-slate-400">No messages yet.</p>
        ) : (
          <ul ref={listRef} className="max-h-72 divide-y divide-slate-50 overflow-y-auto">
            {messages.map((m) => {
              const anon = m.is_anonymous;
              const who = anon ? 'Anonymous' : m.user_id === currentUserId ? 'You' : (names[m.user_id ?? ''] ?? '?');
              const mine = !anon && m.user_id === currentUserId;
              return (
                <li key={m.id} className="group flex items-start gap-2 px-3 py-2">
                  <span
                    aria-hidden
                    className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                      anon ? 'bg-slate-300 text-slate-500' : mine ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {anon ? '?' : initialsOf(who)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className={`text-xs font-semibold ${anon ? 'italic text-slate-400' : 'text-slate-700'}`}>{who}</span>
                      <span className="text-[10px] text-slate-400">
                        {new Date(m.created_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
                      </span>
                      {mine && (
                        <button
                          type="button"
                          onClick={() => void remove(m.id)}
                          className="hidden text-[10px] text-slate-400 underline group-hover:inline"
                        >
                          delete
                        </button>
                      )}
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{m.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="border-t border-slate-100 px-3 py-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void post();
              }
            }}
            placeholder="Say something to the crew…"
            maxLength={MAX_LENGTH}
            aria-label="Chat message"
            rows={2}
            className="w-full resize-none rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-900"
          />
          <p className="mt-1 text-[11px] text-slate-400">Leave a comment for all — leaving a name is optional.</p>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={anonymous}
                onChange={(e) => setAnonymous(e.target.checked)}
                className="h-4 w-4 accent-slate-900"
              />
              Anonymous
            </label>
            <button
              type="button"
              onClick={() => void post()}
              disabled={posting || body.trim() === ''}
              className="rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              {posting ? '…' : 'Post'}
            </button>
          </div>
        </div>

        {error !== undefined && (
          <p role="alert" className="border-t border-slate-100 px-3 py-2 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    </aside>
  );
}
