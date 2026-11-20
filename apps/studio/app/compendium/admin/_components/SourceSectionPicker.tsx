"use client";

import { useEffect, useState } from "react";
import { lookupSourceSections, type SourceSectionLookupDto, type SourceSectionOptionDto } from "../_lib/rules-client";

/**
 * RULES-WO1 — the readable source picker. Authors search rulebook section TITLES of the imported snapshot and add them;
 * chosen sections are shown by title. The stored value is still the M5 source `{ locators, conflicts, … }` (section keys
 * and source-conflict keys), which the server validates; the keys are only visible under "Section keys" for review or
 * for a workspace that has no imported rulebook. Other fields of the source object are copied through unchanged.
 */
type Source = Record<string, unknown>;
const listOf = (src: Source, k: string) => (Array.isArray(src[k]) ? (src[k] as string[]) : []);

export function SourceSectionPicker({ value, onChange, extraListFields = [] }: { value: unknown; onChange: (v: Source) => void; extraListFields?: ReadonlyArray<{ key: string; label: string }> }) {
  const src: Source = value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Source) : { locators: [], conflicts: [] };
  const locators = listOf(src, "locators");
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<SourceSectionLookupDto | null>(null);
  const [failed, setFailed] = useState(false);
  const locatorsKey = locators.join(",");

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      lookupSourceSections(query, locatorsKey === "" ? [] : locatorsKey.split(",")).then(
        (r) => live && (setLookup(r), setFailed(false)),
        () => live && setFailed(true),
      );
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, locatorsKey]);

  const titleOf = (l: string): SourceSectionOptionDto | undefined => lookup?.known.find((k) => k.locator === l);
  const setList = (k: string, items: string[]) => onChange({ ...src, [k]: items });

  return (
    <div className="prowess-source-picker" data-testid="source-picker">
      {locators.length === 0 ? (
        <p className="gov-muted">No rulebook section chosen yet.</p>
      ) : (
        <ul aria-label="Chosen rulebook sections" data-testid="source-chosen">
          {locators.map((l) => {
            const s = titleOf(l);
            return (
              <li key={l}>
                {s ? (
                  <>
                    <strong>{s.title}</strong>
                    {s.parentTitle ? <span className="gov-muted"> — in {s.parentTitle}</span> : null}
                  </>
                ) : (
                  <span className="gov-muted">Section not found in the imported rulebook</span>
                )}{" "}
                <button type="button" className="gov-link-button" onClick={() => setList("locators", locators.filter((x) => x !== l))} aria-label={`Remove ${s?.title ?? "this section"}`}>
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {lookup !== null && lookup.snapshot === null ? (
        <p className="gov-muted" data-testid="source-no-snapshot">
          No rulebook is imported in this workspace, so sections cannot be searched by title. You can still enter section keys below.
        </p>
      ) : (
        <label className="gov-field">
          <span>Find a rulebook section by its title</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="For example: Armor, Concentration, Athletics" data-testid="source-search" />
        </label>
      )}
      {failed ? <p className="gov-bad">The rulebook sections could not be loaded.</p> : null}
      {query.trim() !== "" && lookup !== null && lookup.snapshot !== null ? (
        lookup.matches.length === 0 ? (
          <p className="gov-muted">No section title contains “{query}”.</p>
        ) : (
          <ul aria-label="Matching rulebook sections" data-testid="source-matches">
            {lookup.matches.map((m) => (
              <li key={m.locator}>
                {m.title}
                {m.parentTitle ? <span className="gov-muted"> — in {m.parentTitle}</span> : null}{" "}
                <button type="button" className="gov-link-button" disabled={locators.includes(m.locator)} onClick={() => setList("locators", [...locators, m.locator])} aria-label={`Add ${m.title}`}>
                  {locators.includes(m.locator) ? "Added" : "Add"}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
      <details>
        <summary>Section keys (advanced)</summary>
        <label className="gov-field">
          <span>Source sections chosen (section keys, filled in by the search above)</span>
          <input value={locators.join(", ")} onChange={(e) => setList("locators", e.target.value.split(",").map((x) => x.trim()).filter((x) => x !== ""))} autoComplete="off" spellCheck={false} />
        </label>
        <label className="gov-field">
          <span>Source-conflict keys (optional)</span>
          <input value={listOf(src, "conflicts").join(", ")} onChange={(e) => setList("conflicts", e.target.value.split(",").map((x) => x.trim()).filter((x) => x !== ""))} autoComplete="off" spellCheck={false} />
        </label>
        {extraListFields.map((f) => (
          <label key={f.key} className="gov-field">
            <span>{f.label}</span>
            <input value={listOf(src, f.key).join(", ")} onChange={(e) => setList(f.key, e.target.value.split(",").map((x) => x.trim()).filter((x) => x !== ""))} autoComplete="off" spellCheck={false} />
          </label>
        ))}
      </details>
    </div>
  );
}
