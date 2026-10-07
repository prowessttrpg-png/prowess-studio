"use client";

import { CANON_CONFLICT_DISPOSITIONS, CANON_DECISION_TYPES } from "@prowess/model";
import Link from "next/link";
import { useState } from "react";
import { listDecisions } from "../../../../../src/api-client";
import { EmptyNote, Field, Resource, StatusBadge, useResource } from "../../_components/primitives";
import { SectionCrumbs, sectionHref, useWorkspace } from "../../_components/workspace";
import { formatDate } from "../../_lib/presentation";

/** Decisions list. Decisions are created from a conflict's page — never here, never automatically. */
export default function DecisionsPage() {
  const { ruleset } = useWorkspace();
  const [f, setF] = useState({ decisionType: "", conflictDisposition: "" });
  const decisions = useResource(() => listDecisions(ruleset.id, { decisionType: f.decisionType || undefined, conflictDisposition: f.conflictDisposition || undefined }), [ruleset.id, f.decisionType, f.conflictDisposition]);
  return (
    <section aria-labelledby="decisions-heading">
      <SectionCrumbs section={{ label: "Decisions", slug: "decisions" }} />
      <h2 id="decisions-heading">Canon Decisions</h2>
      <p className="gov-muted">Decisions are created from a conflict&apos;s page and are immutable once recorded.</p>
      <div className="gov-filters" role="group" aria-label="Filter decisions">
        <Field label="Type" htmlFor="df-type">
          <select id="df-type" value={f.decisionType} onChange={(e) => setF({ ...f, decisionType: e.target.value })}>
            <option value="">Any</option>
            {CANON_DECISION_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Disposition" htmlFor="df-disposition">
          <select id="df-disposition" value={f.conflictDisposition} onChange={(e) => setF({ ...f, conflictDisposition: e.target.value })}>
            <option value="">Any</option>
            {CANON_CONFLICT_DISPOSITIONS.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
      </div>
      <Resource state={decisions}>
        {({ items }) =>
          items.length === 0 ? <EmptyNote title="No Canon Decisions yet." /> : (
            <ul className="gov-list" aria-label="Canon Decisions">
              {items.map((d) => (
                <li key={d.id} className="gov-card">
                  <h3 className="gov-card__title"><Link href={sectionHref(ruleset.id, "decisions", d.id)}>{d.decisionType}</Link></h3>
                  <p className="gov-meta"><StatusBadge value={d.conflictDisposition} kind="disposition" /> · {formatDate(d.createdAt)}</p>
                </li>
              ))}
            </ul>
          )
        }
      </Resource>
    </section>
  );
}
