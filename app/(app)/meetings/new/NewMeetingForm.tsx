'use client';

import { useActionState } from 'react';
import { createMeeting, type CreateMeetingState } from '@/app/actions/meetings';
import { ErrorNote } from '@/components/ErrorNote';

const initialState: CreateMeetingState = {};

export function NewMeetingForm({ today }: { today: string }) {
  const [state, formAction, pending] = useActionState(createMeeting, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Track</span>
        <input
          name="track"
          required
          maxLength={60}
          placeholder="Royal Randwick"
          className="tap rounded-lg border border-slate-300 px-3 outline-none focus:border-slate-900"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Date</span>
        <input
          name="date"
          type="date"
          required
          defaultValue={today}
          className="tap rounded-lg border border-slate-300 px-3 outline-none focus:border-slate-900"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Quaddie legs — race numbers</legend>
        {[1, 2, 3, 4].map((leg) => (
          <label key={leg} className="flex items-center gap-3">
            <span className="w-12 text-sm text-slate-600">Leg {leg}</span>
            <span className="text-sm text-slate-400">R</span>
            <input
              name={`race${leg}`}
              type="number"
              inputMode="numeric"
              min={1}
              max={12}
              required
              placeholder="5"
              className="tap w-20 rounded-lg border border-slate-300 px-3 outline-none focus:border-slate-900"
            />
          </label>
        ))}
      </fieldset>

      {state.error !== undefined && <ErrorNote message={state.error} />}

      <button
        type="submit"
        disabled={pending}
        className="tap rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-60"
      >
        {pending ? 'Creating…' : 'Create meeting'}
      </button>
    </form>
  );
}
