'use client';

// Name entry lives in the app, not on a login screen. The banner is open until
// a name is saved; after that the header name reopens it. No password.

import { createContext, useActionState, useContext, useState } from 'react';
import { setDisplayName, startFresh, type NameState } from '@/app/actions/auth';

interface IdentityValue {
  name: string | null;
  showForm: boolean;
  openForm: () => void;
  closeForm: () => void;
  state: NameState;
  formAction: (formData: FormData) => void;
  pending: boolean;
}

const IdentityContext = createContext<IdentityValue | null>(null);

function useIdentity(): IdentityValue {
  const value = useContext(IdentityContext);
  if (value === null) throw new Error('Identity controls must sit inside IdentityProvider');
  return value;
}

export function IdentityProvider({
  displayName,
  children,
}: {
  displayName: string | null;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(setDisplayName, {} as NameState);
  const name = state.saved ?? displayName;
  const [editing, setEditing] = useState(displayName === null);
  const [seenSaved, setSeenSaved] = useState<string | undefined>(undefined);
  if (state.saved !== undefined && state.saved !== seenSaved) {
    setSeenSaved(state.saved);
    setEditing(false);
  }

  const value: IdentityValue = {
    name,
    showForm: editing || name === null,
    openForm: () => setEditing(true),
    closeForm: () => setEditing(false),
    state,
    formAction,
    pending,
  };

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function IdentityButton() {
  const { name, openForm } = useIdentity();
  return (
    <button
      type="button"
      data-testid="identity-name"
      onClick={() => {
        openForm();
        requestAnimationFrame(() => document.getElementById('your-name')?.focus());
      }}
      className="tap ml-1 inline-flex max-w-[88px] items-center truncate px-1.5 text-xs text-slate-500 underline"
    >
      {name ?? 'Your name'}
    </button>
  );
}

export function IdentityBanner() {
  const { name, showForm, closeForm, state, formAction, pending } = useIdentity();
  if (!showForm) return null;

  return (
    <div className="border-t border-slate-200 bg-white">
      <form action={formAction} className="mx-auto flex w-full max-w-md flex-col gap-2 px-4 py-3 lg:max-w-5xl">
        <label className="flex flex-col gap-1" htmlFor="your-name">
          <span className="text-sm font-medium">Your name</span>
          <input
            id="your-name"
            name="displayName"
            required
            maxLength={40}
            autoComplete="nickname"
            defaultValue={name ?? ''}
            placeholder="Kyle"
            className="tap rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-slate-900"
          />
        </label>
        <p className="text-xs leading-relaxed text-slate-500">
          Picks use this name. No password. The ladder knows Kyle, Leigh, Steve, Pete and Chris.
          {name !== null ? ' Renaming keeps these picks and the ladder follows the new name.' : ''}
        </p>
        {state.error !== undefined && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.error}
          </p>
        )}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            data-testid="save-name"
            disabled={pending}
            className="tap rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending ? 'Saving…' : 'Save name'}
          </button>
          {name !== null && (
            <button type="button" onClick={closeForm} className="tap px-2 text-sm text-slate-500 underline">
              Cancel
            </button>
          )}
        </div>
      </form>
      {name !== null && (
        <form action={startFresh} className="mx-auto w-full max-w-md px-4 pb-3 lg:max-w-5xl">
          <button type="submit" data-testid="someone-else" className="tap text-xs text-slate-400 underline">
            Someone else on this phone
          </button>
        </form>
      )}
    </div>
  );
}
