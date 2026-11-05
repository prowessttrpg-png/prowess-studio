"use client";

import { formatEnumLabel } from "@prowess/ui";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CharacterApiError, getAbilities, type CharacterAbilitiesDto } from "../../_lib/character-client";
import { authorityLabel, keywordLabel, refName, resolvedCost, shownOf, STATUS_LABELS } from "../../_lib/spell-format";
import { RuntimeWarnings, SpellStateBadge } from "./SpellReview";
import { ManeuverRoster } from "../maneuvers/ManeuverRoster";

/**
 * The Character's Abilities view (PAS-10 M6-WO7 §20, §93): the Signature roster. WO7 shows Signature Spells; every value is
 * the server's M5 evaluation of the Spell's current revision (else its draft). Drafts use no Signature slot (M6-I089).
 */
export function AbilitiesPanel({ characterId }: { characterId: string }) {
  const [data, setData] = useState<CharacterAbilitiesDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await getAbilities(characterId));
    } catch (e) {
      setError(e instanceof CharacterApiError ? `${e.message} (${e.code})` : "Could not load the Character's Abilities.");
    }
  }, [characterId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void load();
  }, [load]);
  if (error !== null) return <p className="gov-error" role="alert">{error}</p>;
  if (data === null) return <p role="status">Loading Abilities…</p>;
  const id = encodeURIComponent(characterId);
  const active = data.spells.filter((s) => s.status !== "RETIRED");
  const retired = data.spells.filter((s) => s.status === "RETIRED");
  return (
    <section className="gov-panel prowess-abilities" aria-labelledby="abilities-heading" data-testid="abilities-panel">
      <h2 id="abilities-heading">Signature Abilities</h2>
      <h3>Signature Spells</h3>
      <p data-testid="abilities-signature-slots">
        Signature slots used: <strong>{data.signature.used}</strong> / {data.signature.capacity ?? "—"}
        <span className="gov-muted"> — finalized Signature Abilities share this capacity; drafts use none.</span>
      </p>
      <p className="gov-actions">
        <Link className="gov-button gov-button--primary" href={`/characters/${id}/spells/new`} data-testid="abilities-new-spell">
          New Signature Spell
        </Link>
      </p>
      {active.length === 0 ? (
        <p className="gov-muted">No Signature Spells yet.</p>
      ) : (
        <table className="gov-table" data-testid="abilities-spell-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Authority</th>
              <th scope="col">Affinity</th>
              <th scope="col">AP</th>
              <th scope="col">MP</th>
              <th scope="col">Targeting</th>
              <th scope="col">Duration</th>
              <th scope="col">Keywords</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {active.map((s) => {
              const { draft, evaluation } = shownOf(s);
              return (
                <tr key={s.id} data-testid="abilities-spell-row" data-status={s.status}>
                  <th scope="row">
                    <Link href={`/characters/${id}/spells/${encodeURIComponent(s.id)}`}>{draft?.concept.name ?? "Unreadable Spell"}</Link>
                    {s.status === "ACTIVE" && s.draft !== null ? <span className="gov-muted"> (rebuild in progress)</span> : null}
                    <RuntimeWarnings evaluation={evaluation} />
                  </th>
                  <td>{authorityLabel(draft?.authority ?? null)}</td>
                  <td>{draft?.affinity ? refName(data.names, draft.affinity) : "—"}</td>
                  <td data-testid="abilities-spell-ap">{resolvedCost(evaluation)?.finalApCost ?? "Unresolved"}</td>
                  <td data-testid="abilities-spell-mp">{resolvedCost(evaluation)?.finalMpCost ?? "Unresolved"}</td>
                  <td>{draft?.targeting ? refName(data.names, draft.targeting.definition) : "—"}</td>
                  <td>{draft?.duration ? refName(data.names, draft.duration.definition) : "—"}</td>
                  <td>{evaluation && evaluation.keywords.length > 0 ? evaluation.keywords.slice(0, 4).map(keywordLabel).join(", ") : "—"}</td>
                  <td>
                    <span className="gov-tag" data-testid="abilities-spell-status">
                      {STATUS_LABELS[s.status]}
                    </span>{" "}
                    <SpellStateBadge state={s.state} />
                    {s.current ? <span className="gov-muted"> Revision {s.current.revisionNumber}</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <ManeuverRoster characterId={characterId} entries={data.maneuvers ?? []} names={data.names} />
      {retired.length > 0 ? (
        <details data-testid="abilities-retired">
          <summary>Retired Spells ({retired.length})</summary>
          <ul>
            {retired.map((s) => (
              <li key={s.id}>
                <Link href={`/characters/${id}/spells/${encodeURIComponent(s.id)}`}>{shownOf(s).draft?.concept.name ?? "Unreadable Spell"}</Link> — {formatEnumLabel(s.status)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
