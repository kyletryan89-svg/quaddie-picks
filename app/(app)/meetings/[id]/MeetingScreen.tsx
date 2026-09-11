'use client';

// The core screen: track, date, status, and the four quaddie legs. Each leg is
// the real field from the Racing NSW form guide — a tappable list of runners
// with jockey, weight, barrier and form — plus the initials of every member who
// has taken each one, first/second-pick badges, and a per-leg comment thread.
// A locked meeting can be reopened for late scratchings. Nothing else.

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { lockMeeting, unlockMeeting } from '@/app/actions/meetings';
import { syncMeetingNow } from '@/app/actions/sync';
import { ChatBoard } from '@/components/ChatBoard';
import { Comments } from '@/components/Comments';
import { ErrorNote } from '@/components/ErrorNote';
import { LegComments } from '@/components/LegComments';
import { StatusBadge } from '@/components/StatusBadge';
import { ResultsTable } from '@/components/ResultsTable';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { parseField, type ParsedRunner } from '@/lib/field-parse';
import { formatDate, initialsOf, money } from '@/lib/format';
import { toScoringLegs, toScoringPicks } from '@/lib/meeting-score';
import { scoreMeeting, type UserResult } from '@/lib/scoring';
import type { Comment, Leg, Meeting, Pick, Runner } from '@/lib/types';

/** Pick ranks the screen lets a member assign, in badge order. */
const RANKS = [
  { n: 1, label: '1st pick', active: 'bg-amber-500 text-white' },
  { n: 2, label: '2nd pick', active: 'bg-slate-600 text-white' },
  { n: 3, label: '3rd pick', active: 'bg-sky-600 text-white' },
] as const;

interface Props {
  meeting: Meeting;
  legs: Leg[];
  initialRunners: Runner[];
  initialPicks: Pick[];
  initialComments: Comment[];
  initialNames: Record<string, string>;
  currentUserId: string;
  /** Latest sync error for this meeting, surfaced as a banner (null = none). */
  syncError?: string | null;
}

interface RealtimePickEvent {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Partial<Pick>;
  old: Partial<Pick>;
}

interface RealtimeStatusEvent {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Partial<Meeting>;
  old: Partial<Meeting>;
}

export function MeetingScreen({
  meeting,
  legs,
  initialRunners,
  initialPicks,
  initialComments,
  initialNames,
  currentUserId,
  syncError = null,
}: Props) {
  const [runners, setRunners] = useState<Runner[]>(initialRunners);
  const [picks, setPicks] = useState<Pick[]>(initialPicks);
  const [names, setNames] = useState<Record<string, string>>(initialNames);
  const [live, setLive] = useState(false);
  const [legErrors, setLegErrors] = useState<Record<number, string>>({});
  const [lockError, setLockError] = useState<string | undefined>(undefined);
  const [locking, setLocking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState(meeting.status);
  const [reopenedBy, setReopenedBy] = useState<string | null>(meeting.reopened_by ?? null);
  const [reopenedAt, setReopenedAt] = useState<string | null>(meeting.reopened_at ?? null);

  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Adopt a meeting the SERVER reports (after router.refresh() following a lock,
  // unlock or settle), using React's adjust-state-during-render pattern.
  const [lastServerMeeting, setLastServerMeeting] = useState(meeting);
  if (meeting !== lastServerMeeting) {
    setLastServerMeeting(meeting);
    setStatus(meeting.status);
    setReopenedBy(meeting.reopened_by ?? null);
    setReopenedAt(meeting.reopened_at ?? null);
  }

  const router = useRouter();
  const isOpen = status === 'open';

  const runnerIdsRef = useRef(new Set(initialRunners.map((r) => r.id)));
  useEffect(() => {
    runnerIdsRef.current = new Set(runners.map((r) => r.id));
  }, [runners]);

  const legIdsKey = legs.map((l) => l.id).join(',');

  // ── Realtime on picks (the whole point) ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof getSupabaseBrowserClient>['channel'] | undefined;
    const supabase = getSupabaseBrowserClient();
    const legIds = legIdsKey.split(',').filter((s) => s !== '');
    // Unique per mount — see ChatBoard for why a fixed name is not enough.
    const topic = `picks:${meeting.id}:${crypto.randomUUID()}`;

    async function refreshRunners(): Promise<void> {
      const { data } = await supabase.from('runners').select('*').in('leg_id', legIds).order('runner_number');
      if (!cancelled && data !== null) setRunners(data as Runner[]);
    }

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session !== null) supabase.realtime.setAuth(data.session.access_token);

      channel = supabase
        .channel(topic)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'picks', filter: `leg_id=in.(${legIds.join(',')})` },
          (payload: RealtimePickEvent) => {
            if (payload.eventType === 'INSERT') {
              const row = payload.new as Pick;
              if (!runnerIdsRef.current.has(row.runner_id)) void refreshRunners();
              setPicks((prev) => (prev.some((p) => p.id === row.id) ? prev : [...prev, row]));
            } else if (payload.eventType === 'DELETE') {
              const gone = payload.old as Pick;
              setPicks((prev) => prev.filter((p) => p.id !== gone.id));
            } else if (payload.eventType === 'UPDATE') {
              const row = payload.new as Pick;
              setPicks((prev) => prev.map((p) => (p.id === row.id ? row : p)));
            }
          },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'meetings', filter: `id=in.(${meeting.id})` },
          (payload: RealtimeStatusEvent) => {
            const next = payload.new as Partial<Meeting>;
            if (next.status !== undefined && next.status !== null && next.status !== statusRef.current) {
              setStatus(next.status);
              if (next.status === 'settled') void router.refresh();
            }
            if (next.reopened_by !== undefined) setReopenedBy(next.reopened_by);
            if (next.reopened_at !== undefined) setReopenedAt(next.reopened_at);
          },
        )
        .subscribe((subStatus: string) => {
          setLive(subStatus === 'SUBSCRIBED');
        });
    })();

    return () => {
      cancelled = true;
      if (channel !== undefined) void supabase.removeChannel(channel);
    };
  }, [meeting.id, legIdsKey, router]);

  // Top up display names for members who joined after this page rendered.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.from('profiles').select('id, display_name');
      if (!cancelled && data !== null) {
        setNames((prev) => {
          const next = { ...prev };
          for (const row of data as Array<{ id: string; display_name: string }>) {
            next[row.id] = row.display_name;
          }
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Derived ────────────────────────────────────────────────────────────────
  const runnersByLeg = useMemo(() => {
    const byLeg = new Map<string, Runner[]>();
    for (const leg of legs) byLeg.set(leg.id, []);
    for (const r of runners) byLeg.get(r.leg_id)?.push(r);
    for (const list of byLeg.values()) {
      list.sort((a, b) => Number(a.scratched) - Number(b.scratched) || a.runner_number - b.runner_number);
    }
    return byLeg;
  }, [runners, legs]);

  const picksByRunner = useMemo(() => {
    const byRunner = new Map<string, Pick[]>();
    for (const p of picks) {
      const list = byRunner.get(p.runner_id);
      if (list === undefined) byRunner.set(p.runner_id, [p]);
      else list.push(p);
    }
    return byRunner;
  }, [picks]);

  const myPicks = useMemo(() => picks.filter((p) => p.user_id === currentUserId), [picks, currentUserId]);
  const myTotal = myPicks.length;
  const myCountByLeg = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of myPicks) counts.set(p.leg_id, (counts.get(p.leg_id) ?? 0) + 1);
    return counts;
  }, [myPicks]);

  const results: UserResult[] = useMemo(() => {
    if (status !== 'settled') return [];
    return scoreMeeting(toScoringLegs(legs), toScoringPicks(legs, runners, picks));
  }, [status, legs, runners, picks]);

  // ── Actions ────────────────────────────────────────────────────────────────
  function setLegError(legNumber: number, message: string): void {
    setLegErrors((prev) => ({ ...prev, [legNumber]: message }));
  }

  /** Tap a runner: take it if you have not, drop it if you have. */
  async function toggleRunner(leg: Leg, runner: Runner): Promise<void> {
    setLegError(leg.leg_number, '');
    const supabase = getSupabaseBrowserClient();
    const mine = picks.find((p) => p.runner_id === runner.id && p.user_id === currentUserId);

    if (mine !== undefined) {
      const { error } = await supabase.from('picks').delete().eq('id', mine.id);
      if (error !== null) {
        setLegError(leg.leg_number, error.message);
        return;
      }
      setPicks((prev) => prev.filter((p) => p.id !== mine.id));
      return;
    }

    // A scratched runner can still lose an existing tip, but never gain one.
    if (runner.scratched) {
      setLegError(leg.leg_number, `${runner.runner_name ?? `Runner #${runner.runner_number}`} is scratched.`);
      return;
    }

    const { data, error } = await supabase
      .from('picks')
      .insert({ leg_id: leg.id, user_id: currentUserId, runner_id: runner.id })
      .select()
      .single();
    if (error !== null) {
      setLegError(leg.leg_number, error.message);
      return;
    }
    if (data !== null) {
      const row = data as Pick;
      setPicks((prev) => (prev.some((p) => p.id === row.id) ? prev : [...prev, row]));
    }
  }

  /** Replace a leg's field with a freshly pasted one. */
  async function saveField(leg: Leg, parsed: ParsedRunner[]): Promise<boolean> {
    setLegError(leg.leg_number, '');
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.rpc('replace_leg_field', {
      p_leg_id: leg.id,
      p_runners: parsed.map((r) => ({ number: r.number, name: r.name })),
    });
    if (error !== null) {
      setLegError(leg.leg_number, error.message);
      return false;
    }
    const fresh = (data ?? []) as Runner[];
    setRunners((prev) => [...prev.filter((r) => r.leg_id !== leg.id), ...fresh]);
    // Re-pasting can cascade away picks on runners that left the field.
    const keptIds = new Set(fresh.map((r) => r.id));
    setPicks((prev) => prev.filter((p) => p.leg_id !== leg.id || keptIds.has(p.runner_id)));
    return true;
  }

  /** Mark a pick 1st/2nd/3rd (or clear it). Handled atomically by set_pick_rank. */
  async function rankPick(leg: Leg, pick: Pick, rank: number): Promise<void> {
    setLegError(leg.leg_number, '');
    const target = pick.rank === rank ? null : rank;
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.rpc('set_pick_rank', { p_pick_id: pick.id, p_rank: target });
    if (error !== null) {
      setLegError(leg.leg_number, error.message);
      return;
    }
    // Optimistic local update; the realtime UPDATE reconciles the same shape.
    setPicks((prev) =>
      prev.map((p) => {
        if (p.id === pick.id) return { ...p, rank: target };
        if (target !== null && p.leg_id === leg.id && p.user_id === currentUserId && p.rank === target) {
          return { ...p, rank: null };
        }
        return p;
      }),
    );
  }

  async function lock(): Promise<void> {
    setLocking(true);
    setLockError(undefined);
    const res = await lockMeeting(meeting.id);
    setLocking(false);
    if (res.error !== undefined) {
      setLockError(res.error);
      return;
    }
    router.refresh();
  }

  async function unlock(): Promise<void> {
    setLocking(true);
    setLockError(undefined);
    const res = await unlockMeeting(meeting.id);
    setLocking(false);
    if (res.error !== undefined) {
      setLockError(res.error);
      return;
    }
    router.refresh();
  }

  /** Run the fields sync for this meeting on demand and report what it found. */
  async function syncNow(): Promise<void> {
    setSyncing(true);
    setSyncResult(undefined);
    const res = await syncMeetingNow(meeting.id);
    setSyncing(false);
    if (res.error !== undefined) {
      setSyncResult(`Sync failed — ${res.error}`);
      return;
    }
    setSyncResult(res.synced !== undefined ? `Synced ${res.synced} ${res.synced === 1 ? 'row' : 'rows'}` : 'Synced');
    router.refresh();
  }

  const reopenedLabel =
    reopenedAt !== null
      ? new Date(reopenedAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase()
      : '';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 lg:mx-auto lg:max-w-md">
      <ChatBoard currentUserId={currentUserId} names={names} />

      <div>
        <div className="flex items-center justify-between gap-2">
          <h1 className="truncate text-xl font-bold tracking-tight">{meeting.track}</h1>
          <StatusBadge status={status} />
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-sm text-slate-600">
          <span>{formatDate(meeting.meeting_date)}</span>
          <span aria-hidden>·</span>
          <span className={live ? 'text-emerald-600' : 'text-slate-400'} aria-live="polite">
            {live ? '● live' : '○ offline'}
          </span>
          {meeting.source_key !== null && (
            <button
              type="button"
              onClick={() => void syncNow()}
              disabled={syncing}
              className="ml-auto inline-flex items-center rounded-md border border-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 active:bg-slate-50 disabled:opacity-60"
            >
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          )}
        </div>
      </div>

      {syncError !== null && syncError !== undefined && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Last sync failed: {syncError}
        </div>
      )}
      {syncResult !== undefined && (
        <p className="text-xs text-slate-500" data-testid="sync-result">
          {syncResult}
        </p>
      )}

      <p className="-mb-2 text-xs leading-relaxed text-slate-400">
        Lock in your first pick, mark another as your 2nd or 3rd. Add a comment if you wish.
      </p>

      {/* Plain count of horses taken — no money, no cost framing. */}
      <div className="sticky top-12 z-[5] flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
        <span data-testid="picked-count">
          <strong>{myTotal}</strong> {myTotal === 1 ? 'horse' : 'horses'} picked
        </span>
        {isOpen && (
          <button
            type="button"
            onClick={() => void lock()}
            disabled={locking}
            className="tap rounded-md bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
          >
            {locking ? 'Locking…' : 'Lock picks'}
          </button>
        )}
        {status === 'locked' && (
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void unlock()}
              disabled={locking}
              className="tap rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
            >
              {locking ? 'Reopening…' : 'Edit picks'}
            </button>
            <Link
              href={`/meetings/${meeting.id}/settle`}
              className="tap inline-flex items-center rounded-md bg-sky-600 px-2.5 py-1 text-xs font-semibold text-white"
            >
              Enter results →
            </Link>
          </span>
        )}
      </div>

      {lockError !== undefined && <ErrorNote message={lockError} />}

      {isOpen && reopenedBy !== null && (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600" data-testid="reopened-note">
          Reopened by {names[reopenedBy] ?? 'Unknown'}, {reopenedLabel}
        </p>
      )}

      {!isOpen && (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
          {status === 'locked' ? 'Picks are locked. Waiting on results.' : 'Settled — final numbers below.'}
        </p>
      )}

      {[...legs]
        .sort((a, b) => a.leg_number - b.leg_number)
        .map((leg) => (
          <LegSection
            key={leg.id}
            leg={leg}
            runners={runnersByLeg.get(leg.id) ?? []}
            picksByRunner={picksByRunner}
            names={names}
            currentUserId={currentUserId}
            isOpen={isOpen}
            myCount={myCountByLeg.get(leg.id) ?? 0}
            error={legErrors[leg.leg_number]}
            onToggle={(runner) => void toggleRunner(leg, runner)}
            onRank={(pick, rank) => void rankPick(leg, pick, rank)}
            onSaveField={(parsed) => saveField(leg, parsed)}
          />
        ))}

      {status === 'settled' && <ResultsTable results={results} names={names} />}

      <Comments meetingId={meeting.id} currentUserId={currentUserId} initialComments={initialComments} names={names} />
    </div>
  );
}

function LegSection({
  leg,
  runners,
  picksByRunner,
  names,
  currentUserId,
  isOpen,
  myCount,
  error,
  onToggle,
  onRank,
  onSaveField,
}: {
  leg: Leg;
  runners: Runner[];
  picksByRunner: Map<string, Pick[]>;
  names: Record<string, string>;
  currentUserId: string;
  isOpen: boolean;
  myCount: number;
  error?: string;
  onToggle: (runner: Runner) => void;
  onRank: (pick: Pick, rank: number) => void;
  onSaveField: (parsed: ParsedRunner[]) => Promise<boolean>;
}) {
  const winnerShown = leg.winner_number !== null && leg.winner_sp !== null;
  const hasField = runners.length > 0;
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <div className="min-w-0">
          <h2 className="text-sm font-bold">
            Leg {leg.leg_number}
            {leg.race_number !== null && <span className="ml-1 font-normal text-slate-500">· R{leg.race_number}</span>}
          </h2>
          {leg.race_name !== null && (
            <p className="truncate text-xs text-slate-500">
              {leg.race_name}
              {leg.race_time !== null && <span className="text-slate-400"> · {leg.race_time}</span>}
            </p>
          )}
        </div>
        {leg.abandoned ? (
          <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-700">Abandoned</span>
        ) : winnerShown ? (
          <span className="shrink-0 text-xs font-medium text-emerald-700">
            🏆 #{leg.winner_number} {leg.winner_name ?? ''} @ ${money(Number(leg.winner_sp ?? 0))}
          </span>
        ) : (
          <span className="shrink-0 text-xs text-slate-500" data-testid={`leg-count-${leg.leg_number}`}>
            {myCount} picked
          </span>
        )}
      </header>

      {runners.length === 0 ? (
        <p className="px-3 py-3 text-sm text-slate-400">
          {isOpen ? 'No field yet — paste it below.' : 'No field for this leg.'}
        </p>
      ) : (
        <ul className="divide-y divide-slate-50">
          {runners.map((runner) => {
            const on = picksByRunner.get(runner.id) ?? [];
            const mine = on.some((p) => p.user_id === currentUserId);
            const isWinner = leg.winner_number === runner.runner_number;
            const label = `${runner.runner_number} ${runner.runner_name ?? ''}`.trim();
            const takers = on.map((p) => names[p.user_id] ?? '?');

            const formBits = [
              runner.jockey ?? '',
              runner.weight !== null ? `${runner.weight}kg` : '',
              runner.barrier !== null ? `B${runner.barrier}` : '',
              runner.form ?? '',
            ].filter((s) => s !== '');
            const formLine = formBits.join(' · ');

            const runnerBody = (
              <>
                <span
                  className={`w-7 shrink-0 rounded text-center text-xs font-bold leading-6 ${
                    mine ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {runner.runner_number}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`flex items-center gap-1.5 text-left text-sm ${mine ? 'font-semibold' : ''}`}>
                    <span className={`truncate ${runner.scratched ? 'text-slate-400 line-through' : ''}`}>
                      {runner.runner_name ?? `Runner #${runner.runner_number}`}
                    </span>
                    {runner.scratched && (
                      <span className="shrink-0 rounded bg-red-100 px-1 text-[10px] font-bold uppercase text-red-700">SCR</span>
                    )}
                    {isWinner && <span className="shrink-0">🏆</span>}
                  </span>
                  {formLine !== '' && <span className="block truncate text-left text-xs text-slate-400">{formLine}</span>}
                </span>
              </>
            );

            const chips = (
              <span className="flex shrink-0 items-center gap-1">
                {on.map((p) => {
                  const who = names[p.user_id] ?? '?';
                  const isMe = p.user_id === currentUserId;
                  return (
                    <span key={p.id} className="flex items-center gap-0.5">
                      <abbr
                        title={isMe ? `${who} (you)` : who}
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold no-underline ${
                          isMe ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {initialsOf(who)}
                      </abbr>
                      {isMe && isOpen ? (
                        <>
                          {RANKS.map((r) => (
                            <button
                              key={r.n}
                              type="button"
                              aria-pressed={p.rank === r.n}
                              aria-label={`Mark ${label} as your ${r.label}`}
                              onClick={() => onRank(p, r.n)}
                              className={`inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[10px] font-bold ${
                                p.rank === r.n ? r.active : 'bg-slate-100 text-slate-400'
                              }`}
                            >
                              {r.n}
                            </button>
                          ))}
                        </>
                      ) : (
                        RANKS.some((r) => r.n === p.rank) && (
                          <span
                            title={RANKS.find((r) => r.n === p.rank)?.label}
                            className={`inline-flex h-4 min-w-4 items-center justify-center rounded px-0.5 text-[9px] font-bold ${
                              RANKS.find((r) => r.n === p.rank)?.active
                            }`}
                          >
                            {p.rank}
                          </span>
                        )
                      )}
                    </span>
                  );
                })}
              </span>
            );

            // Scratched runners can't be picked, but a scratched runner someone
            // already holds must stay tappable so they can remove it.
            const tappable = isOpen && (!runner.scratched || mine);

            return (
              <li key={runner.id} className={mine ? 'bg-emerald-50/60' : ''}>
                <div className="flex items-center gap-2 px-3 py-2">
                  {tappable ? (
                    <button
                      type="button"
                      onClick={() => onToggle(runner)}
                      aria-pressed={mine}
                      aria-label={`${mine ? 'Remove' : 'Pick'} ${label}`}
                      className="tap flex min-w-0 flex-1 items-center gap-2 text-left active:bg-slate-50"
                    >
                      {runnerBody}
                    </button>
                  ) : (
                    <div
                      className="flex min-w-0 flex-1 items-center gap-2"
                      aria-label={takers.length > 0 ? `${label} — picked by ${takers.join(', ')}` : label}
                    >
                      {runnerBody}
                    </div>
                  )}
                  {chips}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {isOpen && <PasteField leg={leg} hasField={hasField} onSave={onSaveField} />}

      {error !== undefined && error !== '' && (
        <p role="alert" className="border-t border-slate-100 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}

      <LegComments legId={leg.id} currentUserId={currentUserId} names={names} />
    </section>
  );
}

/**
 * The per-leg "Paste field" box. Shown on every leg while the meeting is open:
 * expanded when a leg has no field yet, collapsed to a one-tap "Paste field"
 * button once it does. Re-pasting replaces that leg's field (the RPC keeps
 * runners that survive, so picks on them carry over).
 */
function PasteField({
  leg,
  hasField,
  onSave,
}: {
  leg: Leg;
  hasField: boolean;
  onSave: (parsed: ParsedRunner[]) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(!hasField);
  const [saving, setSaving] = useState(false);

  const parsed = useMemo(() => parseField(text), [text]);
  const touched = text.trim() !== '';

  async function save(): Promise<void> {
    setSaving(true);
    const ok = await onSave(parsed.runners);
    setSaving(false);
    if (ok) {
      setText('');
      // Collapse once the leg has a field — the box is only in the way after
      // that, and re-pasting stays one tap away.
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <div className="border-t border-slate-100 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Paste field for leg ${leg.leg_number}`}
          className="tap text-xs font-medium text-slate-500 underline"
        >
          Paste field
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-slate-100 px-3 py-2">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">
          Paste field {hasField && <span className="font-normal text-slate-400">— replaces leg {leg.leg_number}</span>}
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          aria-label={`Paste the field for leg ${leg.leg_number}`}
          placeholder={'1. Alpha Male (4) J. McDonald\n2 Beta Blocker (7)\n3. Gamma Ray (11)'}
          className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-900"
        />
      </label>

      {touched && (
        <div data-testid={`paste-preview-${leg.leg_number}`} className="rounded-lg bg-slate-50 px-2 py-1.5 text-xs">
          <p className="font-medium text-slate-700">
            {parsed.runners.length} runner{parsed.runners.length === 1 ? '' : 's'} parsed
            {parsed.skipped.length > 0 && (
              <span className="font-normal text-amber-700">
                {' '}
                · {parsed.skipped.length} line{parsed.skipped.length === 1 ? '' : 's'} skipped
              </span>
            )}
          </p>
          {parsed.runners.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-slate-600">
              {parsed.runners.map((r) => (
                <li key={r.number}>
                  <span className="font-semibold">{r.number}</span> {r.name}
                </li>
              ))}
            </ul>
          )}
          {parsed.skipped.length > 0 && (
            <ul className="mt-1 text-slate-400">
              {parsed.skipped.map((line, i) => (
                <li key={`${line}-${i}`} className="truncate">
                  skipped: {line}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || parsed.runners.length === 0}
          aria-label={`Save field for leg ${leg.leg_number}`}
          className="tap rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          {saving ? 'Saving…' : `Save field${parsed.runners.length > 0 ? ` (${parsed.runners.length})` : ''}`}
        </button>
        {hasField && (
          <button
            type="button"
            onClick={() => {
              setText('');
              setOpen(false);
            }}
            className="tap text-xs text-slate-500 underline"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
