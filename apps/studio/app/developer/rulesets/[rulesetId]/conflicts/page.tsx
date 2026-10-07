"use client";

import { RULE_CONFLICT_SEVERITIES, RULE_CONFLICT_STATUSES, RULE_CONFLICT_TYPES } from "@prowess/model";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createConflict, listConflicts } from "../../../../../src/api-client";
import { EntityLabel, EntityPicker, VersionSelect } from "../../_components/pickers";
import { EmptyNote, ErrorPanel, Field, Resource, StatusBadge, useResource, useUnsavedWarning } from "../../_components/primitives";
import { SectionCrumbs, sectionHref, useWorkspace } from "../../_components/workspace";

type Candidate = { entityVersionId: string; sourceReferenceId: string; label: string; positionSummary: string };
const blank = (): Candidate => ({ entityVersionId: "", sourceReferenceId: "", label: "", positionSummary: "" });

/** Rule Conflicts (§22, §23): explicit records of disagreement. Recording one never resolves it. */
export default function ConflictsPage() {
  const { ruleset } = useWorkspace();
  const router = useRouter();
  const [filters, setFilters] = useState({ status: "", severity: "", conflictType: "" });
  const conflicts = useResource(() => listConflicts(ruleset.id, { status: filters.status || undefined, severity: filters.severity || undefined, conflictType: filters.conflictType || undefined }), [ruleset.id, filters.status, filters.severity, filters.conflictType]);
  const [form, setForm] = useState({ entityId: "", conflictType: RULE_CONFLICT_TYPES[0] as string, severity: "MEDIUM", title: "", description: "" });
  const [candidates, setCandidates] = useState<Candidate[]>([blank(), blank()]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useUnsavedWarning(form.title !== "" || candidates.some((c) => c.entityVersionId !== ""));
  const countOk = candidates.length >= 2 && candidates.length <= 25;

  return (
    <section aria-labelledby="conflicts-heading">
      <SectionCrumbs section={{ label: "Conflicts", slug: "conflicts" }} />
      <h2 id="conflicts-heading">Rule Conflicts</h2>
      <div className="gov-filters" role="group" aria-label="Filter conflicts">
        {([["status", RULE_CONFLICT_STATUSES], ["severity", RULE_CONFLICT_SEVERITIES], ["conflictType", RULE_CONFLICT_TYPES]] as const).map(([key, values]) => (
          <Field key={key} label={key === "conflictType" ? "Type" : key[0]!.toUpperCase() + key.slice(1)} htmlFor={`cf-${key}`}>
            <select id={`cf-${key}`} value={filters[key]} onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}>
              <option value="">Any</option>
              {values.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
        ))}
      </div>
      <Resource state={conflicts}>
        {({ items }) =>
          items.length === 0 ? (
            <EmptyNote title={filters.status === "OPEN" ? "No open Rule Conflicts." : "No Rule Conflicts match."} />
          ) : (
            <ul className="gov-list" aria-label="Rule Conflicts">
              {items.map((c) => (
                <li key={c.id} className="gov-card" data-open={c.status === "OPEN" || c.status === "UNDER_REVIEW"}>
                  <h3 className="gov-card__title">
                    <Link href={sectionHref(ruleset.id, "conflicts", c.id)}>{c.title}</Link>
                  </h3>
                  <p className="gov-meta">
                    <StatusBadge value={c.status} kind="conflict-status" /> <StatusBadge value={c.severity} kind="severity" /> <StatusBadge value={c.conflictType} kind="conflict-type" /> · <EntityLabel id={c.entityId} />
                  </p>
                </li>
              ))}
            </ul>
          )
        }
      </Resource>
      <form
        className="gov-form"
        aria-labelledby="create-conflict-heading"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const created = await createConflict(ruleset.id, {
              entityId: form.entityId,
              conflictType: form.conflictType,
              severity: form.severity,
              title: form.title.trim(),
              description: form.description.trim() || null,
              candidates: candidates.map((c) => ({ entityVersionId: c.entityVersionId, sourceReferenceId: c.sourceReferenceId.trim() || null, label: c.label.trim() || null, positionSummary: c.positionSummary.trim() || null })),
            });
            setForm({ ...form, title: "", description: "" });
            router.push(sectionHref(ruleset.id, "conflicts", created.id));
          } catch (err) {
            setError(err);
            setBusy(false);
          }
        }}
      >
        <h3 id="create-conflict-heading">Record a Rule Conflict</h3>
        <p className="gov-muted">Records a disagreement between exact Versions. It is created OPEN and resolves nothing.</p>
        <EntityPicker value={form.entityId} onChange={(entityId) => { setForm({ ...form, entityId }); setCandidates(candidates.map((c) => ({ ...c, entityVersionId: "" }))); }} />
        <Field label="Conflict type" htmlFor="conflict-type">
          <select id="conflict-type" value={form.conflictType} onChange={(e) => setForm({ ...form, conflictType: e.target.value })}>
            {RULE_CONFLICT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Severity" htmlFor="conflict-severity">
          <select id="conflict-severity" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
            {RULE_CONFLICT_SEVERITIES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Title" htmlFor="conflict-title">
          <input id="conflict-title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Description" htmlFor="conflict-description">
          <textarea id="conflict-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <ol className="gov-rows" aria-label="Candidates">
          {candidates.map((c, i) => {
            const set = (patch: Partial<Candidate>) => setCandidates(candidates.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <li key={i} className="gov-row">
                <VersionSelect entityId={form.entityId} value={c.entityVersionId} onChange={(entityVersionId) => set({ entityVersionId })} label={`Candidate ${i + 1}: exact Version`} />
                <Field label="Source reference ID (optional)" htmlFor={`cand-ref-${i}`}>
                  <input id={`cand-ref-${i}`} value={c.sourceReferenceId} onChange={(e) => set({ sourceReferenceId: e.target.value })} />
                </Field>
                <Field label="Label (optional)" htmlFor={`cand-label-${i}`}>
                  <input id={`cand-label-${i}`} value={c.label} onChange={(e) => set({ label: e.target.value })} />
                </Field>
                <Field label="Position summary (optional)" htmlFor={`cand-summary-${i}`}>
                  <input id={`cand-summary-${i}`} value={c.positionSummary} onChange={(e) => set({ positionSummary: e.target.value })} />
                </Field>
                {candidates.length > 2 ? (
                  <button type="button" className="gov-link-button" onClick={() => setCandidates(candidates.filter((_, j) => j !== i))}>Remove candidate {i + 1}</button>
                ) : null}
              </li>
            );
          })}
        </ol>
        {candidates.length < 25 ? <button type="button" className="gov-button" onClick={() => setCandidates([...candidates, blank()])}>Add candidate</button> : null}
        {!countOk ? <p className="gov-field__error">A conflict needs 2–25 candidates.</p> : null}
        {error ? <ErrorPanel error={error} title="Could not record the conflict" /> : null}
        <button type="submit" className="gov-button gov-button--primary" disabled={busy || !countOk || !form.entityId}>
          Record conflict
        </button>
      </form>
    </section>
  );
}
