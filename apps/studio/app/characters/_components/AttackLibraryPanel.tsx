"use client";

import { formatEnumLabel } from "@prowess/ui";
import { useCallback, useEffect, useState } from "react";
import { CharacterApiError, getAttacks, type CharacterAttackDto, type CharacterAttacksDto } from "../_lib/character-client";
import { accuracyText, damageText, movePropertiesText, propertyText, rangeText, resolutionText } from "../_lib/weapon-format";

/**
 * The Character Attack Library view with the Weapon damage inspector (PAS-10 M6-WO6 §79–§82, §148). Every value is the
 * server's preview from the Character's exact Release; the inspector lists the server's own steps — Weapon → Attack →
 * base damage → scaling → STR → effective Power → final dice — and says so explicitly for static damage. Nothing is
 * rolled, spent or recomputed here.
 */
function Inspector({ a, names }: { a: CharacterAttackDto; names: Record<string, string> }) {
  return (
    <details className="prowess-attack__inspector" data-testid="attack-inspector">
      <summary>Inspect damage</summary>
      <ol>
        <li>
          Weapon: <strong>{names[a.weapon.entityVersionId] ?? a.weapon.canonicalKey}</strong> <code>{a.weapon.entityVersionId.slice(0, 8)}</code>
        </li>
        <li>
          Attack: <strong>{names[a.attack.entityVersionId] ?? a.attack.canonicalKey}</strong> <code>{a.attack.entityVersionId.slice(0, 8)}</code>
        </li>
        {a.damage.map((d) => (
          <li key={d.profileKey}>
            {formatEnumLabel(d.damageType)}:
            <ul>
              {d.steps.map((s, i) => (
                <li key={i} data-testid="attack-inspector-step" data-step={s.step}>
                  <span className="gov-tag">{formatEnumLabel(s.step)}</span> {s.detail}
                </li>
              ))}
              {d.power !== null ? (
                <li data-testid="attack-inspector-power">
                  {d.power.scalingStat} {d.power.statScore} · Power {d.power.authored}
                  {d.power.adjustment === 0 ? "" : ` → ${d.power.adjusted}`} (minimum {d.power.minimum}) → {d.final?.expression ?? "—"}
                </li>
              ) : null}
              {d.status === "FAIL_CLOSED" ? <li className="gov-error">Not previewed: {d.reason}</li> : null}
            </ul>
          </li>
        ))}
      </ol>
    </details>
  );
}

function AttackTable({ title, attacks, names, testId }: { title: string; attacks: CharacterAttackDto[]; names: Record<string, string>; testId: string }) {
  return (
    <section className="gov-panel" data-testid={testId}>
      <h3>{title}</h3>
      <table className="gov-table">
        <thead>
          <tr>
            <th scope="col">Move</th>
            <th scope="col">AP</th>
            <th scope="col">Damage (preview)</th>
            <th scope="col">Range</th>
            <th scope="col">Resolution</th>
            <th scope="col">Properties</th>
          </tr>
        </thead>
        <tbody>
          {attacks.map((a) => (
            <tr key={a.attackKey} data-testid="library-attack-row" data-move={a.moveKey}>
              <th scope="row">
                {names[a.attack.entityVersionId] ?? formatEnumLabel(a.moveKey)}
                <Inspector a={a} names={names} />
              </th>
              <td>
                {a.apCost}
                {a.mpCost > 0 ? ` + ${a.mpCost} MP` : ""}
              </td>
              <td>{a.damage.map(damageText).join(" / ")}</td>
              <td>{rangeText(a)}</td>
              <td>{resolutionText(a)}</td>
              <td>
                {[movePropertiesText(a), accuracyText(a)].filter((x) => x !== null && x !== "—").join(", ") || "—"}
                {a.notExecuted.length > 0 ? <span className="gov-muted"> · reference only: {a.notExecuted.map((k) => formatEnumLabel(k)).join(", ")}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function AttackLibraryPanel({ characterId }: { characterId: string }) {
  const [data, setData] = useState<CharacterAttacksDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await getAttacks(characterId));
    } catch (e) {
      setError(e instanceof CharacterApiError ? `${e.message} (${e.code})` : "Could not load the Attack Library.");
    }
  }, [characterId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void load();
  }, [load]);
  if (error !== null) return <p className="gov-error" role="alert">{error}</p>;
  if (data === null) return <p role="status">Loading the Attack Library…</p>;
  const { library, names } = data;
  return (
    <div className="prowess-attack-library" data-testid="attack-library">
      <p className="gov-muted">Previews from the Character&apos;s exact Release — nothing is rolled, spent or applied. Martial rank: {library.martialRank ?? "unknown"}.</p>
      {library.capability.attackLibrary.missing.length > 0 ? (
        <ul className="gov-muted" aria-label="Attack Library notes">
          {library.capability.attackLibrary.missing.map((m, i) => (
            <li key={i}>{m.message}</li>
          ))}
        </ul>
      ) : null}
      {library.unarmed !== null ? <AttackTable title={`Unarmed (${formatEnumLabel(library.martialRank ?? "")})`} attacks={library.unarmed.attacks} names={names} testId="library-unarmed" /> : null}
      {library.unarmed?.grantedFeatures.map((g) => (
        <p key={g.featureKey} className="gov-muted" data-testid="library-granted-feature">
          {formatEnumLabel(g.featureKey)} (reference only): {g.summary}
        </p>
      ))}
      {library.mainHand !== null ? <AttackTable title={`Main-hand: ${names[library.mainHand.weapon.entityVersionId] ?? library.mainHand.weapon.canonicalKey}`} attacks={library.mainHand.attacks} names={names} testId="library-main-hand" /> : null}
      {library.offHand !== null ? <AttackTable title={`Off-hand: ${names[library.offHand.weapon.entityVersionId] ?? library.offHand.weapon.canonicalKey}`} attacks={library.offHand.attacks} names={names} testId="library-off-hand" /> : null}
      <section className="gov-panel" data-testid="library-dual-wield">
        <h3>Dual Wielding</h3>
        {library.dualWield.available ? (
          <table className="gov-table">
            <thead>
              <tr>
                <th scope="col">Main-hand Move</th>
                <th scope="col">Off-hand Move</th>
                <th scope="col">AP (higher of the two)</th>
                <th scope="col">Damage (first sequence)</th>
              </tr>
            </thead>
            <tbody>
              {library.dualWield.sequences.map((s) => (
                <tr key={`${s.attacks[0].attackKey}+${s.attacks[1].attackKey}`} data-testid="library-dual-row">
                  <td>{names[s.attacks[0].attack.entityVersionId] ?? s.attacks[0].moveKey}</td>
                  <td>{names[s.attacks[1].attack.entityVersionId] ?? s.attacks[1].moveKey}</td>
                  <td>{s.apCost}</td>
                  <td>
                    {damageText(s.attacks[0].damage[0] as CharacterAttackDto["damage"][number])} + {damageText(s.attacks[1].damage[0] as CharacterAttackDto["damage"][number])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="gov-muted">Not available: {library.dualWield.reasons.join("; ") || "no second Weapon"}.</p>
        )}
      </section>
      {library.mainHand !== null && library.mainHand.attacks[0] !== undefined ? (
        <p className="gov-muted">Weapon properties: {library.mainHand.attacks[0].weaponProperties.map(propertyText).join(", ") || "none"}.</p>
      ) : null}
    </div>
  );
}
