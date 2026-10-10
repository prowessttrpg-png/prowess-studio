"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { ImportDecisionType } from "@prowess/model";
import {
  GovernanceApiError,
  getCandidate,
  getCandidateAssessment,
  listConflictSignals,
  listDuplicateGroups,
  listSectionContents,
  submitDecision,
  type ExtractionCandidateDto,
  type ConflictSignalDto,
  type DecisionRequest,
  type DuplicateGroupDto,
  type ImportBatchDto,
  type ImportDecisionDto,
  type MatchAssessmentDto,
  type MatchRunDto,
  type ReviewSummaryDto,
  type SourceContentNodeDto,
  type SourceSectionDto,
} from "../../../../src/api-client";
import { EntityLabel, EntityPicker, VersionLabel } from "../../rulesets/_components/pickers";
import { ConfirmButton, EmptyNote, Field, Loading, useResource } from "../../rulesets/_components/primitives";
import {
  availableDecisions,
  candidateSectionId,
  CANDIDATE_STATUS_LABEL,
  CONFLICT_SIGNAL_HELP,
  CONFLICT_SIGNAL_LABEL,
  DECISION_LABEL,
  formatDate,
  MATCH_BASIS_LABEL,
  MATCH_OUTCOME_LABEL,
  REVIEWABLE_BATCH,
  reviewProgress,
  sectionPath,
} from "../_lib/presentation";
import { BoundaryNote, ImportError, TechnicalDetails } from "./common";
import { HighlightedText, SourceNodeView } from "./source";

const num = (v: unknown) => (typeof v === "number" ? v : null);

// ---------------------------------------------------------------------------------------------------------------
// Source evidence
// ---------------------------------------------------------------------------------------------------------------

/** "Where in the source did this Candidate come from?" — exact anchors, verbatim excerpts, a link into the source. */
export function SourceEvidence({ candidate, sections, snapshotId }: { candidate: ExtractionCandidateDto; sections: readonly SourceSectionDto[]; snapshotId: string }) {
  const sectionId = candidateSectionId(candidate, sections);
  const nodeId = candidate.primarySourceContentNodeId;
  const p = candidate.payload;
  const loaded = useResource<SourceContentNodeDto | "missing">(async () => {
    if (!sectionId || !nodeId) return "missing";
    for (let page = 1; page <= 20; page += 1) {
      const { items, pagination } = await listSectionContents(sectionId, { page, pageSize: 100 });
      const hit = items.find((n) => n.id === nodeId);
      if (hit) return hit;
      if (!pagination || page >= pagination.totalPages) return "missing";
    }
    return "missing";
  }, [sectionId, nodeId]);
  const node = loaded.error !== undefined ? "missing" : (loaded.data ?? null);
  const params = new URLSearchParams();
  if (sectionId) params.set("section", sectionId);
  if (nodeId) params.set("node", nodeId);
  for (const [k, v] of [["start", num(p.startOffset)], ["end", num(p.endOffset)], ["row", num(p.rowIndex)], ["col", num(p.columnIndex)]] as const) if (v !== null) params.set(k, String(v));
  return (
    <section aria-label="Source evidence" className="imp-evidence" data-testid="source-evidence">
      <h4>Source Evidence</h4>
      <p>
        <span className="gov-muted">Section:</span> {sectionPath(sectionId, sections) ?? "Document content outside any section"}
      </p>
      {typeof p.rowIndex === "number" ? (
        <p data-testid="table-cell-ref">
          Table cell — row {p.rowIndex}, column {String(p.columnIndex)}, header “{String(p.headerText)}”
        </p>
      ) : null}
      {node === null ? <Loading label="Loading source evidence…" /> : null}
      {node !== null && node !== "missing" ? (
        <SourceNodeView node={node} highlight={{ nodeId: node.id, start: num(p.startOffset), end: num(p.endOffset), row: num(p.rowIndex), column: num(p.columnIndex) }} />
      ) : null}
      {candidate.supportingSources.filter((s) => s.excerpt).map((s) => (
        <blockquote key={s.id} className="imp-excerpt" data-testid="evidence-excerpt">
          <HighlightedText text={s.excerpt as string} />
        </blockquote>
      ))}
      {candidate.supportingSources.length > 0 ? <p className="gov-muted">{candidate.supportingSources.length} supporting source anchor(s).</p> : null}
      <p>
        <Link href={`/developer/import/sources/${snapshotId}?${params.toString()}`} data-testid="view-in-source">
          View in Source
        </Link>
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------------------------

export function MatchRunSelector({ runs, selectedId, onSelect, onAnalyze, busy, readOnly }: { runs: MatchRunDto[]; selectedId: string | null; onSelect: (id: string | null) => void; onAnalyze: () => void; busy: boolean; readOnly: boolean }) {
  const id = useId();
  return (
    <section aria-label="Entity matching" className="imp-match-runs" data-testid="match-runs">
      <h4>Entity Matching</h4>
      {runs.length === 0 ? <p className="gov-muted">No MatchRuns yet. Matching never runs automatically.</p> : null}
      {runs.length > 0 ? (
        <Field label="Exact MatchRun reviewed" htmlFor={id} hint="Nothing is chosen for you as “latest”; the selected run is only a view setting.">
          <select id={id} value={selectedId ?? ""} onChange={(e) => onSelect(e.target.value || null)}>
            <option value="">— none selected —</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {formatDate(r.createdAt)} · {r.matcherKey}@{r.matcherVersion} · {r.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {!readOnly ? (
        <button type="button" className="gov-button" onClick={onAnalyze} disabled={busy} aria-busy={busy}>
          {busy ? "Analyzing…" : "Analyze Entity Matches"}
        </button>
      ) : null}
    </section>
  );
}

export function MatchAssessmentView({ assessment }: { assessment: MatchAssessmentDto }) {
  return (
    <section aria-label="Match assessment" data-testid="match-assessment" data-outcome={assessment.outcome}>
      <p>
        <strong data-testid="match-outcome">{MATCH_OUTCOME_LABEL[assessment.outcome] ?? assessment.outcome}</strong>
        {assessment.matchedEntityId ? (
          <>
            {" "}
            — <EntityLabel id={assessment.matchedEntityId} /> {MATCH_BASIS_LABEL[assessment.matchedBy] ?? assessment.matchedBy}
          </>
        ) : null}
      </p>
      {assessment.comparisonEntityVersionId ? (
        <p>
          Comparison Version: <VersionLabel id={assessment.comparisonEntityVersionId} /> <span className="gov-muted">(identity context only — content agreement is not implied)</span>
        </p>
      ) : null}
      {assessment.suggestions.length > 0 ? (
        <ol className="imp-suggestions" aria-label="Match suggestions" data-testid="match-suggestions">
          {assessment.suggestions.map((s) => (
            <li key={s.id} data-testid="match-suggestion">
              <EntityLabel id={s.entityId} /> · {MATCH_BASIS_LABEL[s.basis] ?? s.basis} · {s.score.toFixed(3)}
              {s.comparisonEntityVersionId ? (
                <>
                  {" "}
                  · <VersionLabel id={s.comparisonEntityVersionId} />
                </>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="gov-muted">No suggestions.</p>
      )}
      {assessment.outcome === "POTENTIAL_MATCH" ? <BoundaryNote>A suggestion is not an acceptance — nothing is chosen until you record a decision.</BoundaryNote> : null}
    </section>
  );
}

export function useAssessment(matchRunId: string | null, candidateId: string) {
  const [state, setState] = useState<{ key: string; data: MatchAssessmentDto | null; error?: unknown }>({ key: "", data: null });
  const key = `${matchRunId}:${candidateId}`;
  useEffect(() => {
    if (!matchRunId) return;
    let cancelled = false;
    getCandidateAssessment(matchRunId, candidateId).then(
      (data) => !cancelled && setState({ key, data }),
      (error: unknown) => !cancelled && setState({ key, data: null, error }),
    );
    return () => {
      cancelled = true;
    };
  }, [matchRunId, candidateId, key]);
  return matchRunId && state.key === key ? state : { key, data: null, loading: Boolean(matchRunId) };
}

// ---------------------------------------------------------------------------------------------------------------
// Duplicate groups and conflict evidence
// ---------------------------------------------------------------------------------------------------------------

export function useCandidateGroups(matchRunId: string | null, candidateId: string): DuplicateGroupDto[] {
  const [groups, setGroups] = useState<{ key: string; items: DuplicateGroupDto[] }>({ key: "", items: [] });
  const key = `${matchRunId}`;
  useEffect(() => {
    if (!matchRunId) return;
    let cancelled = false;
    listDuplicateGroups(matchRunId, { pageSize: 100 }).then(
      (r) => !cancelled && setGroups({ key, items: r.items }),
      () => !cancelled && setGroups({ key, items: [] }),
    );
    return () => {
      cancelled = true;
    };
  }, [matchRunId, key]);
  return groups.key === key ? groups.items.filter((g) => g.memberCandidateIds.includes(candidateId)) : [];
}

export function ConflictEvidence({ batchId, matchRunId, candidateId }: { batchId: string; matchRunId: string | null; candidateId: string }) {
  const [signals, setSignals] = useState<{ key: string; items: ConflictSignalDto[] }>({ key: "", items: [] });
  const [members, setMembers] = useState<Record<string, ExtractionCandidateDto>>({});
  const key = `${matchRunId}`;
  useEffect(() => {
    if (!matchRunId) return;
    let cancelled = false;
    listConflictSignals(batchId, matchRunId, { pageSize: 100 }).then(
      (r) => !cancelled && setSignals({ key, items: r.items }),
      () => !cancelled && setSignals({ key, items: [] }),
    );
    return () => {
      cancelled = true;
    };
  }, [batchId, matchRunId, key]);
  const mine = signals.key === key ? signals.items.filter((s) => s.candidateIds.includes(candidateId)) : [];
  const wanted = mine.flatMap((s) => s.candidateIds).filter((id) => !(id in members));
  useEffect(() => {
    if (wanted.length === 0) return;
    let cancelled = false;
    Promise.all(wanted.map((id) => getCandidate(id))).then(
      (cs) => !cancelled && setMembers((prev) => ({ ...prev, ...Object.fromEntries(cs.map((c) => [c.id, c])) })),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [wanted.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!matchRunId) return <p className="gov-muted">Select an exact MatchRun to see duplicate / conflict evidence.</p>;
  if (mine.length === 0) return <p className="gov-muted" data-testid="no-conflict-evidence">No duplicate or conflict evidence involves this Candidate in the selected MatchRun.</p>;
  return (
    <section aria-label="Conflict evidence" data-testid="conflict-evidence">
      {mine.map((s) => (
        <div key={s.duplicateGroupId} className="imp-conflict" data-signal={s.type}>
          <p>
            <strong data-testid="conflict-signal">{CONFLICT_SIGNAL_LABEL[s.type] ?? s.type}</strong> — potentially the same Entity identity
          </p>
          <p className="gov-muted">{CONFLICT_SIGNAL_HELP[s.type]}</p>
          <div className="imp-side-by-side" role="group" aria-label="Candidates compared">
            {s.candidateIds.map((id) => {
              const c = members[id];
              return (
                <div key={id} className="imp-side" aria-current={id === candidateId ? "true" : undefined}>
                  <p>
                    <strong>{c ? `#${c.ordinal} ${c.displayLabel}` : id.slice(0, 8)}</strong> {id === candidateId ? <span className="gov-muted">(this Candidate)</span> : null}
                  </p>
                  {c ? <pre className="imp-payload-summary">{JSON.stringify(c.payload, null, 1)}</pre> : <Loading />}
                </div>
              );
            })}
          </div>
          <BoundaryNote>No automatic winner. This is import evidence, not a Ruleset RuleConflict.</BoundaryNote>
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------------------------------------------

const NEEDS_FORM: readonly ImportDecisionType[] = ["CLASSIFY_MATCHED", "MARK_CONFLICT", "REJECT", "CLASSIFY_NEW_ENTITY", "MARK_NEEDS_MAPPING"];
const STALE_CODES = ["IMPORT_DECISION.DECISION_CONFLICT", "IMPORT_DECISION.INVALID_TRANSITION", "IMPORT_DECISION.INVALID_EVIDENCE"];

/** The Candidate's accepted MATCHED target: the most recent decision in its own history that moved it to MATCHED. */
function matchedTarget(history: readonly ImportDecisionDto[]): string | null {
  for (let i = history.length - 1; i >= 0; i -= 1) if (history[i]!.toStatus === "MATCHED") return history[i]!.targetEntityId;
  return null;
}

/** Builds exactly the decision command — never a server-controlled field. */
export function buildDecisionRequest(
  candidate: ExtractionCandidateDto,
  type: ImportDecisionType,
  f: { basis: string; target: string; rationale: string; groupId: string },
  ctx: { matchRunId: string | null; assessment: MatchAssessmentDto | null; history: readonly ImportDecisionDto[] },
): DecisionRequest {
  const body: DecisionRequest = { candidateFingerprint: candidate.candidateFingerprint, decisionType: type };
  if (f.rationale.trim() !== "") body.rationale = f.rationale;
  if (type === "CLASSIFY_MATCHED") {
    body.matchBasis = f.basis;
    body.targetEntityId = f.basis === "EXACT_MATCH" ? (ctx.assessment?.matchedEntityId ?? "") : f.target;
    if (ctx.matchRunId && ctx.assessment && f.basis !== "MANUAL_OVERRIDE") {
      body.matchRunId = ctx.matchRunId;
      body.matchAssessmentId = ctx.assessment.id;
      const version = f.basis === "EXACT_MATCH" ? ctx.assessment.comparisonEntityVersionId : (ctx.assessment.suggestions.find((s) => s.entityId === f.target)?.comparisonEntityVersionId ?? null);
      if (version) body.comparisonEntityVersionId = version;
    }
  }
  if (type === "APPROVE_MATCHED") body.targetEntityId = matchedTarget(ctx.history) ?? "";
  if (type === "MARK_CONFLICT" && f.groupId && ctx.matchRunId) {
    body.matchRunId = ctx.matchRunId;
    body.duplicateGroupId = f.groupId;
  }
  return body;
}

export function DecisionPanel({
  candidate,
  batch,
  matchRunId,
  assessment,
  groups,
  history,
  onRecorded,
  onStale,
}: {
  candidate: ExtractionCandidateDto;
  batch: ImportBatchDto;
  matchRunId: string | null;
  assessment: MatchAssessmentDto | null;
  groups: DuplicateGroupDto[];
  history: readonly ImportDecisionDto[];
  onRecorded: (decision: ImportDecisionDto, advance: boolean) => void;
  onStale: () => void;
}) {
  const formId = useId();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [type, setType] = useState<ImportDecisionType | null>(null);
  const [form, setForm] = useState({ basis: "", target: "", rationale: "", groupId: "" });
  const [advance, setAdvance] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!REVIEWABLE_BATCH(batch.status)) {
    return <p className="gov-muted" data-testid="read-only-note">Review actions are closed for this Batch ({batch.status === "COMPLETED" ? "Review Complete" : batch.status}).</p>;
  }
  const actions = availableDecisions(candidate.status, candidate.candidateKind);
  const reset = () => {
    setForm({ basis: "", target: "", rationale: "", groupId: "" });
    setClientError(null);
  };
  const submit = async (t: ImportDecisionType) => {
    setClientError(null);
    if (t === "CLASSIFY_MATCHED") {
      if (!form.basis) return setClientError("Choose what this match is based on.");
      if (form.basis === "EXACT_MATCH" && !(assessment?.outcome === "EXACT_MATCH")) return setClientError("The selected MatchRun has no exact match for this Candidate.");
      if (form.basis === "MANUAL_OVERRIDE" && form.rationale.trim() === "") return setClientError("A rationale is required for a manual override.");
      if (form.basis !== "EXACT_MATCH" && !form.target) return setClientError("Choose the target Entity.");
    }
    if (t === "REJECT" && form.rationale.trim() === "") return setClientError("A rationale is required to reject.");
    setBusy(true);
    setError(null);
    try {
      const { decision } = await submitDecision(candidate.id, buildDecisionRequest(candidate, t, form, { matchRunId, assessment, history }));
      setMessage(`Recorded: ${DECISION_LABEL[t]} — now ${CANDIDATE_STATUS_LABEL[decision.toStatus as keyof typeof CANDIDATE_STATUS_LABEL] ?? decision.toStatus}.`);
      setType(null);
      reset();
      onRecorded(decision, advance);
      setTimeout(() => statusRef.current?.focus(), 0);
    } catch (e) {
      setError(e);
      if (e instanceof GovernanceApiError && STALE_CODES.includes(e.code)) onStale();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Review actions" className="imp-actions" data-testid="decision-panel">
      <h4>Review</h4>
      <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className="imp-status-message" data-testid="decision-status">
        {message}
      </p>
      {actions.length === 0 ? <p className="gov-muted">No review action applies from {CANDIDATE_STATUS_LABEL[candidate.status as keyof typeof CANDIDATE_STATUS_LABEL] ?? candidate.status}.</p> : null}
      <div className="gov-actions" role="group" aria-label="Choose a review action">
        {actions.map((t) => (
          <button
            key={t}
            type="button"
            className={`gov-button${t === "REJECT" ? " gov-button--consequential" : ""}`}
            aria-pressed={type === t}
            disabled={busy}
            onClick={() => {
              setType(t);
              reset();
              setError(null);
            }}
          >
            {DECISION_LABEL[t]}
          </button>
        ))}
      </div>
      {type ? (
        <fieldset className="imp-decision-form" aria-describedby={`${formId}-help`}>
          <legend>{DECISION_LABEL[type]}</legend>
          <p id={`${formId}-help`} className="gov-muted">
            Recorded as an immutable Import Decision. {type.startsWith("APPROVE") ? "Approved for Import is not Canon and creates nothing." : ""}
          </p>
          {type === "CLASSIFY_MATCHED" ? (
            <>
              <Field label="Match basis" htmlFor={`${formId}-basis`}>
                <select id={`${formId}-basis`} value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value, target: "" })}>
                  <option value="">— choose —</option>
                  <option value="EXACT_MATCH" disabled={assessment?.outcome !== "EXACT_MATCH"}>
                    Exact automated match
                  </option>
                  <option value="SUGGESTED_MATCH" disabled={!assessment || assessment.suggestions.length === 0}>
                    One of the suggestions
                  </option>
                  <option value="MANUAL_OVERRIDE">Manual override (another Entity)</option>
                </select>
              </Field>
              {form.basis === "EXACT_MATCH" && assessment?.matchedEntityId ? (
                <p>
                  Target: <EntityLabel id={assessment.matchedEntityId} />
                </p>
              ) : null}
              {form.basis === "SUGGESTED_MATCH" && assessment ? (
                <fieldset>
                  <legend>Suggested Entity (nothing is preselected)</legend>
                  {assessment.suggestions.map((s) => (
                    <label key={s.id} className="imp-radio">
                      <input type="radio" name={`${formId}-suggestion`} value={s.entityId} checked={form.target === s.entityId} onChange={() => setForm({ ...form, target: s.entityId })} /> <EntityLabel id={s.entityId} /> ({MATCH_BASIS_LABEL[s.basis] ?? s.basis}, {s.score.toFixed(3)})
                    </label>
                  ))}
                </fieldset>
              ) : null}
              {form.basis === "MANUAL_OVERRIDE" ? <EntityPicker value={form.target} onChange={(id) => setForm({ ...form, target: id })} label="Target Entity" /> : null}
            </>
          ) : null}
          {type === "APPROVE_MATCHED" ? (
            <p>
              Target (from the accepted MATCHED classification): {matchedTarget(history) ? <EntityLabel id={matchedTarget(history) as string} /> : "—"}
            </p>
          ) : null}
          {type === "MARK_CONFLICT" ? (
            <Field label="Duplicate-group evidence (optional)" htmlFor={`${formId}-group`} hint={matchRunId ? undefined : "Select an exact MatchRun to cite a duplicate group."}>
              <select id={`${formId}-group`} value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })} disabled={!matchRunId}>
                <option value="">— none —</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.basis} · {g.identityKey}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {NEEDS_FORM.includes(type) ? (
            <Field
              label={type === "REJECT" || form.basis === "MANUAL_OVERRIDE" ? "Rationale (required)" : "Rationale (optional)"}
              htmlFor={`${formId}-rationale`}
              error={clientError}
            >
              <textarea id={`${formId}-rationale`} value={form.rationale} onChange={(e) => setForm({ ...form, rationale: e.target.value })} rows={2} />
            </Field>
          ) : clientError ? (
            <p className="gov-field__error" role="alert">
              {clientError}
            </p>
          ) : null}
          <label className="imp-checkbox">
            <input type="checkbox" checked={advance} onChange={(e) => setAdvance(e.target.checked)} /> Select the next Candidate afterwards
          </label>
          <div className="gov-actions">
            {type === "REJECT" ? (
              <ConfirmButton label="Record rejection" tone="consequential" confirm="Rejection is terminal for this Candidate. It stays stored as source evidence." onConfirm={() => submit("REJECT")} />
            ) : (
              <button type="button" className="gov-button gov-button--primary" disabled={busy} aria-busy={busy} onClick={() => void submit(type)}>
                {busy ? "Recording…" : `Record: ${DECISION_LABEL[type]}`}
              </button>
            )}
            <button type="button" className="gov-button" onClick={() => setType(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </fieldset>
      ) : null}
      {error ? <ImportError error={error} title="Decision not recorded" /> : null}
    </section>
  );
}

export function DecisionHistory({ decisions, title = "Decision history" }: { decisions: readonly ImportDecisionDto[]; title?: string }) {
  if (decisions.length === 0) return <EmptyNote title="No decisions yet.">Decisions are recorded with the review actions; history is append-only.</EmptyNote>;
  return (
    <section aria-label={title} data-testid="decision-history">
      <h4>{title}</h4>
      <ol className="imp-history">
        {decisions.map((d) => (
          <li key={d.id} data-testid="decision-entry">
            <p>
              <strong>{d.sequenceNumber}</strong> {d.decisionType.replace(/_/g, " ")} · {CANDIDATE_STATUS_LABEL[d.fromStatus as keyof typeof CANDIDATE_STATUS_LABEL] ?? d.fromStatus} →{" "}
              {CANDIDATE_STATUS_LABEL[d.toStatus as keyof typeof CANDIDATE_STATUS_LABEL] ?? d.toStatus}
            </p>
            <p className="gov-muted">
              {formatDate(d.createdAt)}
              {d.matchBasis ? ` · basis ${d.matchBasis}` : ""}
            </p>
            {d.targetEntityId ? (
              <p>
                Target: <EntityLabel id={d.targetEntityId} />
                {d.comparisonEntityVersionId ? (
                  <>
                    {" "}
                    · Comparison <VersionLabel id={d.comparisonEntityVersionId} />
                  </>
                ) : null}
              </p>
            ) : null}
            {d.rationale ? <p>Rationale: “{d.rationale}”</p> : null}
            <TechnicalDetails
              title="Pinned evidence"
              rows={[
                ["Decision", d.id],
                ["Candidate fingerprint", d.candidateFingerprint],
                ["Candidate set", d.candidateSetHash],
                ["MatchRun", d.matchRunId ?? "—"],
                ["Assessment", d.matchAssessmentId ?? "—"],
                ["Duplicate group", d.duplicateGroupId ?? "—"],
              ]}
            />
          </li>
        ))}
      </ol>
      <p className="gov-muted">Immutable history — decisions cannot be edited or deleted.</p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------------------------------------------

export function CompleteReviewPanel({ batch, summary, onComplete }: { batch: ImportBatchDto; summary: ReviewSummaryDto; onComplete: () => Promise<void> }) {
  const p = reviewProgress(summary.byStatus, summary.totalCandidates);
  if (batch.status === "COMPLETED") return <p data-testid="review-complete-note">Review Complete. This Batch is read-only; nothing was published or created.</p>;
  if (batch.status !== "REVIEWING") return null;
  const details = (
    <dl className="imp-counts">
      <div>
        <dt>Approved for Import</dt>
        <dd>{p.approved}</dd>
      </div>
      <div>
        <dt>Rejected</dt>
        <dd>{p.rejected}</dd>
      </div>
      <div>
        <dt>Unresolved</dt>
        <dd>{p.unresolved}</dd>
      </div>
    </dl>
  );
  return (
    <section aria-label="Complete review" className="imp-complete" data-testid="complete-review">
      {p.unresolved > 0 ? (
        <>
          <p className="gov-muted" data-testid="complete-blocked">
            {p.unresolved} Candidate(s) are not yet Approved for Import or Rejected — review cannot be completed.
          </p>
          <button type="button" className="gov-button" disabled aria-disabled="true">
            Complete Review
          </button>
        </>
      ) : (
        <ConfirmButton
          label="Complete Review"
          tone="consequential"
          confirm="Completing review freezes this review workflow. It does not publish or create Canon content."
          details={details}
          onConfirm={onComplete}
        />
      )}
    </section>
  );
}
