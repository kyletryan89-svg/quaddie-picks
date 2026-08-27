// Parsing a pasted race field. PURE — no imports at all, so it runs identically
// in the browser (live preview) and in tests.
//
// People paste from wherever the fields happen to be: a form guide, a text
// message, a screenshot transcription. The accepted shapes are:
//
//   7. Horse Name
//   7 Horse Name
//   7. Horse Name (5)     ← trailing barrier in brackets, discarded
//
// Anything else on a line is skipped rather than guessed at, and the caller
// shows the user exactly what was and was not understood before saving.

export interface ParsedRunner {
  number: number;
  name: string;
}

export interface FieldParseResult {
  runners: ParsedRunner[];
  /** Lines that could not be read, verbatim, for showing back to the user. */
  skipped: string[];
}

/** Runner numbers share the settle screen's field bound (see D11). */
const FIELD_MIN = 1;
const FIELD_MAX = 99;

// number, optional . ) : or -, then the rest of the line.
const LINE = /^(\d{1,3})\s*[.):\-]?\s+(.+)$/;
// A bracketed number at the very end is the barrier, not part of the name.
const TRAILING_BARRIER = /\s*\(\s*\d{1,3}\s*\)\s*$/;

export function parseField(text: string): FieldParseResult {
  const runners: ParsedRunner[] = [];
  const skipped: string[] = [];
  const seen = new Set<number>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue; // blank lines are not "skipped", they are nothing

    const match = LINE.exec(line);
    if (match === null) {
      skipped.push(line);
      continue;
    }

    const number = Number(match[1]);
    if (!Number.isInteger(number) || number < FIELD_MIN || number > FIELD_MAX) {
      skipped.push(line);
      continue;
    }

    const name = (match[2] ?? '').replace(TRAILING_BARRIER, '').trim();
    if (name === '') {
      skipped.push(line);
      continue;
    }

    // A number can only appear once in a field; keep the first, skip the rest.
    if (seen.has(number)) {
      skipped.push(line);
      continue;
    }
    seen.add(number);
    runners.push({ number, name });
  }

  runners.sort((a, b) => a.number - b.number);
  return { runners, skipped };
}
