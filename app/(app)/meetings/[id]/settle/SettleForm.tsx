'use client';

import { useActionState } from 'react';
import { settleMeeting, type SettleState } from '@/app/actions/meetings';
import { ErrorNote } from '@/components/ErrorNote';

const initialState: SettleState = {};

interface LegInput {
  legNumber: number;
  raceNumber: number | null;
}

export function SettleForm({ meetingId, legs }: { meetingId: string; legs: LegInput[] }) {
  const [state, formAction, pending] = useActionState(settleMeeting, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="meetingId" value={meetingId} />

      {legs.map((leg) => (
        <fieldset key={leg.legNumber} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <legend className="px-1 text-sm font-bold">
            Leg {leg.legNumber}
            {leg.raceNumber !== null && <span className="ml-1 font-normal text-slate-500">· R{leg.raceNumber}</span>}
          </legend>
          <div className="flex items-end gap-2">
            <label className="w-20 flex-col">
              <span className="text-xs text-slate-500">Runner №</span>
              <input
                name={`winner${leg.legNumber}`}
                inputMode="numeric"
                required
                placeholder="#7"
                className="tap w-full rounded-lg border border-slate-300 px-2 outline-none focus:border-slate-900"
              />
            </label>
            <label className="min-w-0 flex-1">
              <span className="text-xs text-slate-500">Name</span>
              <input
                name={`name${leg.legNumber}`}
                maxLength={40}
                placeholder="Winner’s name"
                className="tap w-full rounded-lg border border-slate-300 px-2 outline-none focus:border-slate-900"
              />
            </label>
            <label className="w-24">
              <span className="text-xs text-slate-500">SP ($)</span>
              <input
                name={`sp${leg.legNumber}`}
                inputMode="decimal"
                required
                placeholder="4.50"
                step="0.01"
                min="1.01"
                className="tap w-full rounded-lg border border-slate-300 px-2 outline-none focus:border-slate-900"
              />
            </label>
          </div>
        </fieldset>
      ))}

      {state.error !== undefined && <ErrorNote message={state.error} />}

      <button
        type="submit"
        disabled={pending}
        className="tap rounded-lg bg-sky-600 px-4 py-2 font-semibold text-white disabled:opacity-60"
      >
        {pending ? 'Settling…' : 'Settle & show result'}
      </button>
    </form>
  );
}
