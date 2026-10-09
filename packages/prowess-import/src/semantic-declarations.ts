/**
 * Explicit declaration detection for `prowess.semantic-foundation@1` (PAS-10 M3-WO5) — pure, deterministic,
 * locale-free. Only an explicit structural marker at a statement boundary opens a declaration:
 *
 *   Formula:  Formulas:  Requirement:  Requirements:  Requires:  Prerequisite:  Prerequisites:  Keyword:  Keywords:
 *
 * plus one narrowly-defined colon-less form, `Requires <Capitalized Term …>`, at a statement start (see
 * `findInlineRequires`). A marker word anywhere else ("This calculation requires …", "the keyword list") opens
 * nothing. Offsets are UTF-16 code-unit indices into the exact source string (JavaScript string indexing).
 */
export type DeclarationRole = "FORMULA" | "REQUIREMENT" | "KEYWORD";

export interface Declaration {
  role: DeclarationRole;
  /** The marker exactly as authored, without the colon (e.g. "Requirements"). */
  markerText: string;
  form: "COLON" | "INLINE";
  /** Span of the whole declaration (marker through value) — claimed so no other parser re-reads it. */
  start: number;
  end: number;
  /** Span of the value (trimmed; a trailing sentence terminator excluded). */
  valueStart: number;
  valueEnd: number;
}

const MARKER_ROLE: Record<string, DeclarationRole> = {
  formula: "FORMULA",
  formulas: "FORMULA",
  requirement: "REQUIREMENT",
  requirements: "REQUIREMENT",
  requires: "REQUIREMENT",
  prerequisite: "REQUIREMENT",
  prerequisites: "REQUIREMENT",
  keyword: "KEYWORD",
  keywords: "KEYWORD",
};

const MARKER_PATTERN = /(Formulas?|Requirements?|Requires|Prerequisites?|Keywords?)[ \t]*:/giu;

/** A statement boundary: start of text, start of a line, or after a sentence terminator / semicolon. */
export function isStatementBoundary(text: string, index: number): boolean {
  let k = index - 1;
  while (k >= 0 && (text[k] === " " || text[k] === "\t")) k -= 1;
  if (k < 0 || text[k] === "\n") return true;
  if (index - 1 === k) return false; // a marker glued to a preceding character is not at a boundary
  return text[k] === "." || text[k] === "!" || text[k] === "?" || text[k] === ";";
}

/** End of a value: the next line break, the next boundary-marker, or a sentence terminator followed by space/end. */
function valueEnd(text: string, from: number, nextMarkerStart: number): number {
  let end = text.length;
  const nl = text.indexOf("\n", from);
  if (nl >= 0) end = Math.min(end, nl);
  end = Math.min(end, nextMarkerStart);
  for (let i = from; i < end; i += 1) {
    const c = text[i];
    if ((c === "." || c === "!" || c === "?") && (i + 1 >= text.length || /\s/.test(text[i + 1] as string))) return i;
  }
  return end;
}

function trimSpan(text: string, start: number, end: number): [number, number] {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text[s] as string)) s += 1;
  while (e > s && /\s/.test(text[e - 1] as string)) e -= 1;
  return [s, e];
}

/** Every explicit colon-marked declaration, in source order. */
export function findColonDeclarations(text: string): Declaration[] {
  const markers: Array<{ start: number; afterColon: number; word: string }> = [];
  for (const m of text.matchAll(MARKER_PATTERN)) {
    const start = m.index ?? 0;
    if (isStatementBoundary(text, start)) markers.push({ start, afterColon: start + m[0].length, word: m[1] as string });
  }
  return markers.flatMap((m, i) => {
    const next = markers[i + 1]?.start ?? text.length;
    const [valueStart, valueEndIndex] = trimSpan(text, m.afterColon, valueEnd(text, m.afterColon, next));
    if (valueEndIndex <= valueStart) return [];
    return [{ role: MARKER_ROLE[m.word.toLowerCase()] as DeclarationRole, markerText: m.word, form: "COLON" as const, start: m.start, end: valueEndIndex, valueStart, valueEnd: valueEndIndex }];
  });
}

const CONNECTORS = new Set(["and", "or", "of", "in", "at", "to", "with"]);

/**
 * The single colon-less form: a statement that BEGINS with "Requires " followed only by capitalized / numeric words
 * (and the connectors and/or/of/in/at/to/with), e.g. "Requires Expert Emission." — while "Requires the GM to …" or
 * "This spell requires …" open nothing. Spans already claimed by a colon declaration are skipped.
 */
export function findInlineRequires(text: string, claimed: ReadonlyArray<{ start: number; end: number }>): Declaration[] {
  const out: Declaration[] = [];
  for (const m of text.matchAll(/Requires[ \t]+(?=\S)/gu)) {
    const start = m.index ?? 0;
    if (!isStatementBoundary(text, start) || text[start + m[0].length] === ":" || claimed.some((c) => start >= c.start && start < c.end)) continue;
    const from = start + m[0].length;
    const [valueStart, end] = trimSpan(text, from, valueEnd(text, from, text.length));
    if (end <= valueStart) continue;
    const words = text.slice(valueStart, end).split(/[ \t]+/);
    const ok = words.length <= 12 && /^[\p{Lu}\p{N}]/u.test(words[0] as string) && words.every((w) => /^[\p{Lu}\p{N}][\p{L}\p{N}'’-]*[,;]?$/u.test(w) || CONNECTORS.has(w.replace(/[,;]$/, "")));
    if (ok) out.push({ role: "REQUIREMENT", markerText: "Requires", form: "INLINE", start, end, valueStart, valueEnd: end });
  }
  return out;
}

/** Unclaimed statements (line / sentence segments) of a text, with offsets — candidates for bare assignments. */
export function unclaimedStatements(text: string, claimed: ReadonlyArray<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let segStart = 0;
  const flush = (end: number) => {
    const [s, e] = trimSpan(text, segStart, end);
    if (e > s && !claimed.some((c) => s < c.end && e > c.start)) out.push({ start: s, end: e });
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "\n") {
      flush(i);
      segStart = i + 1;
    } else if ((c === "." || c === "!" || c === "?") && (i + 1 >= text.length || /\s/.test(text[i + 1] as string))) {
      flush(i);
      segStart = i + 1;
    }
  }
  flush(text.length);
  return out;
}
