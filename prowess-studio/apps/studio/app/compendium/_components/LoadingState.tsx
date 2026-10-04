/**
 * A plain, accessible loading message (PAS-10 M1-WO9 §13) — deliberately
 * not a decorative spinner animation; `role="status"` with `aria-live`
 * lets assistive tech announce it without visual-only cues.
 */
export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="prowess-compendium__loading" role="status" aria-live="polite" data-testid="loading-state">
      {label}
    </div>
  );
}
