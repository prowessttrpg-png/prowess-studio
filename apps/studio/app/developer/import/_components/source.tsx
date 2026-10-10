"use client";

import type { SourceContentNodeDto, SourceSectionDto, TableStructureDto } from "../../../../src/api-client";
import { formatBytes } from "../_lib/presentation";

/**
 * Immutable source rendering (PAS-10 M3-WO8). Text is shown VERBATIM (whitespace and line breaks preserved), tables
 * are rendered from their WO1 structure, assets as provenance metadata only (bytes are not stored; nothing is OCR'd
 * or interpreted). Highlights only mark offsets / cells the Candidate payload supplies.
 */

/** Verbatim text; the [start, end) UTF-16 range (when given) is emphasized with <mark>. */
export function HighlightedText({ text, start, end }: { text: string; start?: number | null; end?: number | null }) {
  const ok = typeof start === "number" && typeof end === "number" && start >= 0 && end <= text.length && start < end;
  return (
    <p className="imp-source-text" data-testid="source-text">
      {ok ? (
        <>
          {text.slice(0, start)}
          <mark data-testid="source-highlight">{text.slice(start, end)}</mark>
          {text.slice(end)}
        </>
      ) : (
        text
      )}
    </p>
  );
}

/** A WO1 table as an HTML table; the highlighted cell (row / grid column) is marked, never interpreted. */
export function SourceTableView({ structure, caption, highlight }: { structure: TableStructureDto; caption?: string | null; highlight?: { row: number; column: number } | null }) {
  return (
    <div className="imp-table-scroll">
      <table className="imp-source-table" data-testid="source-table">
        {caption ? <caption>{caption}</caption> : null}
        <tbody>
          {structure.rows.map((row) => (
            <tr key={row.index}>
              {row.cells.map((cell) => {
                const Tag = cell.isHeader ? "th" : "td";
                const marked = highlight && highlight.row === row.index && highlight.column === cell.columnIndex;
                return (
                  <Tag key={cell.index} rowSpan={cell.rowSpan} colSpan={cell.colSpan} data-highlight={marked ? "true" : undefined} aria-current={marked ? "true" : undefined} scope={cell.isHeader ? "col" : undefined}>
                    {cell.rawText}
                    {cell.nestedTables.map((n, i) => (
                      <SourceTableView key={i} structure={n} />
                    ))}
                  </Tag>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface NodeHighlight {
  nodeId: string;
  start?: number | null;
  end?: number | null;
  row?: number | null;
  column?: number | null;
}

/** One content node: a verbatim block, a structured table, or an asset placement's metadata. */
export function SourceNodeView({ node, highlight }: { node: SourceContentNodeDto; highlight?: NodeHighlight | null }) {
  const hit = highlight && highlight.nodeId === node.id ? highlight : null;
  return (
    <article className="imp-node" data-testid="source-node" data-node-id={node.id} data-selected={hit ? "true" : undefined} aria-current={hit ? "true" : undefined}>
      {node.nodeType === "BLOCK" && node.block ? (
        <>
          <p className="gov-muted imp-node__meta">
            {node.block.blockType.replace(/_/g, " ")} · #{node.ordinal}
          </p>
          <HighlightedText text={node.block.rawText} start={hit?.start} end={hit?.end} />
        </>
      ) : null}
      {node.nodeType === "TABLE" && node.table ? (
        <>
          <p className="gov-muted imp-node__meta">TABLE · #{node.ordinal}</p>
          <SourceTableView structure={node.table.structure} caption={node.table.caption} highlight={hit && typeof hit.row === "number" && typeof hit.column === "number" ? { row: hit.row, column: hit.column } : null} />
        </>
      ) : null}
      {node.nodeType === "ASSET_PLACEMENT" && node.asset ? (
        <div className="imp-asset" data-testid="source-asset">
          <p className="gov-muted imp-node__meta">ASSET · #{node.ordinal}</p>
          <p>
            {node.asset.assetType} · {node.asset.mimeType} · {formatBytes(node.asset.byteSize)}
            {node.asset.width && node.asset.height ? ` · ${node.asset.width}×${node.asset.height}` : ""}
          </p>
          {node.placement?.altTextFromSource ? <p>Alt text: “{node.placement.altTextFromSource}”</p> : null}
          <p className="gov-muted">Image bytes are not stored in the Studio — this is provenance metadata only (no OCR or image interpretation).</p>
        </div>
      ) : null}
    </article>
  );
}

/** The section hierarchy as a nested, keyboard-navigable list of buttons. */
export function SectionOutline({ sections, selectedId, onSelect }: { sections: readonly SourceSectionDto[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const children = new Map<string | null, SourceSectionDto[]>();
  for (const s of sections) children.set(s.parentSectionId, [...(children.get(s.parentSectionId) ?? []), s]);
  const render = (parent: string | null, depth: number) => {
    const list = children.get(parent) ?? [];
    if (list.length === 0 || depth > 12) return null;
    return (
      <ul className="imp-outline__list">
        {list.map((s) => (
          <li key={s.id}>
            <button type="button" className="imp-outline__item" aria-current={selectedId === s.id ? "true" : undefined} onClick={() => onSelect(s.id)} data-testid="outline-section">
              <span className="gov-muted">H{s.headingLevel}</span> {s.title}
              <span className="gov-muted"> · {(children.get(s.id) ?? []).length} sub</span>
            </button>
            {render(s.id, depth + 1)}
          </li>
        ))}
      </ul>
    );
  };
  return (
    <nav aria-label="Source outline" className="imp-outline" data-testid="source-outline">
      {sections.length === 0 ? <p className="gov-muted">No sections — this source has no headings.</p> : render(null, 0)}
    </nav>
  );
}
