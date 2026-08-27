'use client';

// The core screen (SPEC §6, rebuilt in M8): track, date, status, and the four
// quaddie legs. Nothing else while picking.
//
// A leg is its real field — the runners someone pasted in — as a tappable list.
// Each row is runner number, runner name, and the initials of every member who
// has taken it. You select by tapping; there is no free-text runner entry
// anywhere, and no money on this screen: the header is a plain count of horses,
// not an outlay.

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { lockMeeting } from '@/app/actions/meetings';
import { ErrorNote } from '@/components/ErrorNote';
import { StatusBadge } from '@/components/StatusBadge';
import { ResultsTable } from '@/components/ResultsTable';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { parseField, type ParsedRunner } from '@/lib/field-parse';
import { formatDate, initialsOf, money } from '@/lib/format';
import { toScoringLegs, toScoringPicks } from '@/lib/meeting-score';
import { scoreMeeting, type UserResult } from '@/lib/scoring';
import type { Leg, Meeting, Pick, Runner } from '@/lib/types';

interface Props {
  meeting: Meeting;
  legs: Leg[];
  initialRunners: Runner[];
  initialPicks: Pick[];
  initialNames: Record<string, string>;
  currentUserId: string;
}

// Shape of the postgres_changes payload we actually consume. Kept local because
// supabase-js does not re-export RealtimePostgresChangesPayload at top level.
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

export function MeetingScreen({ meeting, legs, initialRunners, initialPicks, initialNames, currentUserId }: Props) {
  const [runners, setRunners] = useState<Runner[]>(initialRunners);
  const [picks, setPicks] = useState<Pick[]>(initialPicks);
  const [names, setNames] = useState<Record<string, string>>(initialNames);
  const [live, setLive] = useState(false);
  const [legErrors, setLegErrors] = useState<Record<number, string>>({});
  const [lockError, setLockError] = useState<string | undefined>(undefined);
  const [locking, setLocking] = useState(false);
  const [status, setStatus] = useState(meeting.status);

  // The realtime handler closes over this component once; mirror status into a
  // ref so it compares against the CURRENT value, not the subscribe-time one.
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Adopt a status the SERVER reports (after router.refresh() following a lock
  // or settle), using React's adjust-state-during-render pattern — the effect
  // form trips react-hooks/set-state-in-effect.
  const [lastServerStatus, setLastServerStatus] = useState(meeting.status);
  if (meeting.status !== lastServerStatus) {
    setLastServerStatus(meeting.status);
    setStatus(meeting.status);
  }

  const router = useRouter();
  const isOpen = status === 'open';

  // Known runner ids, for spotting a pick that arrives for a field this screen
  // has not seen yet (someone else pasted it after we loaded).
  const runnerIdsRef = useRef(new Set(initialRunners.map((r) => r.id)));
  useEffect(() => {
    runnerIdsRef.current = new Set(runners.map((r) => r.id));
  }, [runners]);

  const legIdsKey = legs.map((l) => l.id).join(',');

  // ── Realtime on picks (the whole point — SPEC §6) ──────────────────────────
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
      // Restore the session FIRST and hand its JWT to the realtime socket.
      // Subscribing before the token lands means the channel joins with anon
      // claims and RLS silently suppresses every postgres_changes event.
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
              // A pick for a runner we have never seen means the field changed
              // under us; pull it before rendering the pick.
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
          // Another member locked or settled — flip this screen without a reload.
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
    for (const list of byLeg.values()) list.sort((a, b) => a.runner_number - b.runner_number);
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
            onSaveField={(parsed) => saveField(leg, parsed)}
          />
        ))}

      {status === 'settled' && <ResultsTable results={results} names={names} />}
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
  onSaveField: (parsed: ParsedRunner[]) => Promise<boolean>;
}) {
  const winnerShown = leg.winner_number !== null && leg.winner_sp !== null;
  const hasField = runners.length > 0;

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <h2 className="text-sm font-bold">
          Leg {leg.leg_number}
          {leg.race_number !== null && <span className="ml-1 font-normal text-slate-500">· R{leg.race_number}</span>}
        </h2>
        {winnerShown ? (
          <span className="text-xs font-medium text-emerald-700">
            🏆 #{leg.winner_number} {leg.winner_name ?? ''} @ ${money(Number(leg.winner_sp ?? 0))}
          </span>
        ) : (
          <span className="text-xs text-slate-500" data-testid={`leg-count-${leg.leg_number}`}>
            {myCount} picked
          </span>
        )}
      </header>

      {hasField ? (
        <ul className="divide-y divide-slate-50">
          {runners.map((runner) => {
            const on = picksByRunner.get(runner.id) ?? [];
            const mine = on.some((p) => p.user_id === currentUserId);
            const isWinner = leg.winner_number === runner.runner_number;
            const label = `${runner.runner_number} ${runner.runner_name ?? ''}`.trim();
            const takers = on.map((p) => names[p.user_id] ?? '?');

            const body = (
              <>
                <span
                  className={`w-7 shrink-0 rounded text-center text-xs font-bold leading-6 ${
                    mine ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {runner.runner_number}
                </span>
                <span className={`min-w-0 flex-1 truncate text-left text-sm ${mine ? 'font-semibold' : ''}`}>
                  {runner.runner_name ?? `Runner #${runner.runner_number}`}
                  {isWinner && <span className="ml-1">🏆</span>}
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

            return (
              <li key={runner.id}>
                {isOpen ? (
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
      ) : (
        !isOpen && <p className="px-3 py-3 text-sm text-slate-400">No field was pasted for this leg.</p>
      )}

      {/* A leg with no field shows the paste box and nothing else. */}
      {isOpen && <PasteField leg={leg} hasField={hasField} onSave={onSaveField} />}

      {error !== undefined && error !== '' && (
        <p role="alert" className="border-t border-slate-100 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}

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
      // that, and re-pasting is one tap away.
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <div className="border-t border-slate-100 px-3 py-2">
        <button type="button" onClick={() => setOpen(true)} className="tap text-xs font-medium text-slate-500 underline">
          Re-paste field
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
          placeholder={'1. Alpha Male\n2 Beta Blocker\n3. Gamma Ray (11)'}
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
