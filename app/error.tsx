'use client';

// Global error surface — rubric R6: errors are visible messages, never silent.
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-lg font-semibold">Something broke.</p>
      <p className="text-sm text-slate-600">{error.message || 'Unexpected error.'}</p>
      <button
        type="button"
        onClick={reset}
        className="tap rounded-lg bg-slate-900 px-6 py-2 font-medium text-white active:bg-slate-700"
      >
        Try again
      </button>
    </main>
  );
}
