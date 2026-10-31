"use client";

import Link from "next/link";
import { formatEnumLabel } from "@prowess/ui";
import { useEffect, useState } from "react";
import { CharacterApiError, getAccess, type AccessDto, type CharacterDto, type HistoryEntryDto, type ProfileDto, type ReleaseSummaryDto } from "../_lib/character-client";
import { RuleLink } from "./CharacterReview";

/**
 * A completed Character's PRESENT mechanical state (PAS-10 M6-WO4 §68, §82–§84): Level, Character Die, Stats (with
 * where every point came from), Skill ranks (with source and history), the Affinity profile, derived values, the
 * construction access summary and the advancement history. Every number is the server's — this component formats the
 * CharacterMechanicalProfile it is given and never calculates a rule.
 */
const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));

export function AdvancementHistory({ history, names }: { history: HistoryEntryDto[]; names: Record<string, string> }) {
  const label = (versionId: string) => names[versionId] ?? versionId;
  if (history.length === 0) return <p className="gov-muted">No advancement yet — this Character is at its creation Level.</p>;
  return (
    <ol className="prowess-character__history" aria-label="Advancement history" data-testid="advancement-history">
      {history.map((h) => (
        <li key={h.toLevel} data-testid={`history-level-${h.toLevel}`}>
          <strong>Level {h.toLevel}</strong>
          <ul>
            {Object.entries(h.statAllocations).map(([stat, points]) => (
              <li key={stat}>
                {signed(points)} {stat}
              </li>
            ))}
            {h.skillAdvancements.map((s) => (
              <li key={s.skill.entityId}>
                {label(s.skill.entityVersionId)} — {s.action === "TRAIN_NEW" ? "new training" : "rank upgrade"}
              </li>
            ))}
            {h.affinityChoice ? (
              <li>
                Affinity: {formatEnumLabel(h.affinityChoice.optionKey)}
                {h.affinityChoice.affinity ? ` (${label(h.affinityChoice.affinity.entityVersionId)})` : ""}
              </li>
            ) : null}
          </ul>
        </li>
      ))}
    </ol>
  );
}

export function ProfileSummary({ profile, release, names }: { profile: ProfileDto; release: ReleaseSummaryDto; names: Record<string, string> }) {
  const name = (versionId: string, fallback: string) => names[versionId] ?? fallback;
  return (
    <div data-testid="character-profile">
      <dl className="gov-dl">
        <dt>Level</dt>
        <dd data-testid="profile-level">
          {profile.level} of {profile.maximumLevel}
        </dd>
        <dt>Character Die</dt>
        <dd data-testid="profile-die">
          {formatEnumLabel(profile.characterDie.dieKey)} (d{profile.characterDie.faces})
        </dd>
      </dl>
      <h3>Stats</h3>
      <table className="prowess-reference__table" aria-label="Present Stats">
        <thead>
          <tr>
            <th scope="col">Stat</th>
            <th scope="col">Base</th>
            <th scope="col">Ancestry</th>
            <th scope="col">Creation</th>
            <th scope="col">Advancement</th>
            <th scope="col">Final</th>
          </tr>
        </thead>
        <tbody>
          {profile.stats.map((s) => (
            <tr key={s.stat}>
              <th scope="row">{s.stat}</th>
              <td>{s.baseline}</td>
              <td>{signed(s.ancestry)}</td>
              <td>{signed(s.creation)}</td>
              <td>{signed(s.advancement)}</td>
              <td data-testid={`profile-final-${s.stat}`}>
                {s.final}
                {s.mastery ? <span className="gov-tag"> Stat Mastery</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Skills</h3>
      <ul className="gov-list" aria-label="Skill ranks">
        {profile.skills.map((s) => (
          <li key={s.skill.entityId} data-testid="profile-skill">
            <RuleLink release={release} refDto={s.skill} label={name(s.skill.entityVersionId, s.skill.canonicalKey)} /> — {formatEnumLabel(s.rankKey)}{" "}
            <span className="gov-muted">({s.source.kind === "ADVANCEMENT" ? `trained at Level ${s.source.level}` : s.source.kind === "FREE" ? "creation, free training" : "creation, Ancestry"})</span>
          </li>
        ))}
      </ul>
      <h3>Affinities</h3>
      <ul className="gov-list" aria-label="Affinity profile">
        {profile.affinities.map((a) => (
          <li key={a.affinity.entityId} data-testid="profile-affinity">
            <RuleLink release={release} refDto={a.affinity} label={name(a.affinity.entityVersionId, a.affinity.canonicalKey)} /> — {formatEnumLabel(a.role)}, {formatEnumLabel(a.rank)}{" "}
            <span className="gov-muted">(since Level {a.acquisition.level})</span>
          </li>
        ))}
      </ul>
      <h3>Derived statistics</h3>
      <dl className="gov-dl">
        {profile.derivedStatistics.map((d) => (
          <div key={d.statistic} style={{ display: "contents" }}>
            <dt>{formatEnumLabel(d.statistic)}</dt>
            <dd data-testid={`profile-derived-${d.statistic}`}>{d.value}</dd>
          </div>
        ))}
      </dl>
      <p className="gov-muted">Recalculated by the server from this Character&apos;s choices and its exact Release — never stored.</p>
    </div>
  );
}

export function AccessPanel({ characterId, level }: { characterId: string; level: number }) {
  const [access, setAccess] = useState<AccessDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getAccess(characterId).then(
      (a) => live && setAccess(a),
      (e: unknown) => live && setError(e instanceof CharacterApiError ? `${e.message} (${e.code})` : "Could not load access."),
    );
    return () => {
      live = false;
    };
  }, [characterId, level]);
  if (error !== null) return <p className="gov-error">{error}</p>;
  if (access === null) return <p role="status">Loading access…</p>;
  const s = access.summary;
  const yes = (v: boolean | null) => (v === null ? "Unresolved" : v ? "Available" : "Locked");
  return (
    <section className="gov-panel" aria-labelledby="access-heading" data-testid="access-summary">
      <h2 id="access-heading">Access</h2>
      {s.status === "UNRESOLVED" ? <p className="gov-bad">Some access could not be resolved from this Release: {s.unresolved.join("; ")}</p> : null}
      <dl className="gov-dl">
        <dt>Spell construction — Arcane Authority</dt>
        <dd data-testid="access-arcane">{s.spell.arcaneAuthority ? `${formatEnumLabel(s.spell.arcaneAuthority.rankKey)} (needs ${formatEnumLabel(s.spell.arcaneAuthority.minimumRankKey)}) — ${yes(s.spell.arcaneAuthority.eligible)}` : "—"}</dd>
        <dt>Spell construction — Affinity Authority</dt>
        <dd>
          <ul className="gov-list">
            {s.spell.affinityAuthorities.map((a) => (
              <li key={a.affinity.entityId} data-testid="access-affinity">
                {a.affinity.canonicalKey} — {formatEnumLabel(a.rank)} (needs {formatEnumLabel(a.minimumRank)}) — {yes(a.eligible)}
              </li>
            ))}
          </ul>
        </dd>
        <dt>Maneuver construction — Martial</dt>
        <dd data-testid="access-martial">{s.maneuver.martial ? `${formatEnumLabel(s.maneuver.martial.rankKey)} (needs ${formatEnumLabel(s.maneuver.martial.minimumRankKey)}) — ${yes(s.maneuver.martial.eligible)}` : "—"}</dd>
        <dt>Signature Ability capacity</dt>
        <dd data-testid="access-signature">{s.signatureCapacity ?? "—"}</dd>
      </dl>
      <p className="gov-muted">Access shows what this Character may build from; a finished Spell or Maneuver is still checked in full by the Ability builders.</p>
    </section>
  );
}

export function CharacterProgress({ character }: { character: CharacterDto }) {
  const profile = character.profile ?? null;
  if (profile === null) {
    return (character.profileIssues ?? []).length > 0 ? (
      <p className="gov-bad" role="alert" data-testid="profile-issues">
        This Character&apos;s present state cannot be rebuilt from its Release: {(character.profileIssues ?? []).map((i) => i.message).join("; ")}
      </p>
    ) : null;
  }
  const atMax = profile.level >= profile.maximumLevel;
  const canAdvance = (character.advancementCapability?.status ?? "") === "ADVANCEMENT_READY";
  return (
    <section className="gov-panel" aria-labelledby="progress-heading">
      <h2 id="progress-heading">Present Character</h2>
      <p className="gov-actions">
        {atMax ? (
          <span className="gov-tag" data-testid="max-level">
            Maximum Level Reached
          </span>
        ) : canAdvance ? (
          <Link className="gov-button gov-button--primary" href={`/characters/${encodeURIComponent(character.id)}/advance`}>
            Advance Character
          </Link>
        ) : (
          <span className="gov-muted">This Character&apos;s Release does not define advancement: {(character.advancementCapability?.missing ?? []).map((m) => m.requirement).join(", ")}</span>
        )}
      </p>
      <ProfileSummary profile={profile} release={character.release} names={character.names} />
      <AccessPanel characterId={character.id} level={profile.level} />
      <h2>Advancement history</h2>
      <AdvancementHistory history={character.advancementHistory ?? []} names={character.names} />
    </section>
  );
}
