"use client";

import { formatEnumLabel } from "@prowess/ui";
import Link from "next/link";
import { entryHref } from "../../../compendium/rulesets/_lib/reference-urls";
import type { DefinitionRefDto, ReleaseSummaryDto, SignatureSpellDraftDto, SpellEvaluationDto } from "../../_lib/character-client";
import { authorityLabel, costText, costUnresolvedReason, keywordLabel, rangeText, refName, STATE_LABELS } from "../../_lib/spell-format";

/**
 * The Signature Spell review and cost inspector (PAS-10 M6-WO7 §69–§73, §96–§98). It shows the server's M5 evaluation
 * exactly: the Inspector rows are the M5-WO10 contributions, the ONE net percentage, the unrounded and final MP, PRO,
 * base AP and AP modifiers. Component names link to the Rules Reference of the Character's own Release (§97) — never Latest.
 */
export function ComponentLink({ refDto, release, names }: { refDto: DefinitionRefDto | null | undefined; release: ReleaseSummaryDto; names: Record<string, string> }) {
  if (!refDto) return <span>—</span>;
  return (
    <Link href={entryHref(release.rulesetId, release.id, refDto.entityId)} data-testid="spell-component-link" data-version={refDto.entityVersionId}>
      {refName(names, refDto)}
    </Link>
  );
}

export function SpellStateBadge({ state }: { state: keyof typeof STATE_LABELS }) {
  return (
    <span className={`gov-tag prowess-spell__state prowess-spell__state--${state.toLowerCase()}`} data-testid="spell-state" data-state={state}>
      {STATE_LABELS[state]}
    </span>
  );
}

/** "Final MP" / "Final AP", or "Cost unresolved" with the exact reason — never zero (§128). */
export function SpellCost({ evaluation }: { evaluation: SpellEvaluationDto | null }) {
  const text = costText(evaluation);
  if (text === null)
    return (
      <p className="prowess-spell__cost" data-testid="spell-cost" data-resolved="false">
        <strong>Cost unresolved</strong> — {costUnresolvedReason(evaluation)}
      </p>
    );
  return (
    <p className="prowess-spell__cost" data-testid="spell-cost" data-resolved="true">
      <strong data-testid="spell-final-mp">{evaluation!.cost!.finalMp} MP</strong> · <strong data-testid="spell-final-ap">{evaluation!.cost!.finalAp} AP</strong>
      <span className="gov-muted"> — Spell Cost: {evaluation!.cost!.finalMp} MP; current ME may pay part during casting (ME never changes the listed cost).</span>
    </p>
  );
}

export function RuntimeWarnings({ evaluation }: { evaluation: SpellEvaluationDto | null }) {
  if (!evaluation || evaluation.runtime.deferred.length === 0) return null;
  return (
    <ul className="prowess-spell__deferred" aria-label="Runtime deferred" data-testid="spell-runtime-deferred">
      {evaluation.runtime.deferred.map((d) => (
        <li key={d.conflictKey}>
          <strong>Runtime: Deferred</strong> — Reason: <code>{d.conflictKey}</code> {d.message}
        </li>
      ))}
    </ul>
  );
}

/** The M5-WO10 cost breakdown, row by row as the server listed it (§70). */
export function CostInspector({ evaluation, release, names }: { evaluation: SpellEvaluationDto; release: ReleaseSummaryDto; names: Record<string, string> }) {
  const c = evaluation.cost;
  if (c === null) return <p className="gov-muted">No cost breakdown: {costUnresolvedReason(evaluation)}.</p>;
  return (
    <table className="gov-table" data-testid="spell-cost-inspector">
      <caption>Cost breakdown (M5-WO10)</caption>
      <tbody>
        {c.contributions.map((q) => (
          <tr key={`${q.componentKey}/${q.contributionKey}`} data-testid="spell-cost-row">
            <th scope="row">
              {formatEnumLabel(q.source)}: <ComponentLink refDto={q.definition} release={release} names={names} /> <span className="gov-muted">({q.contributionKey})</span>
            </th>
            <td>{q.value} MP</td>
          </tr>
        ))}
        <tr>
          <th scope="row">Base MP</th>
          <td data-testid="spell-base-mp">{c.baseMp} MP</td>
        </tr>
        {c.percentages.map((q, i) => (
          <tr key={`${q.source}-${i}`} data-testid="spell-cost-percentage">
            <th scope="row">
              {formatEnumLabel(q.source)} ({formatEnumLabel(q.operation).toLowerCase()})
            </th>
            <td>
              {q.percent}%{q.applied ? "" : " (not applied)"}
            </td>
          </tr>
        ))}
        <tr>
          <th scope="row">Casting Conditions (listed / effective, cap {c.castingConditions.maximumPercent}%)</th>
          <td>
            {c.castingConditions.listedPercent}% / {c.castingConditions.effectivePercent}%
          </td>
        </tr>
        <tr>
          <th scope="row">Net cost percentage (applied once)</th>
          <td data-testid="spell-net-percent">{c.netPercent}%</td>
        </tr>
        <tr>
          <th scope="row">Unrounded MP</th>
          <td>{c.unroundedMp}</td>
        </tr>
        <tr>
          <th scope="row">Final MP (rounded once)</th>
          <td>{c.finalMp} MP</td>
        </tr>
        <tr>
          <th scope="row">PRO</th>
          <td>{c.pro}</td>
        </tr>
        <tr>
          <th scope="row">Base AP</th>
          <td>{c.baseAp} AP</td>
        </tr>
        {c.apModifiers.map((m, i) => (
          <tr key={i}>
            <th scope="row">AP modifier {m.source ? formatEnumLabel(String(m.source)) : ""}</th>
            <td>{String(m.value ?? "")}</td>
          </tr>
        ))}
        <tr>
          <th scope="row">Final AP</th>
          <td>{c.finalAp} AP</td>
        </tr>
      </tbody>
    </table>
  );
}

/** The full review (§69) — used by the builder's Review step and the Spell detail page. */
export function SpellReview({ draft, evaluation, release, names }: { draft: SignatureSpellDraftDto; evaluation: SpellEvaluationDto | null; release: ReleaseSummaryDto; names: Record<string, string> }) {
  const sig = evaluation?.construction?.signature ?? null;
  const chain = evaluation?.chain ?? null;
  const effectName = (key: string) => {
    const e = draft.effects.find((x) => x.componentKey === key);
    return e ? refName(names, e.definition) : key;
  };
  return (
    <div className="prowess-spell-review" data-testid="spell-review">
      <dl className="prowess-spell-review__facts">
        <dt>Name</dt>
        <dd data-testid="spell-review-name">{draft.concept.name}</dd>
        <dt>State</dt>
        <dd>{evaluation ? <SpellStateBadge state={evaluation.state} /> : <SpellStateBadge state="UNREADABLE" />}</dd>
        <dt>Authority</dt>
        <dd data-testid="spell-review-authority">
          {authorityLabel(draft.authority)}
          {evaluation?.construction?.access.rank ? ` (rank ${formatEnumLabel(evaluation.construction.access.rank)})` : ""}
        </dd>
        <dt>Governing Affinity</dt>
        <dd>{draft.affinity ? <ComponentLink refDto={draft.affinity} release={release} names={names} /> : "None"}</dd>
        <dt>Keywords</dt>
        <dd data-testid="spell-review-keywords">{evaluation && evaluation.keywords.length > 0 ? evaluation.keywords.map(keywordLabel).join(", ") : "—"}</dd>
        <dt>Targeting</dt>
        <dd>
          <ComponentLink refDto={draft.targeting?.definition} release={release} names={names} />
          {evaluation?.targeting?.targetCount ? ` · ${formatEnumLabel(evaluation.targeting.targetCount.kind)} target${evaluation.targeting.targetCount.count === 1 ? "" : "s"}` : ""}
        </dd>
        <dt>Range / Area</dt>
        <dd data-testid="spell-review-range">
          {rangeText(evaluation)}
          {evaluation?.targeting?.geometry.map((g, i) => (
            <span key={i} className="gov-muted">
              {" "}
              · {Object.entries(g)
                .filter(([, v]) => typeof v === "string" || typeof v === "number")
                .map(([k, v]) => `${formatEnumLabel(k)} ${String(v)}`)
                .join(", ")}
            </span>
          ))}
        </dd>
        <dt>Duration</dt>
        <dd>
          <ComponentLink refDto={draft.duration?.definition} release={release} names={names} />
          {draft.duration && Object.keys(draft.duration.parameters).length > 0 ? ` (${Object.entries(draft.duration.parameters).map(([k, v]) => `${k} ${String(v)}`).join(", ")})` : ""}
        </dd>
        <dt>Casting Conditions</dt>
        <dd>
          {draft.castingConditions.length === 0
            ? "None"
            : draft.castingConditions.map((c, i) => (
                <span key={c.componentKey}>
                  {i > 0 ? ", " : ""}
                  <ComponentLink refDto={c.definition} release={release} names={names} />
                </span>
              ))}
        </dd>
        <dt>Signature slot</dt>
        <dd data-testid="spell-review-slots">{sig ? `Used ${sig.usedBefore} / ${sig.capacity ?? "—"} · after finalizing ${sig.projected} / ${sig.capacity ?? "—"} (${formatEnumLabel(sig.slotUse)})` : "Determined once the Spell is complete"}</dd>
        <dt>Sustain</dt>
        <dd data-testid="spell-review-sustain">{evaluation?.runtime.sustain ? `${evaluation.runtime.sustain.mpPerRound ?? "unresolved"} MP and ${evaluation.runtime.sustain.apPerRound} AP per round${evaluation.runtime.sustain.meEligible ? " (ME may pay)" : ""}` : "None"}</dd>
        <dt>Mana Lock</dt>
        <dd data-testid="spell-review-mana-lock">{evaluation?.runtime.manaLock ? <>Runtime: Deferred — Reason: <code>{evaluation.runtime.manaLock.conflictKey}</code> (no reserved amount is invented)</> : "None"}</dd>
        <dt>Concentration</dt>
        <dd>{evaluation?.runtime.concentration ? formatEnumLabel(evaluation.runtime.concentration) : "—"}</dd>
      </dl>
      <SpellCost evaluation={evaluation} />
      <RuntimeWarnings evaluation={evaluation} />
      <section aria-labelledby="spell-review-chain">
        <h4 id="spell-review-chain">Effect Chain (in order)</h4>
        <ol data-testid="spell-review-chain-list">
          {[...draft.effects]
            .sort((a, b) => a.order - b.order)
            .map((e) => {
              const node = chain?.nodes.find((n) => n.effectKey === e.componentKey);
              return (
                <li key={e.componentKey} data-testid="spell-review-effect" data-effect={e.componentKey}>
                  <ComponentLink refDto={e.definition} release={release} names={names} />
                  {Object.keys(e.parameters).length > 0 ? <span className="gov-muted"> ({Object.entries(e.parameters).map(([k, v]) => `${k} ${String(v)}`).join(", ")})</span> : null}
                  {node ? (
                    <span>
                      {" "}
                      — {formatEnumLabel(node.resolution ?? "none")}; then <strong>{formatEnumLabel(node.behavior)}</strong>
                      {node.behaviorSource === "RULED_DEFAULT" ? " (ruled default)" : ""}
                      {node.branch ? ` (success → ${effectName(String(node.branch.success ?? "—"))}, failure → ${effectName(String(node.branch.failure ?? "—"))})` : ""}
                    </span>
                  ) : null}
                </li>
              );
            })}
        </ol>
        <p className="gov-muted">A later Effect that is not triggered is NOT a failure. The chain is shown, never resolved here.</p>
      </section>
      <section aria-labelledby="spell-review-traits">
        <h4 id="spell-review-traits">Traits</h4>
        {draft.traits.length === 0 ? (
          <p>None</p>
        ) : (
          <ul>
            {draft.traits.map((t) => (
              <li key={t.componentKey} data-testid="spell-review-trait">
                <ComponentLink refDto={t.definition} release={release} names={names} /> — {formatEnumLabel(t.appliesTo.scope)}
                {t.appliesTo.componentKey ? ` on ${t.appliesTo.componentKey.startsWith("effect") ? effectName(t.appliesTo.componentKey) : t.appliesTo.componentKey}` : ""}
                {draft.additionalAffinityTraits.includes(t.componentKey) ? " (requested in additional Affinity Trait capacity)" : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
      {evaluation?.construction ? (
        <section aria-labelledby="spell-review-prereq">
          <h4 id="spell-review-prereq">Prerequisites and Affinity</h4>
          <ul>
            {evaluation.construction.prerequisites.map((p) => (
              <li key={`${p.componentKey}/${p.ruleKey}`}>
                {p.componentKey}: {p.ruleKey} — {p.satisfied ? "met" : "NOT met"}
              </li>
            ))}
            {evaluation.construction.affinityAccess.map((a, i) => (
              <li key={`aa-${i}`}>
                Affinity access for {a.componentKey}: {a.satisfied ? "granted" : "NOT granted"}
              </li>
            ))}
            {evaluation.construction.traitCapacity.affinityAdditional.conflictKey ? (
              <li>
                Additional Affinity Trait capacity: unresolved (<code>{evaluation.construction.traitCapacity.affinityAdditional.conflictKey}</code>) — Affinity Traits may use ordinary or exchanged slots.
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}
      {evaluation ? (
        <details>
          <summary>Inspect cost</summary>
          <CostInspector evaluation={evaluation} release={release} names={names} />
        </details>
      ) : null}
    </div>
  );
}
