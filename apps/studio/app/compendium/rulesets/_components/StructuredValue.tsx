"use client";

import type { ReactNode } from "react";
import { isToken, readableKey, readableToken } from "../_lib/reference-urls";

/**
 * Read-only structured rendering of authored data (PAS-10 M6-WO2). Shows stored values EXACTLY — tokens as readable
 * words with the exact token beside them, formulas as their authored expression (never evaluated), requirement groups
 * as nested lists, exact Definition references through the caller's link renderer — and computes nothing. Raw JSON is
 * never the primary view; it lives only under Developer details.
 */
export interface StructuredContext {
  /** Renders an exact Definition reference found at `path` (keeps the Release context). */
  renderReference?: (path: string) => ReactNode | null;
}

const MAX_DEPTH = 14;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function TokenText({ value }: { value: string }) {
  if (!isToken(value)) return <span>{value}</span>;
  return (
    <span className="prowess-reference__token">
      {readableToken(value)} <code>{value}</code>
    </span>
  );
}

export function StructuredValue({ value, path = "payload", context = {}, depth = 0 }: { value: unknown; path?: string; context?: StructuredContext; depth?: number }) {
  if (depth > MAX_DEPTH) return <span className="gov-muted">(nested further — see Developer details)</span>;
  const ref = context.renderReference?.(path);
  if (ref !== undefined && ref !== null) return <>{ref}</>;
  if (value === null || value === undefined) return <span className="gov-muted">—</span>;
  if (typeof value === "string") return value === "" ? <span className="gov-muted">(empty)</span> : <TokenText value={value} />;
  if (typeof value === "number" || typeof value === "boolean") return <span className="prowess-reference__literal">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="gov-muted">none</span>;
    if (value.every((v) => typeof v === "string" || typeof v === "number")) {
      return (
        <span className="prowess-reference__inline-list">
          {value.map((v, i) => (
            <span key={i}>
              {typeof v === "string" ? <TokenText value={v} /> : String(v)}
              {i < value.length - 1 ? ", " : ""}
            </span>
          ))}
        </span>
      );
    }
    return (
      <ol className="prowess-reference__list">
        {value.map((v, i) => (
          <li key={i}>
            <StructuredValue value={v} path={`${path}[${i}]`} context={context} depth={depth + 1} />
          </li>
        ))}
      </ol>
    );
  }
  if (!isRecord(value)) return <span>{String(value)}</span>;
  // An authored formula: its expression exactly as written. The Rules Engine evaluates it; this page never does.
  if (typeof value.expression === "string") {
    const rest = Object.entries(value).filter(([k]) => k !== "expression");
    return (
      <div className="prowess-reference__formula">
        <span className="gov-eyebrow">Formula (authored — not evaluated here)</span> <code>{value.expression}</code>
        {rest.length > 0 ? <Fields entries={rest} path={path} context={context} depth={depth} /> : null}
      </div>
    );
  }
  // A requirement group (ALL / ANY / NONE of children): a structured access requirement, shown as authored.
  if (typeof value.kind === "string" && Array.isArray(value.children)) {
    return (
      <div className="prowess-reference__requirement">
        <p>
          <TokenText value={value.kind} /> of:
        </p>
        <StructuredValue value={value.children} path={`${path}.children`} context={context} depth={depth + 1} />
      </div>
    );
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return <span className="gov-muted">none</span>;
  return <Fields entries={entries} path={path} context={context} depth={depth} />;
}

function Fields({ entries, path, context, depth }: { entries: Array<[string, unknown]>; path: string; context: StructuredContext; depth: number }) {
  return (
    <dl className="gov-dl prowess-reference__fields">
      {entries.map(([k, v]) => (
        <div key={k} className="prowess-reference__field">
          <dt title={k}>{readableKey(k)}</dt>
          <dd>
            <StructuredValue value={v} path={`${path}.${k}`} context={context} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
