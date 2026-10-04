/**
 * Renders `structuredData`/relationship `metadata` as formatted JSON
 * (PAS-10 M1-WO9 §17, §23) — sufficient for M1; no subsystem-specific
 * Effect/Spell rendering is attempted. Scrolls internally rather than
 * letting large JSON blow out the page layout.
 */
export function StructuredDataViewer({ data, emptyLabel }: { data: unknown; emptyLabel: string }) {
  const isEmptyObject =
    data !== null && typeof data === "object" && !Array.isArray(data) && Object.keys(data).length === 0;

  if (data === null || data === undefined || isEmptyObject) {
    return <p className="prowess-structured-data__empty">{emptyLabel}</p>;
  }

  return (
    <pre className="prowess-structured-data" data-testid="structured-data">
      <code>{JSON.stringify(data, null, 2)}</code>
    </pre>
  );
}
