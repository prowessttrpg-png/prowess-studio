"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { getConflict, getDecision, getPolicy } from "../../../../../../src/api-client";
import { VersionLabel } from "../../../_components/pickers";
import { IdLine, ImmutableNote, Resource, StatusBadge, useResource } from "../../../_components/primitives";
import { SectionCrumbs, sectionHref, useWorkspace } from "../../../_components/workspace";
import { formatDate } from "../../../_lib/presentation";

/** Decision detail (§29): an immutable record. No edit or delete controls exist. */
export default function DecisionDetailPage() {
  const { ruleset } = useWorkspace();
  const { decisionId } = useParams<{ decisionId: string }>();
  const view = useResource(async () => {
    const decision = await getDecision(decisionId);
    const [conflict, policy] = await Promise.all([getConflict(decision.ruleConflictId), getPolicy(decision.canonPolicyId)]);
    return { decision, conflict, policy };
  }, [decisionId]);
  return (
    <section aria-labelledby="decision-heading">
      <Resource state={view}>
        {({ decision: d, conflict, policy }) => (
          <>
            <SectionCrumbs section={{ label: "Decisions", slug: "decisions" }} record={d.decisionType} />
            <h2 id="decision-heading">{d.decisionType}</h2>
            <ImmutableNote>Historical record — Canon Decisions are immutable.</ImmutableNote>
            <dl className="gov-dl">
              <dt>Disposition</dt>
              <dd><StatusBadge value={d.conflictDisposition} kind="disposition" /></dd>
              <dt>Conflict</dt>
              <dd><Link href={sectionHref(ruleset.id, "conflicts", conflict.id)}>{conflict.title}</Link></dd>
              <dt>Canon Policy</dt>
              <dd><Link href={sectionHref(ruleset.id, "policies", policy.id)}>v{policy.policyVersion} — {policy.name}</Link></dd>
              <dt>Selected candidates</dt>
              <dd>
                {(d.selections ?? []).length === 0 ? "None" : (
                  <ul aria-label="Selected candidates">
                    {(d.selections ?? []).map((s) => {
                      const cand = (conflict.candidates ?? []).find((c) => c.id === s.ruleConflictCandidateId);
                      return <li key={s.id}>{cand ? <VersionLabel id={cand.entityVersionId} /> : s.ruleConflictCandidateId}</li>;
                    })}
                  </ul>
                )}
              </dd>
              {d.resultEntityVersionId ? (<><dt>MERGE result</dt><dd><VersionLabel id={d.resultEntityVersionId} /></dd></>) : null}
              <dt>Rationale</dt>
              <dd>{d.rationale}</dd>
              <dt>Created</dt>
              <dd>{formatDate(d.createdAt)}</dd>
            </dl>
            <IdLine label="Decision ID" id={d.id} />
            <p>
              <Link href={`${sectionHref(ruleset.id, "change-sets")}?fromDecision=${d.id}`}>Propose a ChangeSet from this decision</Link>
            </p>
          </>
        )}
      </Resource>
    </section>
  );
}
