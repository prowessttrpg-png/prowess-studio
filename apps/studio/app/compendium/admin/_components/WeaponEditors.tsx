"use client";

import { useState } from "react";
import type { AuthoringCatalogDto } from "../_lib/authoring-client";
import { AuthoredDataEditor } from "./AuthoredDataEditor";
import { DefinitionReferencePicker } from "./DefinitionReferencePicker";

/**
 * Structured editors for the PAS-10 M6-WO6 EQUIPMENT kinds (WEAPON, ATTACK, EQUIPMENT_TRAIT). Like every WO1 editor they
 * only SHAPE authored data: options come from the catalog (the domain package's vocabularies), exact references come
 * from the reference picker (never a name, never "latest"), and every value is validated by the server's WO6 contract.
 * No damage, Power, range or AP is computed here.
 */
type Row = Record<string, unknown>;
type Change = (v: unknown) => void;
const asArray = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
const asObject = (v: unknown): Row => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const int = (raw: string): number | null => (raw === "" ? null : Number(raw));
const numText = (v: unknown) => (typeof v === "number" ? String(v) : "");
/** One catalog vocabulary (the domain package's closed list); never a hard-coded value list. */
const vocab = (catalog: AuthoringCatalogDto, name: string): readonly string[] => catalog.vocabularies[name] ?? [];
const first = (values: readonly string[]) => values[0] ?? "";

/*
 * Which authored fields each catalog mode carries. Keys are the domain package's mode names; the values are this
 * editor's field-group names (layout only). An unknown mode shows no mode fields and the server's contract rejects it.
 */
const TARGETING_FIELDS: Readonly<Record<string, "reach" | "ranged" | "length">> = { MELEE: "reach", CLOSE: "reach", RANGED_MULTIPLIER: "ranged", LINE: "length", CONE: "length" };
const RESOLUTION_FIELDS: Readonly<Record<string, "roll" | "savingThrow" | "deferred">> = { ATTACK_ROLL: "roll", SAVING_THROW: "savingThrow", DEFERRED: "deferred" };
const REQUIREMENT_FIELDS: Readonly<Record<string, "rank" | "stat">> = { MARTIAL_RANK_AT_LEAST: "rank", STAT_AT_LEAST: "stat" };
const USE_SITE_LABELS: Readonly<Record<string, string>> = { WEAPON_PROPERTY: "Weapon property", MOVE_PROPERTY: "Move property" };

function Options({ values, empty }: { values: readonly string[]; empty?: string }) {
  return (
    <>
      <option value="">{empty ?? "Choose…"}</option>
      {values.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </>
  );
}

function RefLabel({ value }: { value: unknown }) {
  const r = asObject(value);
  return r.canonicalKey ? (
    <span>
      <code>{String(r.canonicalKey)}</code> <span className="gov-muted">revision {String(r.entityVersionId ?? "").slice(0, 8)}</span>
    </span>
  ) : (
    <span className="gov-muted">none</span>
  );
}

/** A nullable select: the empty option stores null (e.g. no authored category / handedness). */
export function NullableSelect({ id, value, options, onChange, emptyLabel, ...aria }: { id: string; value: unknown; options: readonly string[]; onChange: Change; emptyLabel: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) {
  return (
    <select id={id} {...aria} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}>
      <Options values={options} empty={emptyLabel} />
    </select>
  );
}

/** A list of short display texts (example forms). */
export function TextListEditor({ rows, onChange, label }: { rows: unknown; onChange: Change; label: string }) {
  const list = Array.isArray(rows) ? (rows as string[]) : [];
  return (
    <label className="gov-field">
      <span>{label} (comma-separated)</span>
      <input value={list.join(", ")} onChange={(e) => onChange(e.target.value.split(",").map((x) => x.trim()).filter((x) => x !== ""))} autoComplete="off" />
    </label>
  );
}

function ParametersEditor({ value, onChange, owner }: { value: unknown; onChange: Change; owner: string }) {
  const params = asObject(value);
  const entries = Object.entries(params);
  const [key, setKey] = useState("");
  return (
    <div>
      {entries.map(([k, v]) => (
        <label key={k} className="gov-field">
          <span>
            {owner} parameter <code>{k}</code>
          </span>
          <input type="number" step={1} value={numText(v)} onChange={(e) => onChange({ ...params, [k]: int(e.target.value) })} />
          <button type="button" className="gov-link-button" onClick={() => onChange(Object.fromEntries(entries.filter(([x]) => x !== k)))}>
            Remove parameter {k}
          </button>
        </label>
      ))}
      <label className="gov-field">
        <span>New parameter key</span>
        <input value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <button
        type="button"
        className="gov-button"
        disabled={key.trim() === ""}
        onClick={() => {
          onChange({ ...params, [key.trim()]: null });
          setKey("");
        }}
      >
        Add parameter
      </button>
    </div>
  );
}

/** One exact Equipment Trait use with explicit parameters, or none. */
export function TraitUseEditor({ value, onChange, label, refKind }: { value: unknown; onChange: Change; label: string; refKind: string }) {
  const [picking, setPicking] = useState(false);
  const use = value === null || value === undefined ? null : asObject(value);
  return (
    <div>
      <p>
        <RefLabel value={use?.traitRef} />
      </p>
      {use !== null ? (
        <>
          <ParametersEditor value={use.parameters} onChange={(p) => onChange({ ...use, parameters: p })} owner={label} />
          <button type="button" className="gov-link-button" onClick={() => onChange(null)}>
            Clear {label}
          </button>
        </>
      ) : null}
      {picking ? (
        <DefinitionReferencePicker
          label={`Choose the exact Equipment Trait for ${label}`}
          definitionKind={refKind}
          onSelect={(ref) => {
            onChange({ traitRef: ref, parameters: use?.parameters ?? {} });
            setPicking(false);
          }}
          onCancel={() => setPicking(false)}
        />
      ) : (
        <button type="button" className="gov-button" onClick={() => setPicking(true)}>
          {use === null ? `Choose ${label}` : `Change ${label}`}
        </button>
      )}
    </div>
  );
}

/** An ordered list of exact Equipment Trait uses (Weapon / Move properties). */
export function TraitUsesEditor({ rows, onChange, label, refKind }: { rows: unknown; onChange: Change; label: string; refKind: string }) {
  const list = asArray(rows);
  const [picking, setPicking] = useState(false);
  return (
    <div>
      {list.length === 0 ? <p className="gov-muted">No properties.</p> : null}
      {list.map((u, i) => (
        <fieldset key={i} className="prowess-authoring__nested" aria-label={`${label} ${i + 1}`}>
          <legend>
            {label} {i + 1}: <RefLabel value={u.traitRef} />
          </legend>
          <ParametersEditor value={u.parameters} onChange={(p) => onChange(list.map((x, j) => (j === i ? { ...x, parameters: p } : x)))} owner={`${label} ${i + 1}`} />
          <button type="button" className="gov-link-button" onClick={() => onChange(list.filter((_, j) => j !== i))}>
            Remove {label} {i + 1}
          </button>
        </fieldset>
      ))}
      {picking ? (
        <DefinitionReferencePicker
          label={`Add an exact Equipment Trait to ${label}`}
          definitionKind={refKind}
          onSelect={(ref) => {
            onChange([...list, { traitRef: ref, parameters: {} }]);
            setPicking(false);
          }}
          onCancel={() => setPicking(false)}
        />
      ) : (
        <button type="button" className="gov-button" onClick={() => setPicking(true)}>
          Add property
        </button>
      )}
    </div>
  );
}

/** The ordered Moveset: exact ATTACK revisions (author the Attacks first — §93). */
export function AttackRefsEditor({ rows, onChange, refKind }: { rows: unknown; onChange: Change; refKind: string }) {
  const list = asArray(rows);
  const [picking, setPicking] = useState(false);
  const move = (i: number, j: number) => {
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j] as Row, next[i] as Row];
    onChange(next);
  };
  return (
    <div>
      {list.length === 0 ? <p className="gov-muted">No Attacks yet — a Weapon needs at least one exact Attack.</p> : null}
      <ol aria-label="Moveset">
        {list.map((r, i) => (
          <li key={`${String(r.entityVersionId)}-${i}`}>
            <RefLabel value={r} />{" "}
            <button type="button" className="gov-link-button" onClick={() => move(i, i - 1)} disabled={i === 0}>
              Move Attack {i + 1} up
            </button>{" "}
            <button type="button" className="gov-link-button" onClick={() => move(i, i + 1)} disabled={i === list.length - 1}>
              Move Attack {i + 1} down
            </button>{" "}
            <button type="button" className="gov-link-button" onClick={() => onChange(list.filter((_, j) => j !== i))}>
              Remove Attack {i + 1}
            </button>
          </li>
        ))}
      </ol>
      {picking ? (
        <DefinitionReferencePicker
          label="Add an exact Attack revision to the Moveset"
          definitionKind={refKind}
          onSelect={(ref) => {
            onChange([...list, ref]);
            setPicking(false);
          }}
          onCancel={() => setPicking(false)}
        />
      ) : (
        <button type="button" className="gov-button" onClick={() => setPicking(true)}>
          Add Attack
        </button>
      )}
    </div>
  );
}

/** Damage profiles: structured dice (count × sides) and a damage type per selectable option. */
export function DamageProfilesEditor({ rows, onChange, catalog }: { rows: unknown; onChange: Change; catalog: AuthoringCatalogDto }) {
  const list = asArray(rows);
  const types = vocab(catalog, "damageTypes");
  const set = (i: number, next: Row) => onChange(list.map((r, j) => (j === i ? next : r)));
  return (
    <div>
      {list.map((r, i) => {
        const dice = asObject(r.dice);
        return (
          <fieldset key={i} className="prowess-authoring__nested" aria-label={`Damage profile ${i + 1}`}>
            <legend>Damage profile {i + 1}</legend>
            <label className="gov-field">
              <span>Profile key</span>
              <input value={String(r.profileKey ?? "")} onChange={(e) => set(i, { ...r, profileKey: e.target.value })} autoComplete="off" spellCheck={false} />
            </label>
            <label className="gov-field">
              <span>Number of dice</span>
              <input type="number" step={1} value={numText(dice.count)} onChange={(e) => set(i, { ...r, dice: { ...dice, count: int(e.target.value) } })} />
            </label>
            <label className="gov-field">
              <span>Die sides</span>
              <input type="number" step={1} value={numText(dice.sides)} onChange={(e) => set(i, { ...r, dice: { ...dice, sides: int(e.target.value) } })} />
            </label>
            <label className="gov-field">
              <span>Damage type</span>
              <select value={String(r.damageType ?? "")} onChange={(e) => set(i, { ...r, damageType: e.target.value })}>
                <Options values={types} />
              </select>
            </label>
            <button type="button" className="gov-link-button" onClick={() => onChange(list.filter((_, j) => j !== i))}>
              Remove damage profile {i + 1}
            </button>
          </fieldset>
        );
      })}
      <button type="button" className="gov-button" onClick={() => onChange([...list, { profileKey: "", dice: { count: null, sides: null }, damageType: "" }])}>
        Add damage profile
      </button>
    </div>
  );
}

/** Structured requirements: a Martial rank or a Stat minimum. */
export function WeaponRequirementsEditor({ rows, onChange, catalog }: { rows: unknown; onChange: Change; catalog: AuthoringCatalogDto }) {
  const list = asArray(rows);
  const stats = vocab(catalog, "prowessStats");
  const kinds = vocab(catalog, "weaponRequirementKinds");
  const set = (i: number, next: Row) => onChange(list.map((r, j) => (j === i ? next : r)));
  const shaped = (requirementKey: unknown, kind: string): Row =>
    REQUIREMENT_FIELDS[kind] === "rank" ? { requirementKey, kind, minimumRank: "" } : { requirementKey, kind, stat: "", minimum: null };
  return (
    <div>
      {list.length === 0 ? <p className="gov-muted">No requirements.</p> : null}
      {list.map((r, i) => (
        <fieldset key={i} className="prowess-authoring__nested" aria-label={`Requirement ${i + 1}`}>
          <legend>Requirement {i + 1}</legend>
          <label className="gov-field">
            <span>Requirement key</span>
            <input value={String(r.requirementKey ?? "")} onChange={(e) => set(i, { ...r, requirementKey: e.target.value })} autoComplete="off" spellCheck={false} />
          </label>
          <label className="gov-field">
            <span>Kind</span>
            <select value={String(r.kind ?? "")} onChange={(e) => set(i, shaped(r.requirementKey, e.target.value))}>
              <Options values={kinds} />
            </select>
          </label>
          {REQUIREMENT_FIELDS[String(r.kind ?? "")] === "rank" ? (
            <label className="gov-field">
              <span>Minimum Martial rank</span>
              <input value={String(r.minimumRank ?? "")} onChange={(e) => set(i, { ...r, minimumRank: e.target.value })} autoComplete="off" spellCheck={false} />
            </label>
          ) : (
            <>
              <label className="gov-field">
                <span>Stat</span>
                <select value={String(r.stat ?? "")} onChange={(e) => set(i, { ...r, stat: e.target.value })}>
                  <Options values={stats} />
                </select>
              </label>
              <label className="gov-field">
                <span>Minimum score</span>
                <input type="number" step={1} value={numText(r.minimum)} onChange={(e) => set(i, { ...r, minimum: int(e.target.value) })} />
              </label>
            </>
          )}
          <button type="button" className="gov-link-button" onClick={() => onChange(list.filter((_, j) => j !== i))}>
            Remove requirement {i + 1}
          </button>
        </fieldset>
      ))}
      <button type="button" className="gov-button" onClick={() => onChange([...list, shaped("", first(kinds))])}>
        Add requirement
      </button>
    </div>
  );
}

/** While-equipped Armor / Dodge / Movement modifiers (applied to the derived profile, never stored on a Character). */
export function EquippedModifiersEditor({ rows, onChange, catalog }: { rows: unknown; onChange: Change; catalog: AuthoringCatalogDto }) {
  const list = asArray(rows);
  const targets = vocab(catalog, "equipmentModifierTargets");
  const set = (i: number, next: Row) => onChange(list.map((r, j) => (j === i ? next : r)));
  return (
    <div>
      {list.length === 0 ? <p className="gov-muted">No while-equipped modifiers.</p> : null}
      {list.map((r, i) => (
        <fieldset key={i} className="prowess-authoring__nested" aria-label={`Modifier ${i + 1}`}>
          <legend>Modifier {i + 1}</legend>
          <label className="gov-field">
            <span>Modifier key</span>
            <input value={String(r.modifierKey ?? "")} onChange={(e) => set(i, { ...r, modifierKey: e.target.value })} autoComplete="off" spellCheck={false} />
          </label>
          <label className="gov-field">
            <span>Target</span>
            <select value={String(r.target ?? "")} onChange={(e) => set(i, { ...r, target: e.target.value })}>
              <Options values={targets} />
            </select>
          </label>
          <label className="gov-field">
            <span>Value</span>
            <input type="number" step={1} value={numText(r.value)} onChange={(e) => set(i, { ...r, value: int(e.target.value) })} />
          </label>
          <button type="button" className="gov-link-button" onClick={() => onChange(list.filter((_, j) => j !== i))}>
            Remove modifier {i + 1}
          </button>
        </fieldset>
      ))}
      <button type="button" className="gov-button" onClick={() => onChange([...list, { modifierKey: "", target: first(targets), value: null }])}>
        Add modifier
      </button>
    </div>
  );
}

/** Reference-only granted features (e.g. Deflect Shot, the Expert Unarmed Grapple rule). */
export function GrantedFeaturesEditor({ rows, onChange, catalog }: { rows: unknown; onChange: Change; catalog: AuthoringCatalogDto }) {
  const list = asArray(rows);
  // A granted feature is reference-only or deferred; the server's contract rejects an executable status here.
  const statuses = vocab(catalog, "traitExecutionStatuses");
  const set = (i: number, next: Row) => onChange(list.map((r, j) => (j === i ? next : r)));
  return (
    <div>
      {list.length === 0 ? <p className="gov-muted">No granted features.</p> : null}
      {list.map((r, i) => (
        <fieldset key={i} className="prowess-authoring__nested" aria-label={`Feature ${i + 1}`}>
          <legend>Feature {i + 1}</legend>
          <label className="gov-field">
            <span>Feature key</span>
            <input value={String(r.featureKey ?? "")} onChange={(e) => set(i, { ...r, featureKey: e.target.value })} autoComplete="off" spellCheck={false} />
          </label>
          <label className="gov-field">
            <span>Status</span>
            <select value={String(r.executionStatus ?? "")} onChange={(e) => set(i, { ...r, executionStatus: e.target.value })}>
              <Options values={statuses} />
            </select>
          </label>
          <label className="gov-field">
            <span>Summary</span>
            <textarea value={String(r.summary ?? "")} onChange={(e) => set(i, { ...r, summary: e.target.value })} />
          </label>
          <button type="button" className="gov-link-button" onClick={() => onChange(list.filter((_, j) => j !== i))}>
            Remove feature {i + 1}
          </button>
        </fieldset>
      ))}
      <button type="button" className="gov-button" onClick={() => onChange([...list, { featureKey: "", executionStatus: "", summary: "" }])}>
        Add feature
      </button>
    </div>
  );
}

/** Structured Attack targeting: Melee / Close reach, a ranged multiplier (feet per Stat point) with an optional Blast, Line or Cone. */
export function AttackTargetingEditor({ value, onChange, catalog }: { value: unknown; onChange: Change; catalog: AuthoringCatalogDto }) {
  const t = asObject(value);
  const mode = String(t.mode ?? "");
  const fields = TARGETING_FIELDS[mode];
  const stats = vocab(catalog, "prowessStats");
  const modes = vocab(catalog, "attackTargetingModes");
  const shapes = vocab(catalog, "attackAreaShapes");
  const area = t.area === null || t.area === undefined ? null : asObject(t.area);
  const reset = (m: string) => {
    const f = TARGETING_FIELDS[m];
    onChange(f === "reach" ? { mode: m, reachFeet: null } : f === "ranged" ? { mode: m, stat: "", feetPerPoint: null, area: null } : { mode: m, lengthFeet: null });
  };
  return (
    <div>
      <label className="gov-field">
        <span>Targeting mode</span>
        <select value={mode} onChange={(e) => reset(e.target.value)}>
          <Options values={modes} />
        </select>
      </label>
      {fields === "reach" ? (
        <label className="gov-field">
          <span>Reach (feet)</span>
          <input type="number" step={1} value={numText(t.reachFeet)} onChange={(e) => onChange({ ...t, reachFeet: int(e.target.value) })} />
        </label>
      ) : null}
      {fields === "ranged" ? (
        <>
          <label className="gov-field">
            <span>Range Stat</span>
            <select value={String(t.stat ?? "")} onChange={(e) => onChange({ ...t, stat: e.target.value })}>
              <Options values={stats} />
            </select>
          </label>
          <label className="gov-field">
            <span>Feet per Stat point</span>
            <input type="number" step={1} value={numText(t.feetPerPoint)} onChange={(e) => onChange({ ...t, feetPerPoint: int(e.target.value) })} />
          </label>
          <label className="gov-field">
            <span>
              <input type="checkbox" checked={area !== null} onChange={(e) => onChange({ ...t, area: e.target.checked ? { shape: first(shapes), radiusFeet: null } : null })} /> Area
            </span>
          </label>
          {area !== null ? (
            <>
              <label className="gov-field">
                <span>Area shape</span>
                <select value={String(area.shape ?? "")} onChange={(e) => onChange({ ...t, area: { ...area, shape: e.target.value } })}>
                  <Options values={shapes} />
                </select>
              </label>
              <label className="gov-field">
                <span>Area radius (feet)</span>
                <input type="number" step={1} value={numText(area.radiusFeet)} onChange={(e) => onChange({ ...t, area: { ...area, radiusFeet: int(e.target.value) } })} />
              </label>
            </>
          ) : null}
        </>
      ) : null}
      {fields === "length" ? (
        <label className="gov-field">
          <span>Length (feet)</span>
          <input type="number" step={1} value={numText(t.lengthFeet)} onChange={(e) => onChange({ ...t, lengthFeet: int(e.target.value) })} />
        </label>
      ) : null}
    </div>
  );
}

/** Attack resolution: an Attack Roll (with authored miss damage) or a Saving Throw (Save Stat, DC, failure / success damage). */
export function AttackResolutionEditor({ value, onChange, catalog }: { value: unknown; onChange: Change; catalog: AuthoringCatalogDto }) {
  const r = asObject(value);
  const mode = String(r.mode ?? "");
  const fields = RESOLUTION_FIELDS[mode];
  const stats = vocab(catalog, "prowessStats");
  const modes = vocab(catalog, "attackResolutionModes");
  const outcomes = vocab(catalog, "damageOutcomes");
  const dcs = vocab(catalog, "savingThrowDcs");
  const reset = (m: string) => {
    const f = RESOLUTION_FIELDS[m];
    onChange(f === "roll" ? { mode: m, onMiss: "" } : f === "savingThrow" ? { mode: m, savingThrowStat: "", dc: first(dcs), onFailure: "", onSuccess: "" } : { mode: m, reason: "" });
  };
  const select = (key: string, label: string, values: readonly string[]) => (
    <label className="gov-field">
      <span>{label}</span>
      <select value={String(r[key] ?? "")} onChange={(e) => onChange({ ...r, [key]: e.target.value })}>
        <Options values={values} />
      </select>
    </label>
  );
  return (
    <div>
      <label className="gov-field">
        <span>Resolution mode</span>
        <select value={mode} onChange={(e) => reset(e.target.value)}>
          <Options values={modes} />
        </select>
      </label>
      {fields === "roll" ? select("onMiss", "Damage on a miss (authored)", outcomes) : null}
      {fields === "savingThrow" ? (
        <>
          {select("savingThrowStat", "Saving Throw Stat", stats)}
          {select("dc", "Saving Throw DC", dcs)}
          {select("onFailure", "Damage on a failed Saving Throw", outcomes)}
          {select("onSuccess", "Damage on a successful Saving Throw", outcomes)}
        </>
      ) : null}
      {fields === "deferred" ? (
        <label className="gov-field">
          <span>Why the resolution is deferred</span>
          <textarea value={String(r.reason ?? "")} onChange={(e) => onChange({ ...r, reason: e.target.value })} />
        </label>
      ) : null}
    </div>
  );
}

/** Declared trait parameters. */
export function TraitParametersEditor({ rows, onChange, catalog }: { rows: unknown; onChange: Change; catalog: AuthoringCatalogDto }) {
  const list = asArray(rows);
  const kinds = vocab(catalog, "traitParameterKinds");
  const set = (i: number, next: Row) => onChange(list.map((r, j) => (j === i ? next : r)));
  return (
    <div>
      {list.length === 0 ? <p className="gov-muted">No parameters.</p> : null}
      {list.map((r, i) => (
        <fieldset key={i} className="prowess-authoring__nested" aria-label={`Parameter ${i + 1}`}>
          <legend>Parameter {i + 1}</legend>
          <label className="gov-field">
            <span>Parameter key</span>
            <input value={String(r.parameterKey ?? "")} onChange={(e) => set(i, { ...r, parameterKey: e.target.value })} autoComplete="off" spellCheck={false} />
          </label>
          <label className="gov-field">
            <span>Kind</span>
            <select value={String(r.kind ?? "")} onChange={(e) => set(i, { ...r, kind: e.target.value })}>
              <Options values={kinds} />
            </select>
          </label>
          <label className="gov-field">
            <span>
              <input type="checkbox" checked={r.required === true} onChange={(e) => set(i, { ...r, required: e.target.checked })} /> Required
            </span>
          </label>
          <button type="button" className="gov-link-button" onClick={() => onChange(list.filter((_, j) => j !== i))}>
            Remove parameter {i + 1}
          </button>
        </fieldset>
      ))}
      <button type="button" className="gov-button" onClick={() => onChange([...list, { parameterKey: "", kind: first(kinds), required: true }])}>
        Add parameter
      </button>
    </div>
  );
}

/** Where a trait may be used: on a Weapon, on an Attack, or both. */
export function UseSitesEditor({ rows, onChange, catalog }: { rows: unknown; onChange: Change; catalog: AuthoringCatalogDto }) {
  const list = Array.isArray(rows) ? (rows as string[]) : [];
  return (
    <div>
      {vocab(catalog, "traitUseSites").map((site) => (
        <label key={site} className="gov-field">
          <span>
            <input type="checkbox" checked={list.includes(site)} onChange={(e) => onChange(e.target.checked ? [...list, site] : list.filter((x) => x !== site))} /> {USE_SITE_LABELS[site] ?? site}
          </span>
        </label>
      ))}
    </div>
  );
}

/** An EXECUTABLE trait's contract — present only when the trait is executable (§18). */
export function TraitContractEditor({ value, onChange }: { value: unknown; onChange: Change }) {
  const present = value !== null && value !== undefined;
  return (
    <div>
      <label className="gov-field">
        <span>
          <input type="checkbox" checked={present} onChange={(e) => onChange(e.target.checked ? {} : null)} /> This trait carries a complete executable contract
        </span>
      </label>
      {present ? <AuthoredDataEditor value={asObject(value)} onChange={onChange as (v: Record<string, unknown>) => void} label="Executable contract" /> : null}
    </div>
  );
}

/** Equipment source: locators, conflicts and designer authority (comma-separated lists). */
export function EquipmentSourceEditor({ value, onChange }: { value: unknown; onChange: Change }) {
  const src = asObject(value);
  const list = (k: string) => (Array.isArray(src[k]) ? (src[k] as string[]) : []);
  const setList = (k: string, text: string) => onChange({ ...src, [k]: text.split(",").map((x) => x.trim()).filter((x) => x !== "") });
  return (
    <div>
      <label className="gov-field">
        <span>Source sections (comma-separated, e.g. s519)</span>
        <input value={list("locators").join(", ")} onChange={(e) => setList("locators", e.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <label className="gov-field">
        <span>Source-conflict keys (comma-separated, optional)</span>
        <input value={list("conflicts").join(", ")} onChange={(e) => setList("conflicts", e.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <label className="gov-field">
        <span>Designer authority (comma-separated, e.g. M6-WO6 §103)</span>
        <input value={list("designerAuthority").join(", ")} onChange={(e) => setList("designerAuthority", e.target.value)} autoComplete="off" spellCheck={false} />
      </label>
    </div>
  );
}
