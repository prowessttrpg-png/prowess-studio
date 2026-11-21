"use client";

import { useEffect, useState } from "react";
import { listAuthoringOptions, type AuthoringOptionDto } from "../_lib/rules-client";
import type { ContentTokenOptions } from "../_lib/descriptors";

/**
 * RULES-WO1 — choose a Skill rank or a calculated value by name instead of typing its token. A stored token that is not
 * among the options (for example content not loaded here) is kept and shown, never silently replaced.
 */
export function ContentTokenSelect({ id, describedBy, value, onChange, options }: { id: string; describedBy?: string; value: unknown; onChange: (v: string) => void; options: ContentTokenOptions }) {
  const [items, setItems] = useState<AuthoringOptionDto[] | null>(null);
  useEffect(() => {
    let live = true;
    listAuthoringOptions(options).then(
      (r) => live && setItems(r),
      () => live && setItems([]),
    );
    return () => {
      live = false;
    };
  }, [options]);
  const current = typeof value === "string" ? value : "";
  const known = items?.some((i) => i.token === current) ?? false;
  return (
    <select id={id} aria-describedby={describedBy} value={current} onChange={(e) => onChange(e.target.value)} data-testid={`content-token-${options}`}>
      <option value="">{items === null ? "Loading…" : items.length === 0 ? "Nothing to choose from yet" : "Choose…"}</option>
      {current !== "" && !known ? <option value={current}>{current} (as stored)</option> : null}
      {(items ?? []).map((i) => (
        <option key={i.token} value={i.token}>
          {i.label}
        </option>
      ))}
    </select>
  );
}

/** RULES-WO1 Phase D: several entries chosen by name; each stored token is shown by its label and can be removed. */
export function ContentTokenList({ value, onChange, options, label }: { value: unknown; onChange: (v: string[]) => void; options: ContentTokenOptions; label: string }) {
  const [items, setItems] = useState<AuthoringOptionDto[] | null>(null);
  useEffect(() => {
    let live = true;
    listAuthoringOptions(options).then(
      (r) => live && setItems(r),
      () => live && setItems([]),
    );
    return () => {
      live = false;
    };
  }, [options]);
  const chosen = Array.isArray(value) ? (value.filter((v) => typeof v === "string") as string[]) : [];
  const labelOf = (t: string) => items?.find((i) => i.token === t)?.label ?? t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, " ");
  return (
    <div data-testid={`content-token-list-${options}`}>
      {chosen.length === 0 ? <p className="gov-muted">None chosen.</p> : null}
      <ul aria-label={`${label}: chosen`}>
        {chosen.map((t) => (
          <li key={t}>
            {labelOf(t)}{" "}
            <button type="button" className="gov-link-button" onClick={() => onChange(chosen.filter((x) => x !== t))} aria-label={`Remove ${labelOf(t)}`}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <select aria-label={`Add to ${label}`} value="" onChange={(e) => e.target.value !== "" && onChange([...chosen, e.target.value])}>
        <option value="">{items === null ? "Loading…" : "Add…"}</option>
        {(items ?? []).filter((i) => !chosen.includes(i.token)).map((i) => (
          <option key={i.token} value={i.token}>
            {i.label}
          </option>
        ))}
      </select>
    </div>
  );
}
