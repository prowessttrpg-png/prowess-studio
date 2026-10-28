"use client";

import { useEffect, useId, useState } from "react";
import { AuthoringApiError, searchKeywords, type KeywordRowDto } from "../_lib/authoring-client";

/**
 * Searchable Keyword picker (PAS-10 M6-WO1 §21–22, §49). Offers only existing Keyword Definitions from the approved
 * vocabulary, through a bounded server search — no free-text Keyword creation and no preloaded full vocabulary.
 * `onPick` receives the chosen Keyword; the caller decides whether it stores the canonical key (Definition payload
 * Keywords) or the id (Entity / EntityVersion Keyword assignments) — two separate systems that are never merged.
 */
export function KeywordPicker({ label, exclude = [], onPick, disabled = false }: { label: string; exclude?: readonly string[]; onPick: (keyword: KeywordRowDto) => void; disabled?: boolean }) {
  const id = useId();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<KeywordRowDto[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (term.trim() === "") return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchKeywords(term.trim()).then(
        (r) => {
          if (!cancelled) {
            setResults(r);
            setError("");
          }
        },
        (e: unknown) => {
          if (!cancelled) setError(e instanceof AuthoringApiError ? e.message : "Keyword search failed.");
        },
      );
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  const visible = (term.trim() === "" ? [] : results).filter((k) => !exclude.includes(k.id) && !exclude.includes(k.canonicalKey));
  return (
    <div className="prowess-authoring__picker">
      <label className="gov-field" htmlFor={`${id}-kw`}>
        <span>{label}</span>
        <input id={`${id}-kw`} type="search" value={term} disabled={disabled} onChange={(e) => setTerm(e.target.value)} placeholder="Search Keywords by name or canonical key" autoComplete="off" />
      </label>
      {error ? <p className="gov-bad" role="alert">{error}</p> : null}
      {term.trim() !== "" && visible.length === 0 && error === "" ? <p className="gov-muted">No matching Keyword Definitions.</p> : null}
      {visible.length > 0 ? (
        <ul className="gov-list" aria-label={`${label} results`}>
          {visible.map((k) => (
            <li key={k.id}>
              <button
                type="button"
                className="gov-button"
                onClick={() => {
                  onPick(k);
                  setTerm("");
                }}
              >
                {k.name} — <code>{k.canonicalKey}</code>
                {k.deprecated ? " (deprecated)" : ""}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
