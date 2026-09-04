'use client';

import { useActionState } from 'react';
import { login, type LoginState } from '@/app/actions/auth';

const initialState: LoginState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Your name</span>
        <input
          name="displayName"
          required
          maxLength={40}
          autoComplete="off"
          className="tap rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-slate-900"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Group passcode</span>
        <input
          name="passcode"
          type="password"
          required
          autoComplete="off"
          placeholder="••••••••"
          className="tap rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-slate-900"
        />
      </label>

      {state.error !== undefined && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="tap rounded-lg bg-slate-900 px-4 py-2 text-base font-semibold text-white disabled:opacity-60"
      >
        {pending ? 'Checking…' : 'In'}
      </button>
    </form>
  );
}
