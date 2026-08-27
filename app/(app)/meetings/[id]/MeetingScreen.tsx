'use client';

// The core screen (SPEC §6): four legs, everyone's runners with picker initials,
// live via Supabase Realtime, plus a running selections/outlay counter so the
// cost of boxing wide is visible WHILE picking.

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { lockMeeting } from '@/app/actions/meetings';
import { ErrorNote } from '@/components/ErrorNote';
import { StatusBadge } from '@/components/StatusBadge';
import { ResultsTable } from '@/components/ResultsTable';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatDate, initialsOf, money } from '@/lib/format';
import { scoreMeeting, type ScoringLeg, type UserResult } from '@/lib/scoring';
import type { Leg, Meeting, Pick } from '@/lib/types';

interface Props {
  meeting: Meeting;
  legs: Leg[];
  initialPicks: Pick[];
  initialNames: Record<string, string>;
  currentUserId: string;
}

// Shape of the postgres_changes payload we actually consume. Kept local because
// supabase-js does not re-export RealtimePostgresChangesPayload at top level.
interface RealtimePickEvent {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  schema: string;
  table: string;
  commit_timestamp: string;
  new: Partial<Pick>;
  old: Partial<Pick>;
  errors: string[];
}

interface RealtimeStatusEvent {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Partial<Meeting>;
  old: Partial<Meeting>;
}

export function MeetingScreen({ meeting, legs, initialPicks, initialNames, currentUserId }: Props) {
  const [picks, setPicks] = useState<Pick[]>(initialPicks);
  const [names, setNames] = useState<Record<string, string>>(initialNames);
  const [live, setLive] = useState(false);
  const [legErrors, setLegErrors] = useState<Record<number, string>>({});
  const [lockError, setLockError] = useState<string | undefined>(undefined);
  const [locking, setLocking] = useState(false);
  // Status is state so a lock/settle made by ANOTHER member lands here live.
  const [status, setStatus] = useState(meeting.status);
  // The realtime handler closes over this component once; mirror status into a
  // ref so it compares against the CURRENT value, not the subscribe-time one.
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  // Adopt a status the SERVER reports (after router.refresh() following a lock
  // or settle). Without this the acting member's own screen would depend on the
  // realtime round-trip to notice a change they made themselves. This is React's
  // adjust-state-during-render pattern, not an effect — the effect form trips
  // react-hooks/set-state-in-effect and re-renders twice.
  const [lastServerStatus, setLastServerStatus] = useState(meeting.status);
  if (meeting.status !== lastServerStatus) {
    setLastServerStatus(meeting.status);
    setStatus(meeting.status);
  }
  const router = useRouter();

  const isOpen = status === 'open';

  // ── Realtime on picks (the whole point — SPEC §6) ──────────────────────────
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof getSupabaseBrowserClient>['channel'] | undefined;
    const supabase = getSupabaseBrowserClient();

    void (async () => {
      // Restore the session FIRST and hand its JWT to the realtime socket.
      // Subscribing before the token lands means the channel joins with anon
      // claims and RLS silently suppresses every postgres_changes event.
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session !== null) supabase.realtime.setAuth(data.session.access_token);

      const legIds = legs.map((l) => l.id).join(',');
      channel = supabase
        .channel(`picks:${meeting.id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'picks', filter: `leg_id=in.(${legIds})` },
          (payload: RealtimePickEvent) => {
            if (payload.eventType === 'INSERT') {
              const row = payload.new as Pick;
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
          // Another member locked or settled the meeting — flip this screen
          // without a reload; settling also pulls winners + results from the
          // server via router.refresh().
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
  }, [meeting.id, legs, router]);

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
  const picksByLeg = useMemo(() => {
    const byLeg = new Map<number, Pick[]>();
    for (const leg of legs) byLeg.set(leg.leg_number, []);
    for (const p of picks) {
      const leg = legs.find((l) => l.id === p.leg_id);
      if (leg === undefined) continue;
      const list = byLeg.get(leg.leg_number);
      if (list !== undefined) list.push(p);
    }
    return byLeg;
  }, [picks, legs]);

  const mySelections = picks.filter((p) => p.user_id === currentUserId).length;

  const results: UserResult[] = useMemo(() => {
    if (status !== 'settled') return [];
    const scoringLegs: ScoringLeg[] = legs.map((l) => ({
      legNumber: l.leg_number,
      winnerNumber: l.winner_number,
      winnerSp: l.winner_sp === null ? null : Number(l.winner_sp),
    }));
    const legIdToNumber = new Map<string, number>(legs.map((l) => [l.id, l.leg_number]));
    return scoreMeeting(
      scoringLegs,
      picks.map((p) => ({
        userId: p.user_id,
        legNumber: legIdToNumber.get(p.leg_id) ?? 0,
        runnerNumber: p.runner_number,
      })),
    );
  }, [status, legs, picks]);

  // ── Actions ────────────────────────────────────────────────────────────────
  async function addPick(leg: Leg, runnerNumber: number, runnerName: string): Promise<void> {
    setLegErrors((prev) => ({ ...prev, [leg.leg_number]: '' }));
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from('picks')
      .insert({
        leg_id: leg.id,
        user_id: currentUserId,
        runner_number: runnerNumber,
        runner_name: runnerName.length > 0 ? runnerName : null,
      })
      .select()
      .single();
    if (error !== null) {
      const friendly =
        error.code === '23505'
          ? `You already have #${runnerNumber} in leg ${leg.leg_number}.`
          : error.message;
      setLegErrors((prev) => ({ ...prev, [leg.leg_number]: friendly }));
      return;
    }
    if (data !== null) {
      const row = data as Pick;
      setPicks((prev) => (prev.some((p) => p.id === row.id) ? prev : [...prev, row]));
    }
  }

  async function removePick(pickId: string, legNumber: number): Promise<void> {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from('picks').delete().eq('id', pickId);
    if (error !== null) {
      setLegErrors((prev) => ({ ...prev, [legNumber]: error.message }));
      return;
    }
    setPicks((prev) => prev.filter((p) => p.id !== pickId));
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

      {/* Live outlay counter — visible while picking, not only after settling */}
      <div className="sticky top-12 z-[5] flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
        <span>
          Your tips: <strong>{mySelections}</strong>
        </span>
        <span>
          Outlay so far: <strong>${money(mySelections * 1)}</strong>
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
          {status === 'locked'
            ? 'Picks are locked. Waiting on results.'
            : 'Settled — final numbers below.'}
        </p>
      )}

      {[...legs]
        .sort((a, b) => a.leg_number - b.leg_number)
        .map((leg) => (
          <LegSection
            key={leg.id}
            leg={leg}
            legPicks={picksByLeg.get(leg.leg_number) ?? []}
            names={names}
            currentUserId={currentUserId}
            isOpen={isOpen}
            error={legErrors[leg.leg_number]}
            onAdd={(num, name) => void addPick(leg, num, name)}
            onRemove={(pickId) => void removePick(pickId, leg.leg_number)}
          />
        ))}

      {status === 'settled' && <ResultsTable results={results} names={names} />}
    </div>
  );
}

function LegSection({
  leg,
  legPicks,
  names,
  currentUserId,
  isOpen,
  error,
  onAdd,
  onRemove,
}: {
  leg: Leg;
  legPicks: Pick[];
  names: Record<string, string>;
  currentUserId: string;
  isOpen: boolean;
  error?: string;
  onAdd: (runnerNumber: number, runnerName: string) => void;
  onRemove: (pickId: string) => void;
}) {
  const [numberInput, setNumberInput] = useState('');
  const [nameInput, setNameInput] = useState('');

  // Group picks by runner: one row per runner, chips per picker.
  interface RunnerRow {
    runnerNumber: number;
    label: string;
    mine: Pick | undefined;
    others: Array<{ pickId: string; initials: string; full: string }>;
  }
  const rows = new Map<number, RunnerRow>();
  for (const p of legPicks) {
    let row = rows.get(p.runner_number);
    if (row === undefined) {
      row = {
        runnerNumber: p.runner_number,
        label: p.runner_name ?? '',
        mine: undefined,
        others: [],
      };
      rows.set(p.runner_number, row);
    }
    if (row.label === '' && p.runner_name !== null) row.label = p.runner_name;

    const who = names[p.user_id] ?? '?';
    const chip = { pickId: p.id, initials: initialsOf(who), full: who };
    if (p.user_id === currentUserId) {
      row.mine = p;
    } else {
      row.others.push(chip);
    }
  }
  const sortedRows = [...rows.values()].sort((a, b) => a.runnerNumber - b.runnerNumber);

  const winnerShown =
    leg.winner_number !== null && (leg.winner_name !== null || leg.winner_sp !== null);

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    const num = Number(numberInput);
    if (!Number.isInteger(num) || num < 1 || num > 99) return;
    onAdd(num, nameInput.trim());
    setNumberInput('');
    setNameInput('');
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <h2 className="text-sm font-bold">
          Leg {leg.leg_number}
          {leg.race_number !== null && <span className="ml-1 font-normal text-slate-500">· R{leg.race_number}</span>}
        </h2>
        {winnerShown && (
          <span className="text-xs font-medium text-emerald-700">
            🏆 #{leg.winner_number} {leg.winner_name ?? ''} @ ${money(Number(leg.winner_sp ?? 0))}
          </span>
        )}
      </header>

      <ul className="divide-y divide-slate-50">
        {sortedRows.length === 0 && (
          <li className="px-3 py-3 text-sm text-slate-400">No tips yet — open the batting.</li>
        )}
        {sortedRows.map((row) => (
          <li key={row.runnerNumber} className="flex items-center gap-2 px-3 py-2">
            <span className="w-7 shrink-0 rounded bg-slate-100 text-center text-xs font-bold leading-6">
              {row.runnerNumber}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm">{row.label || `Runner #${row.runnerNumber}`}</span>

            <span className="flex shrink-0 items-center gap-1" aria-label={`Also picked by ${row.others.map((o) => o.full).join(', ')}`}>
              {row.mine !== undefined && (
                <>
                  <abbr
                    title={`${names[currentUserId]} (you)`}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white no-underline"
                  >
                    {initialsOf(names[currentUserId] ?? 'Me')}
                  </abbr>
                  {isOpen && (
                    <button
                      type="button"
                      onClick={() => onRemove(row.mine!.id)}
                      aria-label={`Remove your tip #${row.runnerNumber}`}
                      className="tap inline-flex w-8 items-center justify-center rounded text-red-500 active:bg-red-50"
                    >
                      ✕
                    </button>
                  )}
                </>
              )}
              {row.others.map((o) => (
                <abbr
                  key={o.pickId}
                  title={o.full}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600 no-underline"
                >
                  {o.initials}
                </abbr>
              ))}
            </span>
          </li>
        ))}
      </ul>

      {isOpen ? (
        <form onSubmit={submit} className="flex items-end gap-2 border-t border-slate-100 px-3 py-2">
          <label className="flex flex-col">
            <span className="sr-only">Runner number</span>
            <input
              value={numberInput}
              onChange={(e) => setNumberInput(e.target.value)}
              inputMode="numeric"
              placeholder="#No"
              aria-label={`Runner number for leg ${leg.leg_number}`}
              className="tap w-16 rounded-lg border border-slate-300 px-2 outline-none focus:border-slate-900"
            />
          </label>
          <label className="min-w-0 flex-1">
            <span className="sr-only">Runner name</span>
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Name (optional)"
              aria-label={`Runner name for leg ${leg.leg_number}`}
              maxLength={40}
              className="tap w-full rounded-lg border border-slate-300 px-2 outline-none focus:border-slate-900"
            />
          </label>
          <button
            type="submit"
            disabled={numberInput.trim() === ''}
            className="tap shrink-0 rounded-lg bg-emerald-600 px-3 font-semibold text-white disabled:opacity-40"
          >
            Add
          </button>
        </form>
      ) : null}

      {error !== undefined && error !== '' && (
        <p role="alert" className="border-t border-slate-100 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
