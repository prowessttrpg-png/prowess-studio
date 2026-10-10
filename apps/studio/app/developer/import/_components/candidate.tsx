"use client";

import type { ReactNode } from "react";
import type { ExtractionCandidateDto } from "../../../../src/api-client";
import { formatDate } from "../_lib/presentation";
import { BoundaryNote, CandidateStatusBadge, ConfidenceBadge, KindBadge, TechnicalDetails } from "./common";

/**
 * Readable Candidate detail (PAS-10 M3-WO8 §27–§31): structured fields per payload schema, raw payload behind a
 * developer disclosure. Nothing is calculated, resolved or interpreted — formulas are text, terms stay unresolved.
 */
const str = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "—" : JSON.stringify(v));
const list = (v: unknown) => (Array.isArray(v) && v.length > 0 ? v.map(String).join(", ") : "—");

function Rows({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="imp-fields">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function FormulaView({ payload }: { payload: Record<string, unknown> }) {
  const qualifiers = Array.isArray(payload.qualifiers) ? (payload.qualifiers as string[]) : [];
  return (
    <section aria-label="Formula" data-testid="formula-view">
      <h4>Formula</h4>
      <Rows
        rows={[
          ["Left side", str(payload.leftHandText)],
          ["Expression", <code key="e">{str(payload.expressionText)}</code>],
          ["Qualifier", qualifiers.length > 0 ? qualifiers.join(", ") : "—"],
          ["Unresolved source terms", list(payload.terms)],
          ["Functions", list(payload.functions)],
          ["Form", str(payload.sourceForm)],
        ]}
      />
      <BoundaryNote>Source terms remain unresolved. The formula is not evaluated or executed.</BoundaryNote>
    </section>
  );
}

export function RequirementView({ payload }: { payload: Record<string, unknown> }) {
  return (
    <section aria-label="Requirement" data-testid="requirement-view">
      <h4>Requirement</h4>
      <Rows
        rows={[
          ["Marker", str(payload.marker)],
          ["Authored text", str(payload.rawRequirementText)],
          ["Unresolved source terms", list(payload.terms)],
          ["Clause", `${Number(payload.clauseIndex ?? 0) + 1} of ${str(payload.clauseCount)}`],
          ["Negated", payload.negated === true ? "yes" : "no"],
        ]}
      />
      <BoundaryNote>Terms are unresolved source text — no Affinity, Rank or Requirement definition is resolved or created.</BoundaryNote>
    </section>
  );
}

export function KeywordView({ payload }: { payload: Record<string, unknown> }) {
  return (
    <section aria-label="Keyword" data-testid="keyword-view">
      <h4>Keyword</h4>
      <Rows
        rows={[
          ["Authored label", str(payload.authoredLabel)],
          ["Normalized review label", str(payload.normalizedLabel)],
          ["Source declaration", str(payload.declarationLabel)],
        ]}
      />
      <BoundaryNote>Extracted Keyword evidence does not grant mechanics.</BoundaryNote>
    </section>
  );
}

export function StructuralView({ payload }: { payload: Record<string, unknown> }) {
  const rows: Array<[string, ReactNode]> = Object.entries(payload)
    .filter(([k]) => !/Id$/.test(k))
    .map(([k, v]) => [k.replace(/([A-Z])/g, " $1").toLowerCase(), str(v)]);
  return (
    <section aria-label="Structural unit" data-testid="structural-view">
      <h4>Structural unit</h4>
      <Rows rows={rows} />
      <BoundaryNote>A structural unit marks where source content is. It is review infrastructure, not a finished rule.</BoundaryNote>
    </section>
  );
}

export function EntityIdentityView({ candidate }: { candidate: ExtractionCandidateDto }) {
  return (
    <section aria-label="Proposed identity" data-testid="entity-view">
      <h4>Proposed identity</h4>
      <Rows
        rows={[
          ["Proposed Entity type", str(candidate.proposedEntityType)],
          ["Proposed canonical key", str(candidate.proposedCanonicalKey)],
          ["Payload", <code key="p">{JSON.stringify(candidate.payload)}</code>],
        ]}
      />
      <BoundaryNote>A proposal only — no Entity exists or is created because of this Candidate.</BoundaryNote>
    </section>
  );
}

export function PayloadView({ candidate }: { candidate: ExtractionCandidateDto }) {
  const key = candidate.payloadSchemaKey;
  if (key === "prowess.semantic.formula") return <FormulaView payload={candidate.payload} />;
  if (key === "prowess.semantic.requirement") return <RequirementView payload={candidate.payload} />;
  if (key === "prowess.semantic.keyword") return <KeywordView payload={candidate.payload} />;
  if (key.startsWith("prowess.structural.")) return <StructuralView payload={candidate.payload} />;
  if (candidate.candidateKind === "ENTITY" || candidate.candidateKind === "ENTITY_FIELD") return <EntityIdentityView candidate={candidate} />;
  return <StructuralView payload={candidate.payload} />;
}

/** Candidate header + structured payload + developer details. */
export function CandidateDetail({ candidate }: { candidate: ExtractionCandidateDto }) {
  return (
    <section aria-labelledby="candidate-detail-heading" data-testid="candidate-detail" data-candidate-id={candidate.id}>
      <h3 id="candidate-detail-heading">
        #{candidate.ordinal} {candidate.displayLabel}
      </h3>
      <p className="imp-badges">
        <KindBadge kind={candidate.candidateKind} /> <ConfidenceBadge confidence={candidate.confidence} /> <CandidateStatusBadge status={candidate.status} />
      </p>
      {candidate.summary ? <p>{candidate.summary}</p> : null}
      <PayloadView candidate={candidate} />
      <TechnicalDetails
        rows={[
          ["Candidate id", candidate.id],
          ["Candidate fingerprint", candidate.candidateFingerprint],
          ["Payload schema", `${candidate.payloadSchemaKey} v${candidate.payloadSchemaVersion}`],
          ["Created", formatDate(candidate.createdAt)],
        ]}
      />
      <details className="imp-technical">
        <summary>Raw payload</summary>
        <pre data-testid="raw-payload">{JSON.stringify(candidate.payload, null, 2)}</pre>
      </details>
    </section>
  );
}
