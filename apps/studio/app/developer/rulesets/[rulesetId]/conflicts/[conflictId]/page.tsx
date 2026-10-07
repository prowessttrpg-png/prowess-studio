"use client";

import { CANON_CONFLICT_DISPOSITIONS, CANON_DECISION_TYPES } from "@prowess/model";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { createDecision, getConflict, listConflictDecisions, listPolicies } from "../../../../../../src/api-client";
import { EntityLabel, PolicySelect, VersionLabel, VersionSelect } from "../../../_components/pickers";
import { ErrorPanel, Field, IdLine, ImmutableNote, Resource, StatusBadge, useResource } from "../../../_components/primitives";
import { SectionCrumbs, sectionHref, useWorkspace } from "../../../_components/workspace";
import { conflictAcceptsDecision, decisionAffordances, formatDate } from "../../../_lib/presentation";

/**
 * Conflict detail (§24–§30): immutable evidence, never ranked by authority and never labelled a winner, plus the
 * explicit Canon Decision form for OPEN / UNDER_REVIEW conflicts. Form affordances come from the model's own
 * decision rules; the server validates the final combination.
 */
export default function ConflictDetailPage() {
  const { ruleset } = useWorkspace();
  const { conflictId } = useParams<{ conflictId: string }>();
  const conflict = useResource(() => getConflict(conflictId), [conflictId]);
  const decisions = useResource(() => listConflictDecisions(conflictId), [conflictId]);
  const policies = useResource(() => listPolicies(ruleset.id), [ruleset.id]);
  const [form, setForm] = useState({ canonPolicyId: "", decisionType: "SELECT_RULE", conflictDisposition: "RESOLVED", resultEntityVersionId: "", rationale: "" });
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const aff = decisionAffordances(form.decisionType);

  return (
    <section aria-labelledby="conflict-heading">
      <Resource state={conflict}>
        {(c) => {
          const candidates = c.candidates ?? [];
          const policy = (policies.data?.items ?? []).find((p) => p.id === form.canonPolicyId);
          return (
            <>
              <SectionCrumbs section={{ label: "Conflicts", slug: "conflicts" }} record={c.title} />
              <h2 id="conflict-heading">{c.title}</h2>
              <p className="gov-meta">
                <StatusBadge value={c.status} kind="conflict-status" /> <StatusBadge value={c.severity} kind="severity" /> <StatusBadge value={c.conflictType} kind="conflict-type" /> · <EntityLabel id={c.entityId} /> · {formatDate(c.createdAt)}
              </p>
              {c.description ? <p>{c.description}</p> : null}
              <IdLine label="Conflict ID" id={c.id} />
              <ImmutableNote>Conflict evidence is a historical record. Candidates are shown in revision order — never ranked.</ImmutableNote>
              <h3>Candidates</h3>
              <ul className="gov-list" aria-label="Candidates" data-testid="candidates">
                {candidates.map((cand) => (
                  <li key={cand.id} className="gov-card gov-card--compact">
                    <VersionLabel id={cand.entityVersionId} />
                    {cand.label ? <strong> · {cand.label}</strong> : null}
                    {cand.positionSummary ? <p className="gov-muted">{cand.positionSummary}</p> : null}
                    {cand.sourceReferenceId ? <p className="gov-muted">Source reference <code>{cand.sourceReferenceId.slice(0, 8)}</code></p> : null}
                  </li>
                ))}
              </ul>
              <h3>Decisions</h3>
              <Resource state={decisions}>
                {({ items }) =>
                  items.length === 0 ? <p className="gov-muted">No decision yet.</p> : (
                    <ul className="gov-list" aria-label="Decisions on this conflict">
                      {items.map((d) => (
                        <li key={d.id}><Link href={sectionHref(ruleset.id, "decisions", d.id)}>{d.decisionType} → {d.conflictDisposition}</Link> · {formatDate(d.createdAt)}</li>
                      ))}
                    </ul>
                  )
                }
              </Resource>
              {conflictAcceptsDecision(c.status) ? (
                <form
                  className="gov-form"
                  aria-labelledby="decision-heading"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    setError(null);
                    try {
                      await createDecision(c.id, {
                        canonPolicyId: form.canonPolicyId,
                        decisionType: form.decisionType,
                        conflictDisposition: form.conflictDisposition,
                        selectedCandidateIds: selected,
                        resultEntityVersionId: aff.showResult ? form.resultEntityVersionId || null : null,
                        rationale: form.rationale.trim(),
                      });
                      conflict.reload();
                      decisions.reload();
                    } catch (err) {
                      setError(err);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <h3 id="decision-heading">Create Canon Decision</h3>
                  <PolicySelect policies={policies.data?.items ?? []} value={form.canonPolicyId} onChange={(canonPolicyId) => setForm({ ...form, canonPolicyId })} />
                  <Field label="Decision type" htmlFor="decision-type">
                    <select id="decision-type" value={form.decisionType} onChange={(e) => { setForm({ ...form, decisionType: e.target.value, conflictDisposition: decisionAffordances(e.target.value).suggestedDispositions[0] ?? form.conflictDisposition }); setSelected([]); }}>
                      {CANON_DECISION_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Conflict disposition" htmlFor="decision-disposition" hint={`Usually ${aff.suggestedDispositions.join(" or ")} for ${form.decisionType}.`}>
                    <select id="decision-disposition" value={form.conflictDisposition} onChange={(e) => setForm({ ...form, conflictDisposition: e.target.value })}>
                      {CANON_CONFLICT_DISPOSITIONS.map((d) => <option key={d}>{d}</option>)}
                    </select>
                  </Field>
                  <fieldset className="gov-fieldset">
                    <legend>Candidate selection</legend>
                    <p className="gov-muted">{aff.hint}</p>
                    {candidates.map((cand) => (
                      <label key={cand.id} className="gov-choice">
                        <input
                          type={aff.singleSelection ? "radio" : "checkbox"}
                          name="candidate"
                          checked={selected.includes(cand.id)}
                          onChange={(e) => setSelected(aff.singleSelection ? [cand.id] : e.target.checked ? [...selected, cand.id] : selected.filter((x) => x !== cand.id))}
                        />{" "}
                        <VersionLabel id={cand.entityVersionId} /> {cand.label ? `· ${cand.label}` : ""}
                      </label>
                    ))}
                  </fieldset>
                  {aff.showResult ? <VersionSelect entityId={c.entityId} value={form.resultEntityVersionId} onChange={(resultEntityVersionId) => setForm({ ...form, resultEntityVersionId })} label="MERGE result Version" /> : null}
                  <Field label="Rationale" htmlFor="decision-rationale">
                    <textarea id="decision-rationale" required value={form.rationale} onChange={(e) => setForm({ ...form, rationale: e.target.value })} />
                  </Field>
                  <div className="gov-panel" data-testid="decision-preview" aria-label="Decision preview">
                    <strong>Preview</strong>
                    <p>Decision: {form.decisionType} · Disposition: {form.conflictDisposition}</p>
                    <p>Selected: {selected.length === 0 ? "none" : selected.map((id) => { const cand = candidates.find((x) => x.id === id); return cand ? <span key={id}><VersionLabel id={cand.entityVersionId} />; </span> : null; })}</p>
                    <p>Policy: {policy ? `v${policy.policyVersion} — ${policy.name}` : "not chosen"}</p>
                  </div>
                  {error ? <ErrorPanel error={error} title="Could not create the decision" /> : null}
                  <button type="submit" className="gov-button gov-button--consequential" disabled={busy || !form.canonPolicyId}>
                    Create Canon Decision
                  </button>
                </form>
              ) : (
                <ImmutableNote>This conflict is {c.status}; it cannot receive another decision.</ImmutableNote>
              )}
            </>
          );
        }}
      </Resource>
    </section>
  );
}
