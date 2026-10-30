"use client";

import Link from "next/link";
import { formatEnumLabel } from "@prowess/ui";
import { entryHref } from "../../compendium/rulesets/_lib/reference-urls";
import type { DefinitionRefDto, ReleaseSummaryDto, ResolutionDto } from "../_lib/character-client";

/**
 * The Character review (PAS-10 M6-WO3 §64): Release, Ancestry, final Stats, starting Skills, Primary Affinity,
 * Character Die and the derived statistics — every number as the SERVER resolved it from the Character's exact
 * Release (this component formats, it never calculates). Every rule links to its exact Release Rules Reference page.
 */
export function releaseLabel(r: ReleaseSummaryDto): string {
  return `${r.rulesetName} — Release ${r.releaseNumber} (${r.versionLabel})`;
}

export function RuleLink({ release, refDto, label }: { release: ReleaseSummaryDto; refDto: DefinitionRefDto; label: string }) {
  return (
    <Link href={entryHref(release.rulesetId, release.id, refDto.entityId)} className="prowess-character__rule-link">
      {label}
    </Link>
  );
}

export function CharacterReview({ release, resolution, names, level }: { release: ReleaseSummaryDto; resolution: ResolutionDto; names: Record<string, string>; level: number }) {
  const r = resolution.resolved;
  const name = (ref: DefinitionRefDto | null) => (ref === null ? "—" : (names[ref.entityVersionId] ?? ref.canonicalKey));
  return (
    <section className="gov-panel prowess-character__review" aria-labelledby="character-review-heading" data-testid="character-review">
      <h2 id="character-review-heading">Review</h2>
      <dl className="gov-dl">
        <dt>Release</dt>
        <dd data-testid="character-release">{releaseLabel(release)}</dd>
        <dt>Level</dt>
        <dd>{level}</dd>
        <dt>Character Die</dt>
        <dd>{r.characterDie ? `${formatEnumLabel(r.characterDie.dieKey)} (d${r.characterDie.faces})` : "—"}</dd>
        <dt>Race / Ancestry</dt>
        <dd data-testid="review-ancestry">{r.ancestry ? <RuleLink release={release} refDto={r.ancestry} label={name(r.ancestry)} /> : "Not chosen"}</dd>
        <dt>Primary Affinity</dt>
        <dd data-testid="review-affinity">{r.primaryAffinity ? <RuleLink release={release} refDto={r.primaryAffinity} label={name(r.primaryAffinity)} /> : "Not chosen"}</dd>
      </dl>
      <h3>Stats</h3>
      <table className="prowess-reference__table" data-testid="review-stats">
        <thead>
          <tr>
            <th scope="col">Stat</th>
            <th scope="col">Base</th>
            <th scope="col">Ancestry</th>
            <th scope="col">Allocated</th>
            <th scope="col">Final</th>
          </tr>
        </thead>
        <tbody>
          {r.stats.map((s) => (
            <tr key={s.stat}>
              <th scope="row">{s.stat}</th>
              <td>{s.baseline}</td>
              <td>{s.ancestry >= 0 ? `+${s.ancestry}` : s.ancestry}</td>
              <td>+{s.allocated}</td>
              <td data-testid={`final-${s.stat}`}>{s.final}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Starting Skills</h3>
      {r.skills.length === 0 ? <p className="gov-muted">None chosen yet.</p> : null}
      <ul className="gov-list" aria-label="Starting Skills">
        {r.skills.map((s) => (
          <li key={s.skill.entityId}>
            <RuleLink release={release} refDto={s.skill} label={name(s.skill)} /> — {formatEnumLabel(s.rankKey)} <span className="gov-tag">{s.sourceKind === "FREE" ? "Free training" : `Ancestry (${s.sourceGrantKey ?? ""})`}</span>
          </li>
        ))}
      </ul>
      <h3>Derived statistics</h3>
      {resolution.derivedPreview === null ? (
        <p className="gov-muted">Derived statistics appear once the Ancestry and Stats are legal.</p>
      ) : (
        <dl className="gov-dl" data-testid="derived-preview">
          {resolution.derivedPreview.map((d) => (
            <div key={d.statistic} style={{ display: "contents" }}>
              <dt>{formatEnumLabel(d.statistic)}</dt>
              <dd data-testid={`derived-${d.statistic}`}>
                {d.value}
                {d.unit ? ` ${d.unit}` : ""}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p className="gov-muted">
        Calculated by the server from this Character&apos;s choices and the exact Derived Stat rules of {releaseLabel(release)} — never stored, so they cannot drift. Signature Ability capacity is shown
        here; Signature Abilities themselves, Equipment and Ability selection are completed in later M6 systems.
      </p>
    </section>
  );
}
