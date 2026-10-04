export interface KeywordChipProps {
  name: string;
  /** Shown as a `title` tooltip when present — e.g. the Keyword's canonical key. */
  canonicalKey?: string;
}

/**
 * A small label for one Keyword assignment. Purely presentational — a
 * Keyword name rendered here implies nothing mechanical about it (PAS-10
 * M1-WO5's "no implicit mechanics" rule applies just as much to how a
 * Keyword is displayed as to how it's stored).
 */
export function KeywordChip({ name, canonicalKey }: KeywordChipProps) {
  return (
    <span className="prowess-keyword-chip" data-testid="keyword-chip" title={canonicalKey}>
      {name}
    </span>
  );
}
