"use client";

import { useId, useState } from "react";
import { isExactReference } from "../_lib/definition-form";
import { DefinitionReferencePicker } from "./DefinitionReferencePicker";

/**
 * Structured editor for M5's OPAQUE authored-data objects — `parameters`, `rules`, `geometry`, outcome / resolution /
 * cost `data`, `tradeoff` … (PAS-10 M6-WO1 §12, §28). Each entry is a named field with an explicit type (text, number,
 * true/false, list, group, exact Definition reference), edited with real form controls — never a raw JSON text box.
 *
 * It is a SHAPE editor only: it does not know or check what an M5 sub-contract requires; the M5 validation boundary
 * reports that, with a path pointing back here. A "Definition reference" value is chosen with the reference picker and
 * saved as the exact five-field identity — never a display name (§30, §50).
 */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type ValueType = "text" | "number" | "boolean" | "list" | "group" | "reference";

const TYPE_LABELS: Record<ValueType, string> = { text: "Text", number: "Number", boolean: "True / false", list: "List", group: "Group of fields", reference: "Definition reference" };
const MAX_DEPTH = 8;

function typeOf(value: unknown): ValueType {
  // `null` only arises here as a Definition reference still to be chosen.
  if (value === null || isExactReference(value)) return "reference";
  if (Array.isArray(value)) return "list";
  if (value !== null && typeof value === "object") return "group";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "text";
}

function emptyOf(type: ValueType): Json {
  switch (type) {
    case "text":
      return "";
    case "number":
      return 0;
    case "boolean":
      return false;
    case "list":
      return [];
    case "group":
      return {};
    case "reference":
      return null;
  }
}

function ValueEditor({ value, onChange, id, label, depth }: { value: Json; onChange: (v: Json) => void; id: string; label: string; depth: number }) {
  const type = typeOf(value);
  const [picking, setPicking] = useState(false);
  if (value === null) {
    return (
      <div className="prowess-authoring__reference">
        <span className="gov-muted">No Definition chosen.</span>
        {picking ? (
          <DefinitionReferencePicker label={`${label}: choose Definition`} onSelect={(ref) => { onChange(ref as unknown as Json); setPicking(false); }} onCancel={() => setPicking(false)} />
        ) : (
          <button type="button" className="gov-button" onClick={() => setPicking(true)} aria-label={`${label}: choose Definition`}>
            Choose Definition…
          </button>
        )}
      </div>
    );
  }
  switch (type) {
    case "text":
      return <input id={id} aria-label={label} value={value as string} onChange={(e) => onChange(e.target.value)} />;
    case "number":
      return (
        <input
          id={id}
          aria-label={label}
          type="number"
          step="any"
          value={String(value)}
          onChange={(e) => {
            const n = e.target.value.trim() === "" ? 0 : Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
        />
      );
    case "boolean":
      return (
        <label className="prowess-authoring__inline">
          <input id={id} type="checkbox" checked={value as boolean} onChange={(e) => onChange(e.target.checked)} /> {label}
        </label>
      );
    case "reference": {
      const ref = value as unknown as { canonicalKey: string; definitionKind: string; entityVersionId: string };
      return (
        <div className="prowess-authoring__reference">
          <span>
            <code>{ref.canonicalKey}</code> · {ref.definitionKind} · exact revision <code className="gov-id">{ref.entityVersionId}</code>
          </span>
          {picking ? (
            <DefinitionReferencePicker label={`${label}: change Definition`} onSelect={(r) => { onChange(r as unknown as Json); setPicking(false); }} onCancel={() => setPicking(false)} />
          ) : (
            <button type="button" className="gov-button" onClick={() => setPicking(true)} aria-label={`${label}: change Definition`}>
              Change…
            </button>
          )}
        </div>
      );
    }
    case "list":
      return <ListEditor items={value as Json[]} onChange={onChange} label={label} depth={depth + 1} />;
    case "group":
      return <GroupEditor value={value as { [key: string]: Json }} onChange={onChange} label={label} depth={depth + 1} />;
  }
}

function TypeSelect({ value, onChange, label, depth }: { value: ValueType; onChange: (t: ValueType) => void; label: string; depth: number }) {
  return (
    <select aria-label={`${label} type`} value={value} onChange={(e) => onChange(e.target.value as ValueType)}>
      {(Object.keys(TYPE_LABELS) as ValueType[])
        .filter((t) => depth < MAX_DEPTH || (t !== "group" && t !== "list"))
        .map((t) => (
          <option key={t} value={t}>
            {TYPE_LABELS[t]}
          </option>
        ))}
    </select>
  );
}

function ListEditor({ items, onChange, label, depth }: { items: Json[]; onChange: (v: Json) => void; label: string; depth: number }) {
  const base = useId();
  const set = (i: number, v: Json) => onChange(items.map((x, j) => (j === i ? v : x)));
  return (
    <div className="prowess-authoring__data-list">
      {items.length === 0 ? <p className="gov-muted">Empty list.</p> : null}
      <ol>
        {items.map((item, i) => (
          <li key={i} className="prowess-authoring__data-row">
            <TypeSelect value={typeOf(item)} onChange={(t) => set(i, emptyOf(t))} label={`${label} item ${i + 1}`} depth={depth} />
            <ValueEditor value={item} onChange={(v) => set(i, v)} id={`${base}-${i}`} label={`${label} item ${i + 1}`} depth={depth} />
            <button type="button" className="gov-button" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remove ${label} item ${i + 1}`}>
              Remove
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="gov-button" onClick={() => onChange([...items, ""])} aria-label={`Add item to ${label}`}>
        Add item
      </button>
    </div>
  );
}

function GroupEditor({ value, onChange, label, depth }: { value: { [key: string]: Json }; onChange: (v: Json) => void; label: string; depth: number }) {
  const base = useId();
  const entries = Object.entries(value);
  const rebuild = (next: Array<[string, Json]>) => onChange(Object.fromEntries(next));
  const freeName = () => {
    let i = entries.length + 1;
    while (`field${i}` in value) i += 1;
    return `field${i}`;
  };
  return (
    <div className="prowess-authoring__data-group">
      {entries.length === 0 ? <p className="gov-muted">No fields.</p> : null}
      <ul>
        {entries.map(([k, v], i) => (
          <li key={i} className="prowess-authoring__data-row">
            <input
              aria-label={`${label}: field name ${i + 1}`}
              value={k}
              onChange={(e) => {
                const name = e.target.value;
                if (name !== k && name in value) return;
                rebuild(entries.map(([kk, vv], j) => (j === i ? [name, vv] : [kk, vv])));
              }}
            />
            <TypeSelect value={typeOf(v)} onChange={(t) => rebuild(entries.map(([kk, vv], j) => (j === i ? [kk, emptyOf(t)] : [kk, vv])))} label={`${label}.${k}`} depth={depth} />
            <ValueEditor value={v} onChange={(nv) => rebuild(entries.map(([kk, vv], j) => (j === i ? [kk, nv] : [kk, vv])))} id={`${base}-${i}`} label={`${label}.${k}`} depth={depth} />
            <button type="button" className="gov-button" onClick={() => rebuild(entries.filter((_, j) => j !== i))} aria-label={`Remove ${label}.${k}`}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="gov-button" onClick={() => rebuild([...entries, [freeName(), ""]])} aria-label={`Add field to ${label}`}>
        Add field
      </button>
    </div>
  );
}

/** The public editor: one authored-data object (a group of named, typed fields). */
export function AuthoredDataEditor({ value, onChange, label }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; label: string }) {
  const safe = value !== null && typeof value === "object" && !Array.isArray(value) ? (value as { [key: string]: Json }) : {};
  return <GroupEditor value={safe} onChange={(v) => onChange(v as Record<string, unknown>)} label={label} depth={0} />;
}
