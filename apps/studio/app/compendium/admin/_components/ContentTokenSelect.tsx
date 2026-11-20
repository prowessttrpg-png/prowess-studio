"use client";

import { useEffect, useState } from "react";
import { listAuthoringOptions, type AuthoringOptionDto } from "../_lib/rules-client";

/**
 * RULES-WO1 — choose a Skill rank or a calculated value by name instead of typing its token. A stored token that is not
 * among the options (for example content not loaded here) is kept and shown, never silently replaced.
 */
export function ContentTokenSelect({ id, describedBy, value, onChange, options }: { id: string; describedBy?: string; value: unknown; onChange: (v: string) => void; options: "skillRanks" | "calculatedValues" }) {
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
