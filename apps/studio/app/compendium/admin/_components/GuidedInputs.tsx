"use client";

import { formatEnumLabel } from "@prowess/ui";
import { useId } from "react";
import type { AuthoringCatalogDto } from "../_lib/authoring-client";
import type { RowColumn } from "../_lib/descriptors";

/**
 * PRE-M7-WO1 guided inputs for uniform record lists, whole-number lists, true/false and an optional { feet } value.
 * Shape editors only: legality is decided by the M5 validation boundary. Every row keeps the stored keys it does not
 * show (a save is lossless), and nothing is ever typed as raw JSON.
 */
type Row = Record<string, unknown>;
const asRows = (v: unknown): Row[] => (Array.isArray(v) ? v.map((x) => (x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Row) : {})) : []);
const emptyCell = (c: RowColumn): unknown => (c.type === "integer" ? null : c.type === "boolean" ? false : "");

export function RowsEditor({ value, onChange, columns, itemLabel, label, catalog }: { value: unknown; onChange: (v: Row[]) => void; columns: readonly RowColumn[]; itemLabel: string; label: string; catalog: AuthoringCatalogDto }) {
  const base = useId();
  const rows = asRows(value);
  const set = (i: number, key: string, v: unknown) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...rows];
    const [r] = next.splice(i, 1);
    next.splice(i + d, 0, r as Row);
    onChange(next);
  };
  return (
    <div className="prowess-table-scroll" data-testid="guided-rows">
      <table className="prowess-rule-table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th scope="col" key={c.key}>
                {c.label}
              </th>
            ))}
            <th scope="col">
              <span className="prowess-visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => {
                const id = `${base}-${i}-${c.key}`;
                const a11y = `${label} ${i + 1} ${c.label}`;
                const v = r[c.key];
                return (
                  <td key={c.key}>
                    {c.type === "boolean" ? (
                      <input id={id} aria-label={a11y} type="checkbox" checked={v === true} onChange={(e) => set(i, c.key, e.target.checked)} />
                    ) : c.type === "integer" ? (
                      <input id={id} aria-label={a11y} type="number" step={1} value={typeof v === "number" ? v : ""} onChange={(e) => set(i, c.key, e.target.value === "" ? null : Number(e.target.value))} className="prowess-rule-preview__num" />
                    ) : c.type === "select" ? (
                      <select id={id} aria-label={a11y} value={typeof v === "string" ? v : ""} onChange={(e) => set(i, c.key, e.target.value)}>
                        <option value="">Choose…</option>
                        {(catalog.vocabularies[c.vocabulary] ?? []).map((o) => (
                          <option key={o} value={o}>
                            {formatEnumLabel(o)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input id={id} aria-label={a11y} value={typeof v === "string" ? v : ""} onChange={(e) => set(i, c.key, e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))} autoComplete="off" spellCheck={false} />
                    )}
                  </td>
                );
              })}
              <td>
                <span className="gov-actions">
                  <button type="button" className="gov-link-button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${itemLabel} ${i + 1} up`}>
                    Up
                  </button>
                  <button type="button" className="gov-link-button" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${itemLabel} ${i + 1} down`}>
                    Down
                  </button>
                  <button type="button" className="gov-link-button" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove ${itemLabel} ${i + 1}`}>
                    Remove
                  </button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="gov-button" onClick={() => onChange([...rows, Object.fromEntries(columns.map((c) => [c.key, emptyCell(c)]))])}>
        Add a {itemLabel}
      </button>
    </div>
  );
}

/** Whole numbers typed as "1, 2, 3"; anything that is not a whole number is kept as typed text so validation names it. */
export function IntegerListInput({ id, value, onChange, describedBy }: { id: string; value: unknown; onChange: (v: unknown[]) => void; describedBy?: string }) {
  const list = Array.isArray(value) ? value : [];
  return (
    <input
      id={id}
      aria-describedby={describedBy}
      inputMode="numeric"
      value={list.join(", ")}
      onChange={(e) =>
        onChange(
          e.target.value
            .split(",")
            .map((x) => x.trim())
            .filter((x) => x !== "")
            .map((x) => (/^-?\d+$/.test(x) ? Number(x) : x)),
        )
      }
      autoComplete="off"
    />
  );
}

/** An optional { feet: n } value: empty → null (not yet decided). */
export function OptionalFeetInput({ id, value, onChange, describedBy }: { id: string; value: unknown; onChange: (v: unknown) => void; describedBy?: string }) {
  const feet = value !== null && typeof value === "object" && typeof (value as { feet?: unknown }).feet === "number" ? (value as { feet: number }).feet : null;
  return <input id={id} aria-describedby={describedBy} type="number" step={1} min={1} value={feet ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : { ...(value as object | null), feet: Number(e.target.value) })} />;
}
