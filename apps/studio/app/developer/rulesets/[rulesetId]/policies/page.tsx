"use client";

import { SOURCE_AUTHORITY_STATUSES } from "@prowess/model";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPolicy, listPolicies } from "../../../../../src/api-client";
import { SourceDocumentSelect } from "../../_components/pickers";
import { EmptyNote, ErrorPanel, Field, IdLine, Resource, useResource, useUnsavedWarning } from "../../_components/primitives";
import { SectionCrumbs, sectionHref, useWorkspace } from "../../_components/workspace";
import { formatDate } from "../../_lib/presentation";

type Row = { sourceDocumentId: string; scopeKey: string; authorityStatus: string; rationale: string };

/** Canon Policy (§18–§20): immutable snapshots. "Latest" means only the numerically highest policyVersion. */
export default function PoliciesPage() {
  const { ruleset } = useWorkspace();
  const router = useRouter();
  const policies = useResource(() => listPolicies(ruleset.id), [ruleset.id]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useUnsavedWarning(name !== "" || rows.length > 0);
  const highest = (policies.data?.items ?? []).reduce((m, p) => Math.max(m, p.policyVersion), 0);

  return (
    <section aria-labelledby="policies-heading">
      <SectionCrumbs section={{ label: "Canon Policy", slug: "policies" }} />
      <h2 id="policies-heading">Canon Policies</h2>
      <Resource state={policies}>
        {({ items }) =>
          items.length === 0 ? (
            <EmptyNote title="No Canon Policies have been created." />
          ) : (
            <ul className="gov-list" aria-label="Canon Policies">
              {[...items].reverse().map((p) => (
                <li key={p.id} className="gov-card">
                  <h3 className="gov-card__title">
                    <Link href={sectionHref(ruleset.id, "policies", p.id)}>Policy v{p.policyVersion} — {p.name}</Link>
                    {p.policyVersion === highest ? <span className="gov-tag"> Latest (highest version)</span> : null}
                  </h3>
                  <p className="gov-meta">{formatDate(p.createdAt)}</p>
                  <IdLine label="Policy ID" id={p.id} />
                </li>
              ))}
            </ul>
          )
        }
      </Resource>
      <form
        className="gov-form"
        aria-labelledby="create-policy-heading"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const created = await createPolicy(ruleset.id, {
              name: name.trim(),
              description: description.trim() || null,
              authorities: rows.map((r) => ({ sourceDocumentId: r.sourceDocumentId, scopeKey: r.scopeKey.trim(), authorityStatus: r.authorityStatus, rationale: r.rationale.trim() || null })),
            });
            setName("");
            setRows([]);
            router.push(sectionHref(ruleset.id, "policies", created.id));
          } catch (err) {
            setError(err);
            setBusy(false);
          }
        }}
      >
        <h3 id="create-policy-heading">Create Canon Policy</h3>
        <p className="gov-muted">A policy is an immutable snapshot once created.</p>
        <Field label="Name" htmlFor="policy-name">
          <input id="policy-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="policy-description">
          <textarea id="policy-description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <ol className="gov-rows" aria-label="Authority records">
          {rows.map((r, i) => {
            const set = (patch: Partial<Row>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <li key={i} className="gov-row">
                <SourceDocumentSelect value={r.sourceDocumentId} onChange={(sourceDocumentId) => set({ sourceDocumentId })} label={`Source Document (record ${i + 1})`} />
                <Field label="Scope key" htmlFor={`scope-${i}`} hint="e.g. global, or a dotted scope like spell.affinity">
                  <input id={`scope-${i}`} required value={r.scopeKey} onChange={(e) => set({ scopeKey: e.target.value })} />
                </Field>
                <Field label="Authority status" htmlFor={`status-${i}`}>
                  <select id={`status-${i}`} value={r.authorityStatus} onChange={(e) => set({ authorityStatus: e.target.value })}>
                    {SOURCE_AUTHORITY_STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Rationale (optional)" htmlFor={`rationale-${i}`}>
                  <input id={`rationale-${i}`} value={r.rationale} onChange={(e) => set({ rationale: e.target.value })} />
                </Field>
                <button type="button" className="gov-link-button" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  Remove record {i + 1}
                </button>
              </li>
            );
          })}
        </ol>
        <button type="button" className="gov-button" onClick={() => setRows([...rows, { sourceDocumentId: "", scopeKey: "global", authorityStatus: SOURCE_AUTHORITY_STATUSES[0], rationale: "" }])}>
          Add authority record
        </button>
        {error ? <ErrorPanel error={error} title="Could not create the Canon Policy" /> : null}
        <button type="submit" className="gov-button gov-button--primary" disabled={busy}>
          Create Canon Policy
        </button>
      </form>
    </section>
  );
}
