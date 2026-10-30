import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ABILITY_COMPONENT_CONTRACTS,
  ANCESTRY_SKILL_SELECTION_KINDS,
  ANCESTRY_STAT_GRANT_KINDS,
  CANONICAL_AFFINITIES,
  COST_CURRENCIES,
  DURATION_CONCEPTS,
  PROWESS_DEFINITION_KINDS,
  PROWESS_DEFINITION_KIND_NAMES,
  PROWESS_STATS,
  PROWESS_SYSTEM_FAMILIES,
  RESOLUTION_MODES,
  TARGETING_SEMANTIC_SHAPES,
  TRAIT_SCOPES,
  legacyTermFor,
} from "@prowess/game";
import { authoringKind, getAuthoringCatalog } from "../../src/compendium-authoring/catalog.js";

/**
 * PAS-10 M6-WO1 §8 / §40 — the authoring catalog is a PROJECTION of the certified M5 registry, never a second list
 * (M6-I002). Every kind, every allowed EntityType, every schema version and every option vocabulary is checked against
 * @prowess/game itself, so a change to the M5 catalog flows into authoring with no second edit — and a divergent
 * hand-written copy would fail here.
 */
const catalog = getAuthoringCatalog();

describe("M6-WO1 authoring catalog (M6-I002 no second Definition catalog)", () => {
  it("lists exactly the M5 Definition kinds, in the M5 order", () => {
    expect(catalog.kinds.map((k) => k.definitionKind)).toEqual([...PROWESS_DEFINITION_KIND_NAMES]);
  });

  it.each(PROWESS_DEFINITION_KIND_NAMES.map((k) => [k]))("%s: family, branch, contract, EntityTypes and schema versions equal the M5 spec", (kind) => {
    const spec = PROWESS_DEFINITION_KINDS[kind];
    const row = catalog.kinds.find((k) => k.definitionKind === kind)!;
    expect(row).toEqual({
      definitionKind: kind,
      systemFamily: spec.family,
      branch: spec.branch,
      sharedContract: spec.contract,
      allowedEntityTypes: [...spec.entityTypes],
      supportedSchemaVersions: [...spec.schemaVersions].sort((a, b) => a - b),
      authoringSchemaVersion: spec.schemaVersions.length === 0 ? null : Math.max(...spec.schemaVersions),
      authorable: spec.schemaVersions.length > 0,
    });
    expect(authoringKind(kind)).toEqual(row);
  });

  it("reserved kinds (no payload contract yet) are known but not authorable — authoring fails closed (§55)", () => {
    const reserved = catalog.kinds.filter((k) => !k.authorable).map((k) => k.definitionKind);
    expect(reserved.length).toBeGreaterThan(0);
    for (const kind of reserved) expect(PROWESS_DEFINITION_KINDS[kind].schemaVersions).toEqual([]);
    expect(reserved).toContain("WEAPON");
  });

  it("unknown values are not kinds — nothing is guessed from a name", () => {
    for (const v of ["SPELL_FIREBALL", "spell_effect", "Spell Effect", "", null, 7]) expect(authoringKind(v)).toBeNull();
  });

  it("option vocabularies are the M5 constants verbatim", () => {
    expect(catalog.systemFamilies).toEqual([...PROWESS_SYSTEM_FAMILIES]);
    expect(catalog.vocabularies).toEqual({
      targetingSemanticShapes: [...TARGETING_SEMANTIC_SHAPES],
      resolutionModes: [...RESOLUTION_MODES],
      traitScopes: [...TRAIT_SCOPES],
      durationConcepts: [...DURATION_CONCEPTS],
      costCurrencies: [...COST_CURRENCIES],
      canonicalAffinities: [...CANONICAL_AFFINITIES],
      componentContracts: [...ABILITY_COMPONENT_CONTRACTS],
      // M6-WO3 character-facing vocabularies.
      prowessStats: [...PROWESS_STATS],
      ancestryStatGrantKinds: [...ANCESTRY_STAT_GRANT_KINDS],
      ancestrySkillSelectionKinds: [...ANCESTRY_SKILL_SELECTION_KINDS],
    });
  });

  it("legacy-term pairs are exactly those M5 provenance accepts (§68)", () => {
    expect(catalog.legacyTerms.length).toBeGreaterThan(0);
    for (const pair of catalog.legacyTerms) {
      const known = legacyTermFor(pair.legacyTerm);
      expect(known?.canonicalTerm, pair.legacyTerm).toBe(pair.canonicalTerm);
    }
    expect(catalog.legacyTerms).toContainEqual({ legacyTerm: "Emission", canonicalTerm: "Evocation" });
  });

  it("is plain JSON data (safe to serve over HTTP)", () => {
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog);
  });
});

/**
 * The Studio UI tests render the editor against this exact catalog (apps/studio cannot import the M5 domain package,
 * M5-I017), so the fixture is GENERATED from the live catalog and checked here for drift. Regenerate deliberately with
 * M6_WO1_WRITE_FIXTURE=1.
 */
describe("Studio UI catalog fixture", () => {
  const fixturePath = resolve(import.meta.dirname, "../../../../apps/studio/tests/unit/fixtures/m6-wo1-catalog.json");
  it("equals the live authoring catalog", () => {
    const live = `${JSON.stringify(getAuthoringCatalog(), null, 2)}\n`;
    if (process.env.M6_WO1_WRITE_FIXTURE === "1") writeFileSync(fixturePath, live);
    expect(readFileSync(fixturePath, "utf8")).toBe(live);
  });
});
