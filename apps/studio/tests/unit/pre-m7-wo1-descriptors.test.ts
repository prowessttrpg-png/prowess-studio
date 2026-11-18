// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ABILITY_DEFINITION_DESCRIPTORS,
  CORE_KIND_DESCRIPTORS,
  GENERIC_DESCRIPTOR,
  REMAINING_KIND_DESCRIPTORS,
  RUNTIME_KIND_DESCRIPTORS,
  descriptorFor,
  initialPayload,
  type ContractDescriptor,
  type FieldDescriptor,
} from "../../app/compendium/admin/_lib/descriptors";
import { CATALOG, kindRow } from "./m6-wo1-fixtures";

/**
 * PRE-M7-WO1 C02, C04, C12 — guided editors. Every guided descriptor DESCRIBES every key of every shipped payload of
 * its kind, recursively (nested records, lists, shape-by-discriminator variants, per-vocabulary records): no stored value
 * is invisible to the form. Opaque leaves (structured rule notes, formulas, sources, optional engine policies) are edited
 * by their own controls. Every vocabulary a guided field names is served by the live catalog, and no editable kind is
 * left on the generic structured editor.
 */
const ROOT = path.resolve(process.cwd(), "../..");
interface Shipped {
  kind: string;
  schemaVersion: number;
  payload: Record<string, unknown>;
}
function shippedPayloads(): Shipped[] {
  const out: Shipped[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === "object") {
      const r = v as Record<string, unknown>;
      if (typeof r.definitionKind === "string" && r.payload !== null && typeof r.payload === "object") out.push({ kind: r.definitionKind, schemaVersion: typeof r.schemaVersion === "number" ? r.schemaVersion : 1, payload: r.payload as Record<string, unknown> });
      Object.values(r).forEach(walk);
    }
  };
  for (const f of ["core-resolution.json", "runtime-resources.json", "affinity.json", "weapons.json", "ability-construction.json"]) walk(JSON.parse(readFileSync(path.join(ROOT, "packages/prowess-game/src/content/core-playtest-v0.1", f), "utf8")));
  return out;
}

const OPAQUE = new Set(["authoredData", "optionalData", "source", "equipmentSource", "coreFormula", "keywords", "compatibility", "costContributions", "outcomes", "resolution", "restriction", "abilityDefinition"]);
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Paths of stored values no guided field describes (empty = the form covers the whole payload). */
function uncovered(fields: readonly FieldDescriptor[], value: Record<string, unknown>, at: string): string[] {
  const whole = fields.find((f) => f.key === "");
  if (whole !== undefined) return covers(whole, value, at);
  const out: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    const f = fields.find((x) => x.key === k);
    if (f === undefined) out.push(`${at}/${k}`);
    else out.push(...covers(f, v, `${at}/${k}`));
  }
  return out;
}
function covers(f: FieldDescriptor, v: unknown, at: string): string[] {
  if (OPAQUE.has(f.input) || v === null || v === undefined) return [];
  switch (f.input) {
    case "group":
      return isObj(v) ? uncovered(f.fields, v, at) : [];
    case "list":
      return Array.isArray(v) ? v.flatMap((x, i) => (isObj(x) ? uncovered(f.item, x, `${at}/${i}`) : [])) : [];
    case "variant": {
      if (!isObj(v)) return [];
      const shape = f.variants[String(v[f.discriminator])];
      if (shape === undefined) return [`${at}/${f.discriminator}=${String(v[f.discriminator])} (no variant)`];
      return uncovered([{ key: f.discriminator, label: "", group: "", input: "line", required: true }, ...shape], v, at);
    }
    case "byVocabulary":
      return isObj(v) ? Object.entries(v).flatMap(([k, x]) => ((CATALOG.vocabularies[f.vocabulary] ?? []).includes(k) ? (isObj(x) ? uncovered(f.fields, x, `${at}/${k}`) : []) : [`${at}/${k}`])) : [];
    case "rows":
      return Array.isArray(v) ? v.flatMap((x, i) => (isObj(x) ? Object.keys(x).filter((k) => !f.columns.some((c) => c.key === k)).map((k) => `${at}/${i}/${k}`) : [])) : [];
    default:
      return [];
  }
}
function vocabularyNames(f: FieldDescriptor): string[] {
  const own = [...("vocabulary" in f ? [f.vocabulary] : []), ...(f.input === "coreFormula" ? [f.sources] : []), ...(f.input === "rows" ? f.columns.flatMap((c) => (c.type === "select" ? [c.vocabulary] : [])) : [])];
  const nested = f.input === "group" || f.input === "byVocabulary" ? f.fields : f.input === "list" ? f.item : f.input === "variant" ? Object.values(f.variants).flat() : [];
  return [...own, ...nested.flatMap(vocabularyNames)];
}

describe("PRE-M7-WO1 guided descriptors", () => {
  const shipped = shippedPayloads();
  const guided: Record<string, ContractDescriptor> = { ...CORE_KIND_DESCRIPTORS, ...RUNTIME_KIND_DESCRIPTORS, ...REMAINING_KIND_DESCRIPTORS };

  it("W1-EDITORS every key of every shipped payload is described by its kind's guided form (recursively)", () => {
    const kindsSeen = new Set<string>();
    for (const s of shipped) {
      const d = descriptorFor(kindRow(s.kind), s.schemaVersion);
      if (d === GENERIC_DESCRIPTOR || d.fields.every((f) => f.input === "abilityDefinition")) continue;
      kindsSeen.add(`${s.kind} v${s.schemaVersion}`);
      expect(uncovered(d.fields, s.payload, ""), `${s.kind} v${s.schemaVersion}`).toEqual([]);
    }
    // Every guided kind with shipped content was compared (ACTION_IMPROVEMENT has no shipped content; see its own test).
    for (const k of ["ACTION v1", "RESOURCE v1", "CORE_RESOLUTION v1", "AFFINITY_RANK_RULE v1", "AFFINITY_PROGRESSION v1", "ABILITY_CONSTRUCTION_RULE v1", "AFFINITY v2", "STAT v1", "DERIVED_STAT v1", "TERRAIN v1", "CREATURE_SIZE v1", "RANK_LADDER v1", "SKILL_RANK v1", "CHARACTER_DIE_PROGRESSION v1", "AFFINITY_WEAKNESS_SEVERITY v1"]) expect([...kindsSeen], k).toContain(k);
  });

  it("W1-EDITORS flat descriptors name exactly the stored top-level keys; a new payload starts in that shape", () => {
    for (const [kind, d] of Object.entries({ ...CORE_KIND_DESCRIPTORS, ...RUNTIME_KIND_DESCRIPTORS })) {
      for (const s of shipped.filter((x) => x.kind === kind)) expect(Object.keys(s.payload).sort(), kind).toEqual(d.fields.map((f) => f.key).sort());
      expect(Object.keys(initialPayload(d)).sort(), kind).toEqual(d.fields.map((f) => f.key).sort());
    }
    // Optional engine policies stay ABSENT in a new construction rule (never written as empty objects).
    const acr = initialPayload(REMAINING_KIND_DESCRIPTORS.ABILITY_CONSTRUCTION_RULE as ContractDescriptor);
    for (const k of ["conditionPolicy", "maneuverCostPolicy", "effectExecutionPolicy", "activeMagicPolicy"]) expect(Object.keys(acr), k).not.toContain(k);
  });

  it("W1-EDITORS reusable Spell / Maneuver Definitions start in the exact M5 shape", () => {
    const spell = initialPayload(ABILITY_DEFINITION_DESCRIPTORS.SPELL_DEFINITION as ContractDescriptor);
    expect(Object.keys(spell).sort()).toEqual(["additionalAffinityTraits", "composition", "constructionOptions", "description", "name"]);
    expect(Object.keys(spell.composition as object).sort()).toEqual(["abilityKind", "affinity", "authority", "branch", "compositionKey", "conditions", "duration", "effects", "keywords", "targeting", "traits"]);
    const maneuver = initialPayload(ABILITY_DEFINITION_DESCRIPTORS.MANEUVER_DEFINITION as ContractDescriptor);
    expect(Object.keys(maneuver).sort()).toEqual(["actions", "composition", "description", "effectAttachments", "name", "powerfulBlow"]);
    expect(Object.keys(maneuver.composition as object).sort()).toEqual(["abilityKind", "affinity", "authority", "compositionKey", "conditions", "duration", "effects", "keywords", "traits"]);
  });

  it("W1-EDITORS every vocabulary a guided field, column or nested field names is served by the live catalog", () => {
    for (const d of Object.values(guided)) for (const f of d.fields) for (const n of vocabularyNames(f)) expect(Object.keys(CATALOG.vocabularies), `${f.key} → ${n}`).toContain(n);
  });

  it("W1-EDITORS no authorable kind / schema version is left on the generic structured editor", () => {
    const generic = CATALOG.kinds.flatMap((k) => k.supportedSchemaVersions.filter((v) => descriptorFor(k, v) === GENERIC_DESCRIPTOR).map((v) => `${k.definitionKind} v${v}`));
    expect(generic).toEqual([]);
  });
});
