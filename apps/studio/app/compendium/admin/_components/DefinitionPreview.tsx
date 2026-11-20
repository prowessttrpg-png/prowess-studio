"use client";

import { VersionStatusBadge } from "@prowess/ui";
import type { ValidationResultDto } from "../_lib/authoring-client";
import type { DefinitionCandidate } from "../_lib/definition-form";
import type { FieldDescriptor } from "../_lib/descriptors";

/**
 * Definition Preview (PAS-10 M6-WO1 §27, §63): how the content reads in the Compendium — name, kind, Keywords,
 * description, Rules Text, a structured mechanical SUMMARY of the authored payload, status, revision and provenance.
 * Presentation only: it lists the structured fields as authored (or as M5 normalized them, when the last server
 * validation passed); it computes nothing, compiles nothing and saves nothing.
 */
export interface PreviewContent {
  displayName: string;
  shortDescription: string;
  rulesText: string;
  status: string | null;
  revisionNumber: number | null;
  sources: Array<{ title: string; sectionLabel: string | null; pageReference: string | null }>;
}

/** A stored field name in words ("armorValue" → "Armor value"): the preview never shows payload keys (RULES-WO1). */
export function fieldWords(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function summarize(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value === "" ? "—" : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length === 0 ? "none" : `${value.length} item(s)`;
  const keys = Object.keys(value);
  return keys.length === 0 ? "none" : `${keys.length} part(s): ${keys.map(fieldWords).join(", ")}`;
}

export function DefinitionPreview({ content, candidate, validation, fields = [] }: { content: PreviewContent; candidate: DefinitionCandidate | null; validation: ValidationResultDto | null; fields?: readonly FieldDescriptor[] }) {
  const labelOf = (key: string) => fields.find((f) => f.key === key)?.label ?? fieldWords(key);
  const payload = validation?.status === "PASS" && validation.normalized !== null ? validation.normalized.payload : (candidate?.payload ?? null);
  const keywords = payload !== null && Array.isArray(payload.keywords) ? (payload.keywords as string[]) : [];
  return (
    <article className="prowess-authoring__preview gov-card" aria-label="Definition preview">
      <p className="gov-eyebrow">Preview — how this content appears in the Compendium (nothing is saved)</p>
      <h3>{content.displayName || "Untitled Definition"}</h3>
      <p className="gov-meta">
        {candidate ? <span className="gov-badge">{candidate.definitionKind}</span> : <span className="gov-badge">Generic / non-Prowess Entity</span>}
        {content.status ? <VersionStatusBadge status={content.status} /> : <span className="gov-tag">Not saved yet</span>}
        {content.revisionNumber !== null ? <span className="gov-tag">Revision {content.revisionNumber}</span> : null}
        {validation ? <span className="gov-tag">Validation: {validation.status}</span> : null}
      </p>
      {keywords.length > 0 ? (
        <p>
          Keywords:{" "}
          {keywords.map((k) => (
            <code key={k} className="prowess-keyword-chip">
              {k}
            </code>
          ))}
        </p>
      ) : null}
      {content.shortDescription ? <p>{content.shortDescription}</p> : null}
      {content.rulesText ? (
        <section aria-label="Rules Text">
          <h4>Rules Text</h4>
          <p className="prowess-detail-fields__rules-text">{content.rulesText}</p>
        </section>
      ) : null}
      {payload !== null ? (
        <section aria-label="Structured mechanical summary">
          <h4>Structured Definition</h4>
          <dl className="gov-dl">
            {Object.entries(payload)
              .filter(([k]) => k !== "keywords")
              .map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <dt>{labelOf(k)}</dt>
                  <dd>{summarize(v)}</dd>
                </div>
              ))}
          </dl>
        </section>
      ) : null}
      {content.sources.length > 0 ? (
        <section aria-label="Provenance">
          <h4>Sources</h4>
          <ul>
            {content.sources.map((s, i) => (
              <li key={i}>
                {s.title}
                {s.sectionLabel ? ` — ${s.sectionLabel}` : ""}
                {s.pageReference ? ` (${s.pageReference})` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
