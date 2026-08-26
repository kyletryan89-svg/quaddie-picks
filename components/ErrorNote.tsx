export function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </p>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden className="flex animate-pulse flex-col gap-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-20 rounded-xl bg-slate-200/70" />
      ))}
    </div>
  );
}
