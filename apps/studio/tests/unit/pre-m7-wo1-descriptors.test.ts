// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_KIND_DESCRIPTORS, GENERIC_DESCRIPTOR, RUNTIME_KIND_DESCRIPTORS, descriptorFor, initialPayload, type FieldDescriptor } from "../../app/compendium/admin/_lib/descriptors";
import { CATALOG } from "./m6-wo1-fixtures";

/**
 * PRE-M7-WO1 C02–C04 — guided editors. Each dedicated core / runtime descriptor names EXACTLY the payload keys the M5
 * reader accepts (proved against every shipped payload of that kind), every vocabulary it names is served by the live
 * catalog, and the kinds still on the generic structured editor are an explicit, reviewed list (never silent).
 */
const ROOT = path.resolve(process.cwd(), "../..");
function shippedPayloads(): Map<string, Array<Record<string, unknown>>> {
  const out = new Map<string, Array<Record<string, unknown>>>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === "object") {
      const r = v as Record<string, unknown>;
      if (typeof r.definitionKind === "string" && r.payload !== null && typeof r.payload === "object") out.set(r.definitionKind, [...(out.get(r.definitionKind) ?? []), r.payload as Record<string, unknown>]);
      Object.values(r).forEach(walk);
    }
  };
  for (const f of ["core-resolution.json", "runtime-resources.json", "affinity.json", "weapons.json"]) walk(JSON.parse(readFileSync(path.join(ROOT, "packages/prowess-game/src/content/core-playtest-v0.1", f), "utf8")));
  return out;
}

/** Kinds whose payload is not (yet) uniform enough for a field-by-field form: they keep the structured editor. */
export const GENERIC_EDITOR_KINDS = ["ABILITY_CONSTRUCTION_RULE", "ACTION", "ACTION_IMPROVEMENT", "AFFINITY_PROGRESSION", "AFFINITY_RANK_RULE", "CORE_RESOLUTION", "MANEUVER_DEFINITION", "RESOURCE", "SPELL_DEFINITION"];

describe("PRE-M7-WO1 guided descriptors", () => {
  const payloads = shippedPayloads();
  const dedicated = { ...CORE_KIND_DESCRIPTORS, ...RUNTIME_KIND_DESCRIPTORS };

  it("W1-EDITORS each dedicated descriptor's keys are exactly the stored payload keys of every shipped Definition of that kind", () => {
    for (const [kind, d] of Object.entries(dedicated)) {
      const stored = payloads.get(kind) ?? [];
      expect(stored.length, `${kind} has shipped content to compare against`).toBeGreaterThan(0);
      for (const p of stored) expect(Object.keys(p).sort(), kind).toEqual(d.fields.map((f) => f.key).sort());
      expect(Object.keys(initialPayload(d)).sort(), kind).toEqual(d.fields.map((f) => f.key).sort());
    }
  });

  it("W1-EDITORS every vocabulary a guided field or column names is served by the live catalog", () => {
    const names = (f: FieldDescriptor): string[] => [
      ...("vocabulary" in f ? [f.vocabulary] : []),
      ...(f.input === "coreFormula" ? [f.sources] : []),
      ...(f.input === "rows" ? f.columns.flatMap((c) => (c.type === "select" ? [c.vocabulary] : [])) : []),
    ];
    for (const d of Object.values(dedicated)) for (const f of d.fields) for (const n of names(f)) expect(Object.keys(CATALOG.vocabularies), `${f.key} → ${n}`).toContain(n);
  });

  it("W1-EDITORS the kinds left on the generic structured editor are exactly the reviewed list", () => {
    const generic = CATALOG.kinds.filter((k) => k.supportedSchemaVersions.includes(1) && descriptorFor(k, 1) === GENERIC_DESCRIPTOR).map((k) => k.definitionKind).sort();
    expect(generic).toEqual([...GENERIC_EDITOR_KINDS].sort());
  });
});
