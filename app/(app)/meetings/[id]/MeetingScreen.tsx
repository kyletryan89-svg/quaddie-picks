'use client';

// The core screen: track, date, status, and the four quaddie legs. Each leg is
// the real field from the Racing NSW form guide — a tappable list of runners
// with jockey, weight, barrier and form — plus the initials of every member who
// has taken each one. A comment box sits at the bottom. Nothing else.

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { lockMeeting } from '@/app/actions/meetings';
import { Comments } from '@/components/Comments';
import { ErrorNote } from '@/components/ErrorNote';
import { StatusBadge } from '@/components/StatusBadge';
import { ResultsTable } from '@/components/ResultsTable';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatDate, initialsOf, money } from '@/lib/format';
import { toScoringLegs, toScoringPicks } from '@/lib/meeting-score';
import { scoreMeeting, type UserResult } from '@/lib/scoring';
import type { Comment, Leg, Meeting, Pick, Runner } from '@/lib/types';

interface Props {
  meeting: Meeting;
  legs: Leg[];
  initialRunners: Runner[];
  initialPicks: Pick[];
  initialComments: Comment[];
  initialNames: Record<string, string>;
  currentUserId: string;
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
}: Props) {
  const [runners, setRunners] = useState<Runner[]>(initialRunners);
  const [picks, setPicks] = useState<Pick[]>(initialPicks);
  const [names, setNames] = useState<Record<string, string>>(initialNames);
  const [live, setLive] = useState(false);
  const [legErrors, setLegErrors] = useState<Record<number, string>>({});
  const [lockError, setLockError] = useState<string | undefined>(undefined);
  const [locking, setLocking] = useState(false);
  const [status, setStatus] = useState(meeting.status);

  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Adopt a status the SERVER reports (after router.refresh() following a lock
  // or settle), using React's adjust-state-during-render pattern.
  const [lastServerStatus, setLastServerStatus] = useState(meeting.status);
  if (meeting.status !== lastServerStatus) {
    setLastServerStatus(meeting.status);
    setStatus(meeting.status);
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

    async function refreshRunners(): Promise<void> {
      const { data } = await supabase.from('runners').select('*').in('leg_id', legIds).order('runner_number');
      if (!cancelled && data !== null) setRunners(data as Runner[]);
    }

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session !== null) supabase.realtime.setAuth(data.session.access_token);

      channel = supabase
        .channel(`picks:${meeting.id}`)
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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
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
        </div>
      </div>

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
          <Link
            href={`/meetings/${meeting.id}/settle`}
            className="tap inline-flex items-center rounded-md bg-sky-600 px-2.5 py-1 text-xs font-semibold text-white"
          >
            Enter results →
          </Link>
        )}
      </div>

      {lockError !== undefined && <ErrorNote message={lockError} />}

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
}) {
  const winnerShown = leg.winner_number !== null && leg.winner_sp !== null;

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
        {winnerShown ? (
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
          {isOpen ? 'Field not published yet — check back closer to race day.' : 'No field for this leg.'}
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

            const body = (
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
                <span className="flex shrink-0 items-center gap-1">
                  {on.map((p) => {
                    const who = names[p.user_id] ?? '?';
                    const isMe = p.user_id === currentUserId;
                    return (
                      <abbr
                        key={p.id}
                        title={isMe ? `${who} (you)` : who}
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold no-underline ${
                          isMe ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {initialsOf(who)}
                      </abbr>
                    );
                  })}
                </span>
              </>
            );

            // Scratched runners can't be picked, but a scratched runner someone
            // already holds must stay tappable so they can remove it.
            const tappable = isOpen && (!runner.scratched || mine);

            return (
              <li key={runner.id}>
                {tappable ? (
                  <button
                    type="button"
                    onClick={() => onToggle(runner)}
                    aria-pressed={mine}
                    aria-label={`${mine ? 'Remove' : 'Pick'} ${label}`}
                    className={`tap flex w-full items-center gap-2 px-3 py-2 text-left active:bg-slate-50 ${
                      mine ? 'bg-emerald-50/60' : ''
                    }`}
                  >
                    {body}
                  </button>
                ) : (
                  <div
                    className={`flex items-center gap-2 px-3 py-2 ${mine ? 'bg-emerald-50/60' : ''}`}
                    aria-label={takers.length > 0 ? `${label} — picked by ${takers.join(', ')}` : label}
                  >
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error !== undefined && error !== '' && (
        <p role="alert" className="border-t border-slate-100 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
