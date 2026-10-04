import type { EntityVersionDto } from "../_lib/api-client";

/**
 * Revision A / Revision B selectors (PAS-10 M1-WO10 §12, §26). With fewer
 * than two revisions there is nothing to compare, so no selectors are
 * rendered at all — never an empty second dropdown.
 */
export function ComparisonControls({
  versions,
  revisionA,
  revisionB,
  onChange,
  onClear,
}: {
  versions: EntityVersionDto[];
  revisionA: string;
  revisionB: string;
  onChange: (revisionA: string, revisionB: string) => void;
  onClear: () => void;
}) {
  if (versions.length < 2) {
    return (
      <section aria-labelledby="compare-heading" data-testid="comparison-controls">
        <h2 id="compare-heading">Compare Revisions</h2>
        <p className="prowess-compare-unavailable" data-testid="comparison-unavailable">
          Comparison needs at least two revisions.
        </p>
      </section>
    );
  }

  const ordered = [...versions].sort((a, b) => a.revisionNumber - b.revisionNumber);
  const options = ordered.map((version) => (
    <option key={version.id} value={String(version.revisionNumber)}>
      Revision {version.revisionNumber} — {version.displayName}
    </option>
  ));

  return (
    <section aria-labelledby="compare-heading" data-testid="comparison-controls">
      <h2 id="compare-heading">Compare Revisions</h2>
      <div className="prowess-compare-controls">
        <div className="prowess-compare-controls__field">
          <label htmlFor="compare-revision-a">Revision A</label>
          <select
            id="compare-revision-a"
            value={revisionA}
            onChange={(event) => onChange(event.target.value, revisionB)}
          >
            <option value="">Select a revision</option>
            {options}
          </select>
        </div>
        <div className="prowess-compare-controls__field">
          <label htmlFor="compare-revision-b">Revision B</label>
          <select
            id="compare-revision-b"
            value={revisionB}
            onChange={(event) => onChange(revisionA, event.target.value)}
          >
            <option value="">Select a revision</option>
            {options}
          </select>
        </div>
        {revisionA !== "" || revisionB !== "" ? (
          <button type="button" className="prowess-compare-controls__clear" onClick={onClear}>
            Clear comparison
          </button>
        ) : null}
      </div>
    </section>
  );
}
