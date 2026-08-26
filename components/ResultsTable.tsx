import { money, signedMoney } from '@/lib/format';
import type { UserResult } from '@/lib/scoring';

// Per-meeting result table (SPEC §6 settle outcome). Compact for 390px; the
// wrapper scrolls internally if a name is enormous — the page never does.
export function ResultsTable({ results, names }: { results: UserResult[]; names: Record<string, string> }) {
  if (results.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
        No tips were placed on this meeting.
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <h2 className="border-b border-slate-100 px-3 py-2 text-sm font-bold">Result</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 font-medium">Punter</th>
              <th className="px-2 py-2 text-right font-medium">Tips</th>
              <th className="px-2 py-2 text-right font-medium">Out</th>
              <th className="px-2 py-2 text-right font-medium">Hit</th>
              <th className="px-2 py-2 text-right font-medium">Ret</th>
              <th className="px-2 py-2 text-right font-medium">P/L</th>
              <th className="px-3 py-2 font-medium">Flags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {results.map((r) => (
              <tr key={r.userId}>
                <td className="max-w-[120px] truncate px-3 py-2 font-medium">{names[r.userId] ?? 'Unknown'}</td>
                <td className="px-2 py-2 text-right tabular-nums">{r.selections}</td>
                <td className="px-2 py-2 text-right tabular-nums">${money(r.outlay)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{r.legsHit}/4</td>
                <td className="px-2 py-2 text-right tabular-nums">${money(r.return)}</td>
                <td
                  className={`px-2 py-2 text-right font-semibold tabular-nums ${
                    r.profit > 0 ? 'text-emerald-700' : r.profit < 0 ? 'text-red-600' : ''
                  }`}
                >
                  {signedMoney(r.profit)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">
                  {r.soloLegs > 0 && <span title={`${r.soloLegs} solo leg(s)`}>🎯{r.soloLegs}</span>}
                  {r.fullCover && <span title="Full cover — hit all four legs">🧹</span>}
                  {r.soloLegs === 0 && !r.fullCover && <span className="text-slate-300">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-50 px-3 py-1.5 text-[11px] text-slate-400">
        🎯 solo leg · 🧹 full cover. SP = total return per $1.
      </p>
    </section>
  );
}
