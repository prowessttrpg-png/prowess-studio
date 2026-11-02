"use client";

import { EmptyState, formatEnumLabel } from "@prowess/ui";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorState } from "../../_components/ErrorState";
import { LoadingState } from "../../_components/LoadingState";
import { ReferenceApiError, getWeaponLibrary, type ReferenceAttackDto, type ReferenceTraitUseDto, type ReferenceWeaponDto, type ReferenceWeaponLibraryDto } from "../_lib/reference-client";
import { attackHref, entryHref, releaseHref, releaseName, rulesReferenceHref, rulesetReferenceHref, weaponHref, weaponLibraryHref } from "../_lib/reference-urls";

/**
 * The Weapon & Attack Library of ONE exact Release (PAS-10 M6-WO6 §89–§91, §94). Everything shown is the pinned
 * revision's authored data, read through the server (exact Moveset refs, coherence, capability). Nothing is scaled,
 * computed or resolved here: dice and ranges are shown as AUTHORED (e.g. "1d8", "30 ft × PER"); Character-specific
 * previews live on the Character. Filters only narrow the list.
 */

const dice = (d: { count: number; sides: number }) => `${d.count}d${d.sides}`;
/** Structured requirements as text: a Martial rank or a Stat minimum (never raw JSON). */
const requirementsText = (rows: ReadonlyArray<Record<string, unknown>>) =>
  rows.map((r) => (r.kind === "MARTIAL_RANK_AT_LEAST" ? `Martial ${formatEnumLabel(String(r.minimumRank ?? ""))}` : `${String(r.stat ?? "")} ${String(r.minimum ?? "")}`)).join(", ");
export const authoredDamage = (a: ReferenceAttackDto) => a.payload.damageProfiles.map((p) => `${dice(p.dice)} ${formatEnumLabel(p.damageType)}`).join(" / ");
export function authoredRange(a: ReferenceAttackDto): string {
  const t = a.payload.targeting;
  switch (t.mode) {
    case "MELEE":
      return `Melee ${t.reachFeet ?? ""} ft`;
    case "CLOSE":
      return `Close ${t.reachFeet ?? ""} ft`;
    case "RANGED_MULTIPLIER":
      return `${t.feetPerPoint ?? ""} ft × ${t.stat ?? ""}${t.area ? `, Blast ${t.area.radiusFeet} ft` : ""}`;
    case "LINE":
      return `${t.lengthFeet ?? ""}-ft Line`;
    case "CONE":
      return `${t.lengthFeet ?? ""}-ft Cone`;
    default:
      return formatEnumLabel(t.mode);
  }
}
export function authoredResolution(a: ReferenceAttackDto): string {
  const r = a.payload.resolution;
  if (r.mode === "SAVING_THROW") return `${r.savingThrowStat ?? ""} Save vs attacker Character DC — ${formatEnumLabel(r.onFailure ?? "")} on a failure, ${formatEnumLabel(r.onSuccess ?? "")} on a success`;
  if (r.mode === "ATTACK_ROLL") return r.onMiss && r.onMiss !== "NO_DAMAGE" ? `Attack Roll — ${formatEnumLabel(r.onMiss)} damage on a miss` : "Attack Roll";
  return `Not yet defined — ${r.reason ?? ""}`;
}
export const traitText = (u: ReferenceTraitUseDto) => {
  const values = Object.keys(u.parameters)
    .sort()
    .map((k) => u.parameters[k]);
  return `${u.displayName}${values.length === 0 ? "" : ` ${values.join("/")}`}`;
};
export const scalingText = (w: ReferenceWeaponDto) => (w.payload.scalingModel === "STATIC" ? "Static (no Power)" : w.payload.power === null ? formatEnumLabel(w.payload.scalingModel) : `${formatEnumLabel(w.payload.scalingModel)} · Power ${w.payload.power}`);

/** Shared loader: the exact Release's library (one request). */
export function useWeaponLibrary(rulesetId: string, releaseId: string) {
  const [data, setData] = useState<ReferenceWeaponLibraryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await getWeaponLibrary(rulesetId, releaseId));
    } catch (e) {
      setError(e instanceof ReferenceApiError ? `${e.message} (${e.code})` : "Could not load the Weapon Library.");
    }
  }, [rulesetId, releaseId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void load();
  }, [load]);
  return { data, error, load };
}

export function LibraryCrumbs({ data, rulesetId, releaseId, here }: { data: ReferenceWeaponLibraryDto; rulesetId: string; releaseId: string; here: string | null }) {
  return (
    <nav className="gov-crumbs" aria-label="Breadcrumb">
      <Link href={rulesReferenceHref()}>Rules Reference</Link> / <Link href={rulesetReferenceHref(rulesetId)}>{data.ruleset.name}</Link> / <Link href={releaseHref(rulesetId, releaseId)}>{releaseName(data.release)}</Link> /{" "}
      {here === null ? <span aria-current="page">Weapon Library</span> : <Link href={weaponLibraryHref(rulesetId, releaseId)}>Weapon Library</Link>}
      {here !== null ? (
        <>
          {" "}
          / <span aria-current="page">{here}</span>
        </>
      ) : null}
    </nav>
  );
}

interface Filters {
  category: string;
  family: string;
  scaling: string;
  handedness: string;
  property: string;
  damageType: string;
  reach: string;
}
const EMPTY: Filters = { category: "", family: "", scaling: "", handedness: "", property: "", damageType: "", reach: "" };
const isRanged = (w: ReferenceWeaponDto) => w.moveset.some((a) => a.payload.targeting.mode !== "MELEE" && a.payload.targeting.mode !== "CLOSE");
const isMelee = (w: ReferenceWeaponDto) => w.moveset.some((a) => a.payload.targeting.mode === "MELEE" || a.payload.targeting.mode === "CLOSE");

export function WeaponLibrary({ rulesetId, releaseId }: { rulesetId: string; releaseId: string }) {
  const { data, error, load } = useWeaponLibrary(rulesetId, releaseId);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const options = useMemo(() => {
    const w = data?.weapons ?? [];
    const uniq = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => x !== null))].sort();
    return {
      category: uniq(w.map((x) => x.payload.category)),
      family: uniq(w.map((x) => x.payload.familyKey)),
      scaling: uniq(w.map((x) => x.payload.scalingModel)),
      handedness: uniq(w.map((x) => x.payload.handedness)),
      property: uniq(w.flatMap((x) => [...x.weaponProperties, ...x.moveset.flatMap((a) => a.moveProperties)].map((u) => u.traitKey))),
      damageType: uniq(w.flatMap((x) => x.moveset.flatMap((a) => a.payload.damageProfiles.map((p) => p.damageType)))),
    };
  }, [data]);
  if (error !== null) return <ErrorState message={error} onRetry={() => void load()} />;
  if (data === null) return <LoadingState label="Loading the Weapon Library…" />;
  const shown = data.weapons.filter(
    (w) =>
      (filters.category === "" || w.payload.category === filters.category) &&
      (filters.family === "" || w.payload.familyKey === filters.family) &&
      (filters.scaling === "" || w.payload.scalingModel === filters.scaling) &&
      (filters.handedness === "" || w.payload.handedness === filters.handedness) &&
      (filters.property === "" || [...w.weaponProperties, ...w.moveset.flatMap((a) => a.moveProperties)].some((u) => u.traitKey === filters.property)) &&
      (filters.damageType === "" || w.moveset.some((a) => a.payload.damageProfiles.some((p) => p.damageType === filters.damageType))) &&
      (filters.reach === "" || (filters.reach === "RANGED" ? isRanged(w) : isMelee(w))),
  );
  const select = (key: keyof Filters, label: string, values: readonly string[]) => (
    <label className="gov-field">
      <span>{label}</span>
      <select value={filters[key]} onChange={(e) => setFilters({ ...filters, [key]: e.target.value })} data-testid={`weapon-filter-${key}`}>
        <option value="">Any</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {formatEnumLabel(v)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="prowess-reference" data-testid="weapon-library">
      <LibraryCrumbs data={data} rulesetId={rulesetId} releaseId={releaseId} here={null} />
      <header className="prowess-reference__header">
        <p className="gov-eyebrow">Rules Reference — {data.ruleset.name}</p>
        <h1>Weapon Library — {releaseName(data.release)}</h1>
        <p className="gov-meta">
          <span className="gov-tag" data-testid="weapon-library-status">
            {formatEnumLabel(data.capability.weaponLibrary.status)}
          </span>
          <span className="gov-tag">{data.weapons.length} Weapon profiles</span>
          <span className="gov-tag">{data.traits.length} Equipment Traits</span>
        </p>
        <p className="gov-muted">Exactly what this Release pins. Damage and ranges are shown as authored; a Character&apos;s own previews (STR, Power, grip) are on its sheet.</p>
      </header>
      <section className="prowess-reference__filters" aria-label="Weapon filters">
        {select("category", "Category", options.category)}
        {select("family", "Weapon family", options.family)}
        {select("scaling", "Scaling", options.scaling)}
        {select("handedness", "Handedness", options.handedness)}
        {select("property", "Property", options.property)}
        {select("damageType", "Damage type", options.damageType)}
        {select("reach", "Melee / ranged", ["MELEE", "RANGED"])}
        <button type="button" className="gov-link-button" onClick={() => setFilters(EMPTY)}>
          Clear filters
        </button>
      </section>
      {data.issues.length > 0 ? (
        <ul className="gov-error" aria-label="Library issues">
          {data.issues.map((i, n) => (
            <li key={n}>{i.message}</li>
          ))}
        </ul>
      ) : null}
      {shown.length === 0 ? (
        <EmptyState title="No Weapons match" description="This Release pins no Weapon profile matching these filters." />
      ) : (
        <table className="gov-table" data-testid="weapon-library-table">
          <thead>
            <tr>
              <th scope="col">Weapon</th>
              <th scope="col">Category</th>
              <th scope="col">Handedness</th>
              <th scope="col">Scaling</th>
              <th scope="col">Properties</th>
              <th scope="col">Moves</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((w) => (
              <tr key={w.weapon.entityVersionId} data-testid="weapon-library-row" data-family={w.payload.familyKey}>
                <th scope="row">
                  <Link href={weaponHref(rulesetId, releaseId, w.weapon.entityId)}>{w.displayName}</Link>
                  {w.payload.profileKind !== "STANDARD" ? <span className="gov-tag">{formatEnumLabel(w.payload.profileKind)}</span> : null}
                  {w.payload.equipmentRole === "SHIELD" ? <span className="gov-tag">Shield</span> : null}
                </th>
                <td>{w.payload.category === null ? "—" : formatEnumLabel(w.payload.category)}</td>
                <td>{w.payload.handedness === null ? "Not authored" : formatEnumLabel(w.payload.handedness)}</td>
                <td>{scalingText(w)}</td>
                <td>{w.weaponProperties.map(traitText).join(", ") || "—"}</td>
                <td>
                  {w.moveset.map((a, i) => (
                    <span key={a.attack.entityVersionId}>
                      {i === 0 ? "" : ", "}
                      <Link href={attackHref(rulesetId, releaseId, a.attack.entityId)}>{a.displayName}</Link> ({a.payload.apCost} AP)
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="gov-muted">
        Each entry is also a Rules Reference entry: <Link href={releaseHref(rulesetId, releaseId)}>browse the whole Release</Link>.
      </p>
    </div>
  );
}

function AttackRows({ attacks, rulesetId, releaseId }: { attacks: readonly ReferenceAttackDto[]; rulesetId: string; releaseId: string }) {
  return (
    <table className="gov-table" data-testid="weapon-moveset">
      <thead>
        <tr>
          <th scope="col">Move</th>
          <th scope="col">AP</th>
          <th scope="col">MP</th>
          <th scope="col">Damage (authored)</th>
          <th scope="col">Range</th>
          <th scope="col">Resolution</th>
          <th scope="col">Move properties</th>
        </tr>
      </thead>
      <tbody>
        {attacks.map((a) => (
          <tr key={a.attack.entityVersionId} data-testid="weapon-moveset-row" data-move={a.payload.moveKey}>
            <th scope="row">
              <Link href={attackHref(rulesetId, releaseId, a.attack.entityId)}>{a.displayName}</Link>
            </th>
            <td>{a.payload.apCost}</td>
            <td>{a.payload.mpCost}</td>
            <td>
              {authoredDamage(a)}
              {a.scaling === "STATIC" ? <span className="gov-muted"> (static)</span> : null}
            </td>
            <td>{authoredRange(a)}</td>
            <td>{authoredResolution(a)}</td>
            <td>
              {[...a.moveProperties.map(traitText), ...(a.payload.accuracyModifier === 0 ? [] : [`Accuracy ${a.payload.accuracyModifier > 0 ? "+" : ""}${a.payload.accuracyModifier}`])].join(", ") || "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function WeaponDetail({ rulesetId, releaseId, entityId }: { rulesetId: string; releaseId: string; entityId: string }) {
  const { data, error, load } = useWeaponLibrary(rulesetId, releaseId);
  if (error !== null) return <ErrorState message={error} onRetry={() => void load()} />;
  if (data === null) return <LoadingState label="Loading the Weapon…" />;
  const w = data.weapons.find((x) => x.weapon.entityId === entityId);
  if (w === undefined) return <EmptyState title="Not a Weapon of this Release" description="This exact Release pins no coherent Weapon with this Entity. Release views never fall back to another revision." />;
  const p = w.payload;
  return (
    <div className="prowess-reference" data-testid="weapon-detail">
      <LibraryCrumbs data={data} rulesetId={rulesetId} releaseId={releaseId} here={w.displayName} />
      <header className="prowess-reference__header">
        <p className="gov-eyebrow">Weapon — {releaseName(data.release)}</p>
        <h1>{w.displayName}</h1>
        <p className="gov-meta">
          <span className="gov-tag">Revision {w.revisionNumber ?? "—"}</span>
          <span className="gov-tag">Family {p.familyKey}</span>
          <span className="gov-tag" data-testid="weapon-detail-scaling">
            {scalingText(w)}
          </span>
        </p>
      </header>
      <dl className="gov-dl">
        <div>
          <dt>Example forms</dt>
          <dd>{p.exampleForms.length === 0 ? "—" : p.exampleForms.join(", ")}</dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>{p.category === null ? "—" : formatEnumLabel(p.category)}</dd>
        </div>
        <div>
          <dt>Handedness</dt>
          <dd>{p.handedness === null ? "Not authored — shown, never equipped" : formatEnumLabel(p.handedness)}</dd>
        </div>
        <div>
          <dt>Requirements</dt>
          <dd data-testid="weapon-detail-requirements">{p.requirements.length === 0 ? "None" : requirementsText(p.requirements)}</dd>
        </div>
        <div>
          <dt>Weapon properties</dt>
          <dd data-testid="weapon-detail-properties">
            {w.weaponProperties.length === 0
              ? "None"
              : w.weaponProperties.map((u) => (
                  <span key={u.trait.entityVersionId} className="gov-tag" title={u.summary}>
                    {traitText(u)}
                    {u.executionStatus === "EXECUTABLE" ? "" : " (reference only)"}
                  </span>
                ))}
          </dd>
        </div>
        {p.equippedModifiers.length > 0 ? (
          <div>
            <dt>While equipped</dt>
            <dd data-testid="weapon-detail-modifiers">{p.equippedModifiers.map((m) => `${formatEnumLabel(m.target)} ${m.value > 0 ? "+" : ""}${m.value}`).join(", ")}</dd>
          </div>
        ) : null}
        {p.grantedFeatures.length > 0 ? (
          <div>
            <dt>Granted features</dt>
            <dd>{p.grantedFeatures.map((g) => `${formatEnumLabel(g.featureKey)} (reference only): ${g.summary}`).join(" ")}</dd>
          </div>
        ) : null}
        <div>
          <dt>Source</dt>
          <dd>{[...p.source.locators, ...p.source.designerAuthority].join(", ") || "—"}</dd>
        </div>
      </dl>
      <h2>Moveset</h2>
      <AttackRows attacks={w.moveset} rulesetId={rulesetId} releaseId={releaseId} />
      <p className="gov-muted">
        <Link href={entryHref(rulesetId, releaseId, w.weapon.entityId)}>Rules Reference entry (all authored data, references and provenance)</Link>
      </p>
    </div>
  );
}

export function AttackDetail({ rulesetId, releaseId, entityId }: { rulesetId: string; releaseId: string; entityId: string }) {
  const { data, error, load } = useWeaponLibrary(rulesetId, releaseId);
  if (error !== null) return <ErrorState message={error} onRetry={() => void load()} />;
  if (data === null) return <LoadingState label="Loading the Attack…" />;
  const a = data.weapons.flatMap((w) => w.moveset).find((x) => x.attack.entityId === entityId);
  if (a === undefined) return <EmptyState title="Not an Attack of this Release" description="No coherent Weapon of this exact Release names this Attack in its Moveset." />;
  const p = a.payload;
  return (
    <div className="prowess-reference" data-testid="attack-detail">
      <LibraryCrumbs data={data} rulesetId={rulesetId} releaseId={releaseId} here={a.displayName} />
      <header className="prowess-reference__header">
        <p className="gov-eyebrow">Attack — {releaseName(data.release)}</p>
        <h1>{a.displayName}</h1>
        <p className="gov-meta">
          <span className="gov-tag">Revision {a.revisionNumber ?? "—"}</span>
          <span className="gov-tag">Move {p.moveKey}</span>
          <span className="gov-tag">{a.scaling === "STATIC" ? "Static damage" : "Power-scaled"}</span>
        </p>
      </header>
      <dl className="gov-dl">
        <div>
          <dt>Weapon</dt>
          <dd data-testid="attack-detail-weapons">
            {a.weapons.map((w, i) => (
              <span key={w.weapon.entityVersionId}>
                {i === 0 ? "" : ", "}
                <Link href={weaponHref(rulesetId, releaseId, w.weapon.entityId)}>{w.displayName}</Link>
              </span>
            ))}
          </dd>
        </div>
        <div>
          <dt>AP / MP</dt>
          <dd data-testid="attack-detail-cost">
            {p.apCost} AP{p.mpCost > 0 ? ` + ${p.mpCost} MP` : ""}
          </dd>
        </div>
        <div>
          <dt>Damage (authored)</dt>
          <dd data-testid="attack-detail-damage">{authoredDamage(a)}</dd>
        </div>
        <div>
          <dt>Scaling</dt>
          <dd>{a.scaling === "STATIC" ? "Static — STR scaling never applies" : "Power — the Character's STR and the Weapon's Power scale the full dice expression"}</dd>
        </div>
        <div>
          <dt>Targeting / range</dt>
          <dd data-testid="attack-detail-range">{authoredRange(a)}</dd>
        </div>
        <div>
          <dt>Resolution</dt>
          <dd data-testid="attack-detail-resolution">{authoredResolution(a)}</dd>
        </div>
        <div>
          <dt>Accuracy</dt>
          <dd>{p.accuracyModifier === 0 ? "No adjustment" : `${p.accuracyModifier > 0 ? "+" : ""}${p.accuracyModifier}`}</dd>
        </div>
        <div>
          <dt>Move properties</dt>
          <dd>{a.moveProperties.length === 0 ? "None" : a.moveProperties.map((u) => `${traitText(u)}${u.executionStatus === "EXECUTABLE" ? "" : " (reference only)"}`).join(", ")}</dd>
        </div>
        <div>
          <dt>Requirements</dt>
          <dd>{p.requirements.length === 0 ? "None beyond wielding the Weapon" : requirementsText(p.requirements)}</dd>
        </div>
      </dl>
      <p className="gov-muted">
        <Link href={entryHref(rulesetId, releaseId, a.attack.entityId)}>Rules Reference entry (all authored data, references and provenance)</Link>
      </p>
    </div>
  );
}
