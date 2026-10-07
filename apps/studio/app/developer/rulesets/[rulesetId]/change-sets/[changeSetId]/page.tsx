"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { approveChangeSet, getChangeSet, getImpact, rejectChangeSet, submitChangeSetForReview } from "../../../../../../src/api-client";
import { EntityLabel, VersionLabel } from "../../../_components/pickers";
import { ConfirmButton, ErrorPanel, IdLine, ImmutableNote, Resource, StatusBadge, useResource } from "../../../_components/primitives";
import { SectionCrumbs, sectionHref, useWorkspace } from "../../../_components/workspace";
import { changeSetCommands, formatDate, groupImpactItems, OPERATION_HELP } from "../../../_lib/presentation";

/** ChangeSet detail (§35–§38): an immutable proposal, its named review commands, and the LIVE impact panel. */
export default function ChangeSetDetailPage() {
  const { ruleset } = useWorkspace();
  const { changeSetId } = useParams<{ changeSetId: string }>();
  const changeSet = useResource(() => getChangeSet(changeSetId), [changeSetId]);
  const [impactOn, setImpactOn] = useState(false);
  const impact = useResource(() => (impactOn ? getImpact(changeSetId) : Promise.resolve(null)), [changeSetId, impactOn]);
  const [error, setError] = useState<unknown>(null);
  const run = async (command: string) => {
    setError(null);
    try {
      if (command === "submit-review") await submitChangeSetForReview(changeSetId);
      else if (command === "approve") await approveChangeSet(changeSetId);
      else await rejectChangeSet(changeSetId);
      changeSet.reload();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <section aria-labelledby="cs-heading">
      <Resource state={changeSet}>
        {(c) => (
          <>
            <SectionCrumbs section={{ label: "ChangeSets", slug: "change-sets" }} record={c.name} />
            <h2 id="cs-heading">{c.name}</h2>
            <p className="gov-meta"><StatusBadge value={c.status} kind="change-set-status" /> · {formatDate(c.createdAt)}</p>
            <ImmutableNote>Immutable proposal — operations cannot be edited. To revise, create another ChangeSet.</ImmutableNote>
            {c.description ? <p>{c.description}</p> : null}
            {c.canonDecisionId ? <p>Linked decision: <Link href={sectionHref(ruleset.id, "decisions", c.canonDecisionId)}>{c.canonDecisionId.slice(0, 8)}</Link></p> : null}
            <IdLine label="ChangeSet ID" id={c.id} />
            <h3>Operations</h3>
            <ol className="gov-list" aria-label="Operations">
              {(c.operations ?? []).map((o) => (
                <li key={o.id} className="gov-card gov-card--compact">
                  <strong>{o.sequence}. {o.operationType}</strong>
                  <p className="gov-muted">{OPERATION_HELP[o.operationType]}</p>
                  {o.targetEntityId ? <p>Entity: <EntityLabel id={o.targetEntityId} /></p> : null}
                  {o.fromEntityVersionId ? <p>From: <VersionLabel id={o.fromEntityVersionId} /></p> : null}
                  {o.toEntityVersionId ? <p>To: <VersionLabel id={o.toEntityVersionId} /></p> : null}
                  {o.targetManifestId ? <p>Analyzed Manifest: <Link href={sectionHref(ruleset.id, "manifests", o.targetManifestId)}>{o.targetManifestId.slice(0, 8)}</Link></p> : null}
                  {o.description ? <p className="gov-muted">{o.description}</p> : null}
                </li>
              ))}
            </ol>
            <h3>Review</h3>
            <div className="gov-actions" data-testid="change-set-commands">
              {changeSetCommands(c.status).map((cmd) => (
                <ConfirmButton key={cmd.command} label={cmd.label} confirm={cmd.confirm} tone={cmd.tone} onConfirm={() => run(cmd.command)} />
              ))}
              {c.status === "APPROVED" ? <p>Approved — eligible for publication from the <Link href={sectionHref(ruleset.id, "releases")}>Releases</Link> section.</p> : null}
              {c.status === "REJECTED" ? <p>Rejected — read-only history.</p> : null}
            </div>
            {error ? <ErrorPanel error={error} title="Review command failed" /> : null}

            <div className="gov-panel" aria-labelledby="impact-heading" data-testid="impact-panel">
              <h3 id="impact-heading">LIVE IMPACT ANALYSIS</h3>
              <p className="gov-muted">Impact is derived from the current database graph and may evolve after this ChangeSet was created. It shows potential impact — what may need review — not breakage.</p>
              {!impactOn ? (
                <button type="button" className="gov-button" onClick={() => setImpactOn(true)}>Analyze Impact</button>
              ) : (
                <Resource state={impact}>
                  {(report) =>
                    report === null ? null : (
                      <div data-derivation={report.derivation}>
                        {groupImpactItems(report.items).map((group) => (
                          <details key={group.category} open={group.items.length > 0} className="gov-impact-group" data-category={group.category}>
                            <summary>{group.title} ({group.items.length})</summary>
                            <p className="gov-muted">{group.description}</p>
                            <ul>
                              {group.items.map((item) => (
                                <li key={`${item.resourceType}-${item.resourceId}`}>
                                  <code>{item.resourceType}</code> <code>{item.resourceId.slice(0, 13)}</code>
                                  <ul>{item.reasons.map((r, i) => <li key={i} className="gov-muted">{r.reason}</li>)}</ul>
                                </li>
                              ))}
                            </ul>
                          </details>
                        ))}
                      </div>
                    )
                  }
                </Resource>
              )}
            </div>
          </>
        )}
      </Resource>
    </section>
  );
}
