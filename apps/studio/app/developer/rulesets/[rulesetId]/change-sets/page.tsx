"use client";

import { CHANGE_SET_OPERATION_TYPES, CHANGE_SET_STATUSES } from "@prowess/model";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { createChangeSet, listChangeSets, listDecisions, listManifests, proposeChangeSet } from "../../../../../src/api-client";
import { EntityPicker, ManifestSelect, VersionSelect } from "../../_components/pickers";
import { EmptyNote, ErrorPanel, Field, Resource, StatusBadge, useResource, useUnsavedWarning } from "../../_components/primitives";
import { SectionCrumbs, sectionHref, useWorkspace } from "../../_components/workspace";
import { formatDate, OPERATION_HELP, operationFields } from "../../_lib/presentation";

type Op = { operationType: string; targetEntityId: string; fromEntityVersionId: string; toEntityVersionId: string; targetManifestId: string; description: string };
const blankOp = (): Op => ({ operationType: "NO_CHANGE", targetEntityId: "", fromEntityVersionId: "", toEntityVersionId: "", targetManifestId: "", description: "" });

/** ChangeSets (§31–§34): immutable proposals — created manually or EXPLICITLY proposed from a decision. Nothing executes. */
function ChangeSetsInner() {
  const { ruleset } = useWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState("");
  const changeSets = useResource(() => listChangeSets(ruleset.id, { status: status || undefined }), [ruleset.id, status]);
  const decisions = useResource(() => listDecisions(ruleset.id), [ruleset.id]);
  const manifests = useResource(() => listManifests(ruleset.id), [ruleset.id]);
  const [mode, setMode] = useState<"manual" | "decision">(params.get("fromDecision") ? "decision" : "manual");
  const [meta, setMeta] = useState({ name: "", description: "", canonDecisionId: params.get("fromDecision") ?? "", targetManifestId: "" });
  const [ops, setOps] = useState<Op[]>([blankOp()]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useUnsavedWarning(meta.name !== "");

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created =
        mode === "decision"
          ? await proposeChangeSet(meta.canonDecisionId, { name: meta.name.trim(), description: meta.description.trim() || null, targetManifestId: meta.targetManifestId || null })
          : await createChangeSet(ruleset.id, {
              canonDecisionId: meta.canonDecisionId || null,
              name: meta.name.trim(),
              description: meta.description.trim() || null,
              operations: ops.map((o) => {
                const f = operationFields(o.operationType);
                return {
                  operationType: o.operationType,
                  targetEntityId: f.entity ? o.targetEntityId || null : null,
                  fromEntityVersionId: f.from ? o.fromEntityVersionId || null : null,
                  toEntityVersionId: f.to ? o.toEntityVersionId || null : null,
                  targetManifestId: o.targetManifestId || null,
                  description: o.description.trim() || null,
                };
              }),
            });
      setMeta({ name: "", description: "", canonDecisionId: "", targetManifestId: "" });
      router.push(sectionHref(ruleset.id, "change-sets", created.id));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="changesets-heading">
      <SectionCrumbs section={{ label: "ChangeSets", slug: "change-sets" }} />
      <h2 id="changesets-heading">ChangeSets</h2>
      <Field label="Status" htmlFor="cs-filter">
        <select id="cs-filter" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any</option>
          {CHANGE_SET_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </Field>
      <Resource state={changeSets}>
        {({ items }) =>
          items.length === 0 ? <EmptyNote title="No ChangeSets yet." /> : (
            <ul className="gov-list" aria-label="ChangeSets">
              {items.map((c) => (
                <li key={c.id} className="gov-card">
                  <h3 className="gov-card__title"><Link href={sectionHref(ruleset.id, "change-sets", c.id)}>{c.name}</Link></h3>
                  <p className="gov-meta"><StatusBadge value={c.status} kind="change-set-status" /> · {c.canonDecisionId ? "From a decision" : "Manual"} · {formatDate(c.createdAt)}</p>
                </li>
              ))}
            </ul>
          )
        }
      </Resource>

      <form className="gov-form" aria-labelledby="create-cs-heading" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h3 id="create-cs-heading">Create ChangeSet</h3>
        <div role="radiogroup" aria-label="Creation path" className="gov-actions">
          <label className="gov-choice"><input type="radio" checked={mode === "manual"} onChange={() => setMode("manual")} /> Manual proposal</label>
          <label className="gov-choice"><input type="radio" checked={mode === "decision"} onChange={() => setMode("decision")} /> From Canon Decision</label>
        </div>
        <Field label="Name" htmlFor="cs-name">
          <input id="cs-name" required value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
        </Field>
        <Field label="Description" htmlFor="cs-description">
          <textarea id="cs-description" value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />
        </Field>
        <Field label={mode === "decision" ? "Canon Decision" : "Linked Canon Decision (optional)"} htmlFor="cs-decision">
          <select id="cs-decision" value={meta.canonDecisionId} required={mode === "decision"} onChange={(e) => setMeta({ ...meta, canonDecisionId: e.target.value })}>
            <option value="">{mode === "decision" ? "Choose a decision…" : "None"}</option>
            {(decisions.data?.items ?? []).map((d) => <option key={d.id} value={d.id}>{`${d.decisionType} → ${d.conflictDisposition} · ${d.id.slice(0, 8)}`}</option>)}
          </select>
        </Field>
        {mode === "decision" ? (
          <>
            <ManifestSelect label="Target Manifest (optional)" manifests={manifests.data?.items ?? []} value={meta.targetManifestId} onChange={(targetManifestId) => setMeta({ ...meta, targetManifestId })} allowNone noneLabel="None (propose a PIN)" />
            <p className="gov-muted">The server translates the decision into proposed operations and saves a DRAFT ChangeSet. Nothing is applied.</p>
          </>
        ) : (
          <ol className="gov-rows" aria-label="Operations">
            {ops.map((o, i) => {
              const f = operationFields(o.operationType);
              const set = (patch: Partial<Op>) => setOps(ops.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <li key={i} className="gov-row">
                  <Field label={`Operation ${i + 1}`} htmlFor={`op-type-${i}`} hint={OPERATION_HELP[o.operationType]}>
                    <select id={`op-type-${i}`} value={o.operationType} onChange={(e) => set({ operationType: e.target.value })}>
                      {CHANGE_SET_OPERATION_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </Field>
                  {f.entity ? <EntityPicker value={o.targetEntityId} onChange={(targetEntityId) => set({ targetEntityId, fromEntityVersionId: "", toEntityVersionId: "" })} label="Target Entity" /> : null}
                  {f.from ? <VersionSelect entityId={o.targetEntityId} value={o.fromEntityVersionId} onChange={(fromEntityVersionId) => set({ fromEntityVersionId })} label="From Version" /> : null}
                  {f.to ? <VersionSelect entityId={o.targetEntityId} value={o.toEntityVersionId} onChange={(toEntityVersionId) => set({ toEntityVersionId })} label="To Version" /> : null}
                  <ManifestSelect label="Analyzed Manifest (optional)" manifests={manifests.data?.items ?? []} value={o.targetManifestId} onChange={(targetManifestId) => set({ targetManifestId })} allowNone />
                  {ops.length > 1 ? <button type="button" className="gov-link-button" onClick={() => setOps(ops.filter((_, j) => j !== i))}>Remove operation {i + 1}</button> : null}
                </li>
              );
            })}
          </ol>
        )}
        {mode === "manual" ? <button type="button" className="gov-button" onClick={() => setOps([...ops, blankOp()])}>Add operation</button> : null}
        {error ? <ErrorPanel error={error} title="Could not create the ChangeSet" /> : null}
        <button type="submit" className="gov-button gov-button--primary" disabled={busy}>
          {mode === "decision" ? "Propose ChangeSet" : "Create ChangeSet"}
        </button>
      </form>
    </section>
  );
}

export default function ChangeSetsPage() {
  return (
    <Suspense fallback={<p role="status">Loading…</p>}>
      <ChangeSetsInner />
    </Suspense>
  );
}
