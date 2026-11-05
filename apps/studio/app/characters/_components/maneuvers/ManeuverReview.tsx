"use client";
import { formatEnumLabel } from "@prowess/ui";
import Link from "next/link";
import { entryHref } from "../../../compendium/rulesets/_lib/reference-urls";
import type { ManeuverDraftDto, ManeuverEvaluationDto } from "../../_lib/maneuver-types";
import type { ReleaseSummaryDto } from "../../_lib/character-client";
import { actionLabel, maneuverCost, ordered } from "../../_lib/maneuver-format";
import { refName, STATE_LABELS } from "../../_lib/spell-format";

export function ManeuverState({ state }: { state: keyof typeof STATE_LABELS }) { return <span className="gov-tag" data-testid="maneuver-state" data-state={state}>{STATE_LABELS[state]}</span>; }
export function ManeuverCost({ evaluation }: { evaluation: ManeuverEvaluationDto | null }) {
  const c = maneuverCost(evaluation);
  return <p data-testid="maneuver-cost">{c ? <strong>{c.ap.finalApCost} AP · {c.mp.finalMpCost} MP</strong> : <strong>Cost unresolved</strong>}</p>;
}
export function ManeuverWarnings({ evaluation }: { evaluation: ManeuverEvaluationDto | null }) {
  return <>{evaluation?.runtimeDeferred.length ? <ul aria-label="Runtime deferred">{evaluation.runtimeDeferred.map((q, i) => <li key={`${q.code}/${i}`}>Runtime deferred: {q.message} <code>{q.code}</code></li>)}</ul> : null}{evaluation?.issues.length ? <ul aria-label="Maneuver warnings">{evaluation.issues.map((q, i) => <li key={i}>{q.message} <code>{q.code}</code></li>)}</ul> : null}</>;
}
export function ManeuverReview({ draft, evaluation, names, release }: { draft: ManeuverDraftDto; evaluation: ManeuverEvaluationDto | null; names: Record<string, string>; release: ReleaseSummaryDto }) {
  const c = maneuverCost(evaluation);
  return <section className="gov-panel" aria-label="Maneuver composition" data-testid="maneuver-review">
    <h2>{draft.concept.name}</h2><ManeuverState state={evaluation?.state ?? "UNREADABLE"} /><ManeuverCost evaluation={evaluation} />
    <p>{draft.concept.description}</p><p>{draft.concept.visualDescription}</p><p>{draft.concept.notes}</p><p>{draft.concept.narrativeTags.join(", ")}</p>
    <h3>Action sequence</h3><ol>{ordered(draft.actions).map(a => <li key={a.componentKey}><strong>{a.componentKey}</strong>: {actionLabel(names, a.source)}{draft.powerfulBlow?.actionKeys.includes(a.componentKey) ? " — Powerful Blow constituent" : ""}</li>)}</ol>
    <h3>Effects and exact attachments</h3><ol>{ordered(draft.effects).map(e => <li key={e.componentKey}>{refName(names, e.definition)} → {draft.effectAttachments.find(a => a.effectKey === e.componentKey)?.actionKeys.join(", ") ?? "Attachment required"}</li>)}</ol>
    <h3>Traits and exact targets</h3><ul>{draft.traits.map(t => <li key={t.componentKey}>{refName(names, t.definition)} → {formatEnumLabel(t.appliesTo.scope)}: {t.appliesTo.componentKey ?? "whole Maneuver"}</li>)}</ul>
    <p>Duration: {refName(names, draft.duration?.definition)}. Conditions: {draft.conditions.map(q => refName(names, q.definition)).join(", ") || "None selected"}.</p>
    <ManeuverWarnings evaluation={evaluation} />
    {c ? <table className="gov-table" data-testid="maneuver-cost-inspector"><caption>Evaluated cost sequence</caption><tbody>
      <tr><th scope="row">Base AP / MP</th><td>{c.ap.baseApCost} AP / {c.mp.baseMpCost} MP</td></tr>
      <tr><th scope="row">Protected Action AP subtotal</th><td>{c.ap.protectedActionAp ?? "Unavailable"}</td></tr>
      <tr><th scope="row">Effective Condition reduction (cap {c.ap.conditions.maximumApReduction})</th><td>{c.ap.conditions.effectiveApReduction} AP</td></tr>
      <tr><th scope="row">Applied Condition floor</th><td>{c.ap.appliedConditionFloor ?? "Unavailable"}</td></tr>
      <tr><th scope="row">Post-Condition AP</th><td>{c.ap.postConditionApCost}</td></tr>
      <tr><th scope="row">Signature reduction after floor</th><td>{c.ap.signature.reduction} AP{c.ap.signature.applied ? " (applied)" : " (not applied)"}</td></tr>
      <tr><th scope="row">MP reduction</th><td>{c.mp.conditionMpReduction} MP</td></tr>
      <tr><th scope="row">Final listed AP / MP</th><td>{c.ap.finalApCost} AP / {c.mp.finalMpCost} MP</td></tr>
    </tbody></table> : null}
    {evaluation?.authored?.durationConditions?.conditions.filter(q => q.performance).map(q => <p key={q.componentKey} data-testid="maneuver-performance-preparation">{refName(names, q.definition)}: {formatEnumLabel(q.performance!.rank)}; separate preparation {q.preparationAp ?? "Unresolved"} AP before activation. Preparation is excluded from listed Maneuver AP. {q.consumesSlot ? "Ordinary Condition slot" : "Obligatory; no ordinary Condition slot"}.</p>)}
    <details><summary>Rules Inspector: targeting, resolution, prerequisites and provenance</summary><pre className="maneuver-inspector">{JSON.stringify({ authored: evaluation?.authored, inspector: evaluation?.inspector, costs: evaluation?.cost }, null, 2)}</pre></details>
    <details><summary>Exact Release components</summary><ul>{evaluation?.components.map(r => <li key={r.entityVersionId}><Link href={entryHref(release.rulesetId, release.id, r.entityId)}>{refName(names, r)}</Link> <code>{r.entityVersionId}</code></li>)}</ul></details>
  </section>;
}
