'use client';

// Trifecta and first 4 for one feature race. Missing exotic_picks table is a
// note, not a crash — the migration may not be on production yet.

import { useEffect, useState } from 'react';
import { formatExotic, isMissingExoticsTable, parseExotic } from '@/lib/exotics';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { Runner } from '@/lib/types';

interface Row {
  user_id: string;
  trifecta: number[];
  first4: number[];
}

interface Props {
  meetingId: string;
  raceNumber: number;
  label: string;
  runners: Runner[];
  names: Record<string, string>;
  currentUserId: string;
  hasName: boolean;
}

const PLACES = ['1st', '2nd', '3rd', '4th'] as const;

function asNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((n): n is number => typeof n === 'number');
}

export function ExoticPicks({
  meetingId,
  raceNumber,
  label,
  runners,
  names,
  currentUserId,
  hasName,
}: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [trifecta, setTrifecta] = useState(['', '', '']);
  const [first4, setFirst4] = useState(['', '', '', '']);

  const field = [...runners].sort((a, b) => Number(a.scratched) - Number(b.scratched) || a.runner_number - b.runner_number);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase
        .from('exotic_picks')
        .select('user_id, trifecta, first4')
        .eq('meeting_id', meetingId)
        .eq('race_number', raceNumber);
      if (cancelled) return;
      if (error !== null) {
        if (isMissingExoticsTable(error)) {
          setUnavailable(true);
          return;
        }
        setLoadError(error.message);
        return;
      }
      const next = ((data ?? []) as Array<{ user_id: string; trifecta: unknown; first4: unknown }>).map((row) => ({
        user_id: row.user_id,
        trifecta: asNumbers(row.trifecta),
        first4: asNumbers(row.first4),
      }));
      setRows(next);
      const mine = next.find((row) => row.user_id === currentUserId);
      if (mine !== undefined) {
        setTrifecta([0, 1, 2].map((i) => (mine.trifecta[i] === undefined ? '' : String(mine.trifecta[i]))));
        setFirst4([0, 1, 2, 3].map((i) => (mine.first4[i] === undefined ? '' : String(mine.first4[i]))));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meetingId, raceNumber, currentUserId]);

  async function save(): Promise<void> {
    setSaveError(undefined);
    if (!hasName || currentUserId === '') {
      setSaveError('Add your name at the top so this pick is yours.');
      return;
    }
    const tri = parseExotic(trifecta, 3, 'Trifecta');
    if (!tri.ok) {
      setSaveError(tri.error);
      return;
    }
    const ff = parseExotic(first4, 4, 'First 4');
    if (!ff.ok) {
      setSaveError(ff.error);
      return;
    }
    setSaving(true);
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from('exotic_picks').upsert(
      {
        meeting_id: meetingId,
        race_number: raceNumber,
        user_id: currentUserId,
        trifecta: tri.numbers,
        first4: ff.numbers,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'meeting_id,race_number,user_id' },
    );
    setSaving(false);
    if (error !== null) {
      setSaveError(isMissingExoticsTable(error) ? 'Exotics are not in the database yet.' : error.message);
      if (isMissingExoticsTable(error)) setUnavailable(true);
      return;
    }
    setRows((prev) => {
      const others = prev.filter((row) => row.user_id !== currentUserId);
      return [...others, { user_id: currentUserId, trifecta: tri.numbers, first4: ff.numbers }];
    });
  }

  const ordered = [...rows].sort((a, b) => (names[a.user_id] ?? '').localeCompare(names[b.user_id] ?? ''));

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <h2 className="text-sm font-bold">{label}</h2>
      <p className="mt-0.5 text-xs text-slate-500">R{raceNumber} · trifecta and first 4, in finishing order. Not part of the quaddie.</p>
      {unavailable ? (
        <p className="mt-2 text-sm text-slate-500">Exotics show up once the database update is applied. The quaddie below still works.</p>
      ) : (
        <>
          {loadError !== undefined && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {loadError}
            </p>
          )}
          <ExoticPlaces label="Trifecta" places={3} values={trifecta} runners={field} onChange={setTrifecta} />
          <ExoticPlaces label="First 4" places={4} values={first4} runners={field} onChange={setFirst4} />
          {saveError !== undefined && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {saveError}
            </p>
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="tap mt-3 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save exotics'}
          </button>
          <ul className="mt-3 divide-y divide-slate-100">
            {ordered.length === 0 ? (
              <li className="py-2 text-sm text-slate-400">No exotic picks yet.</li>
            ) : (
              ordered.map((row) => (
                <li key={row.user_id} className="py-2 text-sm">
                  <span className="font-medium">{names[row.user_id] ?? 'Someone'}</span>
                  <span className="mt-0.5 block text-slate-600">
                    Trifecta {formatExotic(row.trifecta)} · First 4 {formatExotic(row.first4)}
                  </span>
                </li>
              ))
            )}
          </ul>
        </>
      )}
    </section>
  );
}

function ExoticPlaces({
  label,
  places,
  values,
  runners,
  onChange,
}: {
  label: string;
  places: 3 | 4;
  values: string[];
  runners: Runner[];
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset className="mt-3">
      <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</legend>
      <div className={`mt-1 grid gap-2 ${places === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
        {PLACES.slice(0, places).map((place, index) => (
          <label key={place} className="flex flex-col gap-0.5">
            <span className="text-[11px] text-slate-500">{place}</span>
            {runners.length > 0 ? (
              <select
                aria-label={`${label} ${place}`}
                value={values[index] ?? ''}
                onChange={(event) => {
                  const next = [...values];
                  next[index] = event.target.value;
                  onChange(next);
                }}
                className="tap rounded-lg border border-slate-300 bg-white px-1 text-sm"
              >
                <option value="">—</option>
                {runners.map((runner) => (
                  <option key={runner.id} value={String(runner.runner_number)} disabled={runner.scratched}>
                    {runner.runner_number} {runner.runner_name ?? ''}
                    {runner.scratched ? ' SCR' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                aria-label={`${label} ${place}`}
                inputMode="numeric"
                value={values[index] ?? ''}
                onChange={(event) => {
                  const next = [...values];
                  next[index] = event.target.value;
                  onChange(next);
                }}
                className="tap rounded-lg border border-slate-300 px-2 text-sm"
              />
            )}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
