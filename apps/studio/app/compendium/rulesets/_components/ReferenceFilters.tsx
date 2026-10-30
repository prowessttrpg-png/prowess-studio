"use client";

import { ENTITY_TYPES } from "@prowess/model";
import { formatEnumLabel } from "@prowess/ui";
import { useEffect, useState } from "react";
import { searchKeywords, type CatalogDto } from "../_lib/reference-client";
import { readableToken } from "../_lib/reference-urls";

/**
 * Rules Reference facets (PAS-10 M6-WO2): search, Definition kind, system family, branch, EntityType and Keyword (by
 * Keyword id, chosen from the Keyword vocabulary). Options come from the ONE M5-derived catalog the server publishes —
 * nothing here is a hand-written list. Filtering happens on the server; this component only edits URL state.
 */
export interface ReferenceFilterValue {
  search: string;
  kind: string;
  family: string;
  branch: string;
  entityType: string;
  keywordId: string;
  keywordLabel: string;
}

export const GENERIC_FACET = "GENERIC";

export function ReferenceFilters({ value, catalog, onChange }: { value: ReferenceFilterValue; catalog: CatalogDto | null; onChange: (next: ReferenceFilterValue) => void }) {
  const kinds = catalog?.kinds ?? [];
  const branches = [...new Set(kinds.map((k) => k.branch).filter((b): b is string => b !== null))].sort();
  const set = (patch: Partial<ReferenceFilterValue>) => onChange({ ...value, ...patch });
  return (
    <form className="gov-filters prowess-reference__filters" role="search" aria-label="Filter this Release" onSubmit={(e) => e.preventDefault()}>
      <label className="gov-field">
        <span>Search</span>
        <input type="search" value={value.search} placeholder="Name, alias or canonical key" onChange={(e) => set({ search: e.target.value })} />
      </label>
      <label className="gov-field">
        <span>Kind</span>
        <select value={value.kind} onChange={(e) => set({ kind: e.target.value })}>
          <option value="">Any kind</option>
          <option value={GENERIC_FACET}>Generic / non-Prowess Entity</option>
          {kinds.map((k) => (
            <option key={k.definitionKind} value={k.definitionKind}>
              {readableToken(k.definitionKind)}
            </option>
          ))}
        </select>
      </label>
      <label className="gov-field">
        <span>Family</span>
        <select value={value.family} onChange={(e) => set({ family: e.target.value })}>
          <option value="">Any family</option>
          {(catalog?.systemFamilies ?? []).map((f) => (
            <option key={f} value={f}>
              {readableToken(f)}
            </option>
          ))}
        </select>
      </label>
      <label className="gov-field">
        <span>Branch</span>
        <select value={value.branch} onChange={(e) => set({ branch: e.target.value })}>
          <option value="">Any branch</option>
          {branches.map((b) => (
            <option key={b} value={b}>
              {readableToken(b)}
            </option>
          ))}
        </select>
      </label>
      <label className="gov-field">
        <span>Entity type</span>
        <select value={value.entityType} onChange={(e) => set({ entityType: e.target.value })}>
          <option value="">Any Entity type</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {formatEnumLabel(t)}
            </option>
          ))}
        </select>
      </label>
      <KeywordFacet value={value} onChange={(keywordId, keywordLabel) => set({ keywordId, keywordLabel })} />
    </form>
  );
}

function KeywordFacet({ value, onChange }: { value: ReferenceFilterValue; onChange: (keywordId: string, keywordLabel: string) => void }) {
  const [term, setTerm] = useState("");
  const [options, setOptions] = useState<Array<{ id: string; canonicalKey: string; name: string }>>([]);
  useEffect(() => {
    if (term.trim() === "") return;
    let live = true;
    const t = setTimeout(() => {
      void searchKeywords(term).then(
        (rows) => live && setOptions(rows),
        () => live && setOptions([]),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [term]);
  if (value.keywordId) {
    return (
      <div className="gov-field">
        <span>Keyword</span>
        <span className="prowess-keyword-chip">
          {value.keywordLabel || value.keywordId}{" "}
          <button type="button" className="gov-link-button" aria-label={`Clear Keyword filter ${value.keywordLabel || value.keywordId}`} onClick={() => onChange("", "")}>
            ×
          </button>
        </span>
      </div>
    );
  }
  return (
    <div className="gov-field">
      <label>
        <span>Keyword</span>
        <input type="search" value={term} placeholder="Find a Keyword" onChange={(e) => setTerm(e.target.value)} />
      </label>
      {term.trim() !== "" && options.length > 0 ? (
        <ul className="gov-picker" aria-label="Keyword options">
          {options.map((k) => (
            <li key={k.id}>
              <button
                type="button"
                className="gov-link-button"
                onClick={() => {
                  setTerm("");
                  setOptions([]);
                  onChange(k.id, k.name);
                }}
              >
                {k.name} <code>{k.canonicalKey}</code>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
