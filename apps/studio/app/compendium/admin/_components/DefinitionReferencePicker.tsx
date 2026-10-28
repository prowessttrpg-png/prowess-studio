"use client";

import { useEffect, useId, useState } from "react";
import { AuthoringApiError, searchDefinitionReferences, type DefinitionReferenceDto } from "../_lib/authoring-client";
import { STATUS_LABELS } from "../_lib/definition-form";

/**
 * Exact Definition reference picker (PAS-10 M6-WO1 §30, §49–50). The author searches by human-facing discovery fields
 * (display name, alias, exact canonical key) through a bounded server search; each result is ONE exact revision, and
 * choosing it hands back the full exact reference `{ entityId, entityVersionId, canonicalKey, definitionKind,
 * systemFamily }` — never a name, never "latest".
 */
export function DefinitionReferencePicker({
  label,
  definitionKind,
  onSelect,
  onCancel,
}: {
  label: string;
  definitionKind?: string;
  onSelect: (ref: DefinitionReferenceDto["ref"]) => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<DefinitionReferenceDto[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (term.trim().length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setState("loading");
      searchDefinitionReferences(term.trim(), definitionKind).then(
        (r) => {
          if (cancelled) return;
          setResults(r);
          setState("idle");
        },
        (e: unknown) => {
          if (cancelled) return;
          setMessage(e instanceof AuthoringApiError ? e.message : "Search failed.");
          setState("error");
        },
      );
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term, definitionKind]);

  const shown = term.trim().length < 2 ? [] : results;
  return (
    <div className="prowess-authoring__picker" role="group" aria-label={label}>
      <label className="gov-field" htmlFor={`${id}-search`}>
        <span>{label}</span>
        <input id={`${id}-search`} type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search by name, alias or canonical key" autoComplete="off" />
      </label>
      {state === "loading" ? <p className="gov-muted" role="status">Searching…</p> : null}
      {state === "error" ? <p className="gov-bad" role="alert">{message}</p> : null}
      {term.trim().length >= 2 && state === "idle" && shown.length === 0 ? <p className="gov-muted">No matching Definitions{definitionKind ? ` of kind ${definitionKind}` : ""}.</p> : null}
      {shown.length > 0 ? (
        <ul className="gov-list" aria-label={`${label} results`}>
          {shown.map((r) => (
            <li key={r.ref.entityVersionId}>
              <button type="button" className="gov-button" onClick={() => onSelect(r.ref)}>
                {r.displayName} — <code>{r.ref.canonicalKey}</code> · {r.ref.definitionKind} · Revision {r.revisionNumber} ({STATUS_LABELS[r.status] ?? r.status})
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {onCancel ? (
        <button type="button" className="gov-link-button" onClick={onCancel}>
          Cancel
        </button>
      ) : null}
    </div>
  );
}
