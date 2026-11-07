import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditM5Source } from "./m5-wo1-audit-helpers";
import { auditWo2Source } from "./m5-wo2-audit-helpers";
import { auditWo3Source } from "./m5-wo3-audit-helpers";
import ts from "typescript";
import { callsNamed, descendants, exactlyOne, maneuverUiFindings, namedFunction, namedVariable, parseSource, syntaxIs, syntaxTokens } from "./m6-wo8-audit-helpers";
import { expectedFrozenHash } from "./later-milestone-schema";

const ROOT = path.resolve(process.cwd(), "../..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const hash = (f: string) => createHash("sha256").update(read(f)).digest("hex");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
function files(dir: string): string[] { return !existsSync(path.join(ROOT, dir)) ? [] : readdirSync(path.join(ROOT, dir)).flatMap(n => { const f = `${dir}/${n}`; return statSync(path.join(ROOT, f)).isDirectory() ? files(f) : [f]; }); }
const G = "packages/prowess-game/src/", D = "packages/prowess-db/src/character/";
const adapter = code(read(G + "character/signature-maneuver.ts"));
const catalog = code(read(G + "character/signature-maneuver-catalog.ts"));
const repo = code(read(D + "signature-spell-repository.ts"));
const service = code(read(D + "signature-maneuver-service.ts"));
const migration = read("packages/prowess-db/prisma/migrations/20261104010000_m6_wo8_signature_maneuvers/migration.sql");
const api = "apps/studio/app/api/characters/[characterId]/maneuvers";
const routes = [api + "/route.ts", api + "/[maneuverId]/route.ts", ...["builder", "draft", "validate", "finalize", "rebuild", "retire"].map(n => `${api}/[maneuverId]/${n}/route.ts`)];
const UI = "apps/studio/app/characters/_components/maneuvers";

describe("M6-WO8 permanent architecture and integration contracts", () => {
  it("M6-I101 M6-I105 M6-I108: exact-reference catalog reads are allowed, kind/shape inference and hidden math remain forbidden", () => {
    for (const f of [G + "character/signature-maneuver.ts", G + "character/signature-maneuver-catalog.ts"]) {
      expect(auditM5Source(read(f), f, "game"), f).toEqual([]);
      const append = (snippet: string) => auditM5Source(`${read(f)}\n${snippet}`, f, "game");
      expect(append('export const inferred = (x: any) => x.weapon ? "MANEUVER" : "SPELL";')).toContain("kind-inference");
      expect(append('export const inferredShape = (x: any) => x.semanticShape === "SINGLE_TARGET";')).toContain("shape-implies-mechanics");
      expect(append("export const hiddenPrice = 4 - 2;")).toContain("hidden-math");
    }
    // The same data projections outside these two reviewed adapter paths still have the original WO1 findings.
    const projection = 'const source: ManeuverActionSource = { kind: "WEAPON_ATTACK", weapon: attack.weapon };';
    expect(auditM5Source(projection, G + "unreviewed.ts", "game")).toContain("kind-inference");
    for (const f of ["ability/compile.ts", "character/signature-maneuver.ts", "content-updates/m6-wo8-amendment-a.ts", "definition/duration-condition-payload.ts"]) expect(auditWo2Source(read(G + f), G + f, "game"), f).toEqual([]);
    expect(auditWo3Source(read(G + "ability/maneuver-cost.ts"), G + "ability/maneuver-cost.ts", "game")).toEqual([]);
  });

  it("M6-I111: the Prisma model maps the exact PostgreSQL-truncated FK names without rewriting the migration", () => {
    const schema = read("packages/prowess-db/prisma/schema.prisma");
    expect(hash("packages/prowess-db/prisma/migrations/20261104010000_m6_wo8_signature_maneuvers/migration.sql")).toBe("d5426f48e29f9378d73178cc86405a379f22b2e0439c6c5619cb592eb7ff6379");
    for (const declared of ["character_signature_maneuver_revisions_character_release_id_fkey", "character_signature_maneuver_revisions_previous_revision_id_fkey"]) {
      const stored = Buffer.from(declared).subarray(0, 63).toString("utf8");
      expect(migration).toContain(`ADD CONSTRAINT "${declared}"`);
      expect(schema).toContain(`map: "${stored}"`);
      expect(Buffer.byteLength(stored)).toBe(63);
    }
  });

  it("M6-I099 M6-I101 M6-I102 M6-I105 M6-I115 M6-I119: exact Character choices without synthetic canon or latest lookup", () => {
    expect(adapter).toContain('kind: "CHARACTER_SIGNATURE_MANEUVER"');
    expect(adapter).toContain("subjectRefs: [], definition: subject");
    expect(adapter).toContain("findBundleDefinition(bundle, a.source.definition)");
    expect(adapter).toContain("isSameExactDefinition(x.weapon, source.weapon)");
    expect(adapter).toContain("isSameExactDefinition(x.attack, source.attack)");
    expect(adapter).toContain("bindWeaponAttackToManeuver");
    expect(adapter).toContain("AMBIGUOUS_ATTACK_CONTEXT");
    for (const src of [adapter, catalog, service, repo]) {
      expect(src).not.toMatch(/definitions: \[\.\.\.(request\.)?bundle\.definitions|bundle\.definitions\.(push|splice)|definitionKind: "MANEUVER_DEFINITION"/);
      expect(src).not.toMatch(/\.(entity|entityVersion|rulesetRelease|changeSet|rulesetManifest)\.(create|update|upsert|delete)/);
      expect(src).not.toMatch(/latest|newest|mostRecent|find\([^)]*canonicalKey ===|entityVersion\.find/i);
    }
    expect(service).toContain("readSignatureManeuverDraft(raw)");
  });

  it("M6-I103 M6-I104 M6-I106 M6-I107 M6-I108 M6-I121: one M5/M4 pipeline, inherited per-Action targeting and global capacities", () => {
    for (const name of ["compileAuthoredAbilityCore", "compileManeuverCostCore", "compileExecutionCore", "orchestrateRulesEvaluation", "readManeuverCostRun"]) expect(adapter).toContain(name);
    expect(adapter).not.toMatch(/Math\.|finalApCost\s*[+*/-]|finalMpCost\s*[+*/-]|maximumActionBlocks\s*[+*/-]/);
    expect(adapter).toContain('...(!draft.effects.length ? ["EFFECTS"] : [])');
    expect(adapter).toContain("enforceActionBlockCapacity: true");
    expect(adapter).toContain('"targeting"');
    expect(read(G + "ability/compile.ts")).toContain('kind: "NUMERIC_COMPARE", factKey: "maneuver.action_blocks", operator: "<=", expected: construction.value.outputs.access.martialRankValue ?? 0');
    expect(read(G + "construction/composition.ts")).toContain("ACTION_SPECIFIC");
    expect(read(G + "ability/maneuver-cost.ts")).toContain("actionKeys.includes(t.scope.componentKey)");
    expect(read(G + "ability/maneuver-cost.ts")).toContain('`${k}.targeting` === t.scope.componentKey');
  });

  it("M6-I100 M6-I110 M6-I111 M6-I112 M6-I113 M6-I114 M6-I118 M6-I122: shared atomic lifecycle and append-only own-kind history", () => {
    expect(repo).toContain('WHERE "id" = ${characterId}::uuid FOR UPDATE');
    expect(repo).toContain('where: { characterId, status: "ACTIVE", id: { not: abilityId } }');
    expect(repo).toContain("stored.lockVersion !== expected");
    expect(repo).toContain("input.weaponLoadoutVersion");
    expect(repo).toContain("character_changed");
    expect(repo.indexOf("if (!decision.ok)")).toBeLessThan(repo.indexOf('kind === "SPELL" ? await tx.characterSignatureSpellRevision.create'));
    expect(repo).not.toMatch(/characterSignature(?:Spell|Maneuver)Revision\.(update|delete|upsert)/);
    expect(service).toContain('a.status === "ACTIVE" && a.id !== except');
    expect(service).toContain("valid(result)");
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "character_signature_maneuver_revisions"');
    for (const key of ["CHARACTER_SIGNATURE_ABILITY_KIND_IMMUTABLE", "CHARACTER_SIGNATURE_REVISION_KIND", "CHARACTER_SIGNATURE_REVISION_PREDECESSOR", "own Maneuver revision required"]) expect(migration).toContain(key);
    expect(migration).not.toMatch(/UPDATE "character_signature_spell_revisions"|DELETE FROM|CASCADE/);
    expect(read(D + "weapon-repository.ts")).toContain("FOR UPDATE");
  });

  it("M6-I120: eight strict thin Maneuver routes and no client price channel", () => {
    const registry = JSON.parse(read("docs/architecture/m6-api-routes.json"));
    expect(registry["M6-WO8"].sort()).toEqual([...routes].sort());
    for (const f of routes) { const s = code(read(f)); expect(s).toContain('from "@prowess/db"'); expect(s).toContain("toErrorResponse(error)"); expect(s).not.toMatch(/prisma|from "@prowess\/(game|rules)"|finalApCost|protectedActionAp/); }
    expect(read(routes[0]!)).toContain('readStrictBody(request, ["name"])');
    expect(read(routes[3]!)).toContain('readStrictBody(request, ["expectedVersion", "draft"])');
    for (const f of routes.slice(4)) expect(read(f)).toContain('readStrictBody(request, ["expectedVersion"])');
    expect(adapter).not.toMatch(/r\.(apCost|mpCost|targeting|constructionOptions)/);
  });

  it("M6-I123 M6-I124 M6-I125: versioned exact Action floor and post-floor Signature, preserving historical M5", () => {
    const cost = read(G + "ability/maneuver-cost.ts"), policy = read(G + "definition/maneuver-cost-policy.ts");
    expect(policy).toContain('"M6-WO8-A"'); expect(policy).toContain('"COMMITTED_ACTION_AP"');
    expect(cost).toContain('const actionAp = ofCurrency(contributions.filter(c => c.source === "FOUNDATION"), "AP")');
    expect(cost).toContain('operation: "MODIFIER"'); expect(cost).toContain('"maneuver.protected_action_floor"');
    expect(cost).toContain("protectedActionAp ?? attackFloor");
    expect(cost.indexOf('key("post_condition_ap")')).toBeLessThan(cost.indexOf('key("final_ap")'));
    expect(cost).toContain("appliedConditionFloor: target(plan.protectedActionAp)");
    expect(cost).toContain('costPolicyVersion: "M6-WO8-A"');
  });

  it("M6-I126 M6-I127 M6-I128: exact Performance contract, actual rank, separate preparation and no runtime content synthesis", () => {
    const conditions = read(G + "ability/duration-conditions.ts");
    expect(conditions).toContain("findBundleDefinition(bundle, cr.performance.skill)");
    expect(conditions).toContain("input.skillRanks?.find");
    expect(conditions).toContain("conditions.some(c => c.performance)");
    expect(conditions).toContain("Object.hasOwn(parameters, cr.performance.rankParameter)");
    expect(conditions).toContain("preparationAp: value(c.performance.preparationApStepKey)");
    expect(catalog).toContain("MISSING_PERFORMANCE_CONDITION"); expect(catalog).toContain("MISSING_APPROVED_COST_POLICY");
    for (const f of [G + "index.ts", G + "character/signature-maneuver.ts", G + "character/signature-maneuver-catalog.ts", D + "signature-maneuver-service.ts"]) expect(read(f)).not.toContain("content-updates/");
    expect(read("docs/architecture/m6-wo8-governed-content-candidate.md")).toContain("no canonical Release");
  });

  it("M6-I116 M6-I117: presentation owns no formulas, runtime execution, canon fallback or direct database calls", () => {
    for (const f of [...files(UI), ...files("apps/studio/app/characters/[characterId]/maneuvers")].filter(f => /\.tsx?$/.test(f))) {
      const s = code(read(f));
      expect(s, f).not.toMatch(/from ["'](@prowess\/(game|rules|db)|@prisma\/client)|\bfetch\(|Math\.|\b(finalApCost|finalMpCost|protectedActionAp|baseApCost|baseMpCost|capacity)\s*[+*/-]/);
      expect(s, f).not.toMatch(/executeAbilityResolution|resolveEffectChain|spend(Ap|Mp|Me)|rollDice|createActiveEffect|activateManeuver|performanceConditionCandidate/);
    }
    expect(adapter).toContain("M5-SC-049");
    expect(service).not.toMatch(/executeAbilityResolution|spend(Ap|Mp)|rollDice/);
  });

  it("M6-I109: exact baseline, frozen M4/content, and narrow approved game files", () => {
    const base = JSON.parse(read("docs/architecture/m6-wo8-baseline.json"));
    expect(base.baseCommit).toBe("d005fc30c8c7e175896898c1973e6d3bda144869");
    for (const [f, h] of Object.entries(base.frozenFiles)) expect(hash(f), f).toBe(h);
    const registry = JSON.parse(read("docs/architecture/m6-approved-m5-changes.json"))["M6-WO8"];
    const changed = ["ability/compile.ts", "ability/duration-conditions.ts", "ability/maneuver-cost.ts", "character/signature-spell-catalog.ts", "construction/composition.ts", "construction/legality.ts", "definition/authored-ability-payload.ts", "definition/duration-condition-payload.ts", "definition/maneuver-cost-policy.ts", "definition/trait-payload.ts", "effect/compile.ts", "index.ts", "targeting/compile.ts", "vocabulary/construction.ts"].map(f => G + f);
    const added = ["character-signature-maneuver-world.test.ts", "character-signature-maneuver.test.ts", "character/signature-maneuver-catalog.ts", "character/signature-maneuver.ts", "construction/maneuver-context.ts", "content-updates/m6-wo8-amendment-a.ts", "m6-wo8-amendment.test.ts", "testing/m6-wo8-maneuver-world.json", "testing/signature-maneuver-fixtures.ts"].map(f => G + f);
    expect(Object.keys(registry.changedFiles).sort()).toEqual(changed.sort()); expect(Object.keys(registry.addedFiles).sort()).toEqual(added.sort());
    // A later registered approved change (docs/architecture/m6-approved-m5-changes.json) supersedes a WO8 hash (since PAS-10 M6-WO9).
    for (const [f, h] of Object.entries({ ...registry.changedFiles, ...registry.addedFiles })) expect(hash(f), f).toBe(expectedFrozenHash(f, h as string));
    expect(read(G + "m6-wo7-m5-characterization.test.ts")).toContain("M6-I096");
  });
});

// Semantic contracts complement the engine/lifecycle tests. They parse actual source and inspect named functions,
// call arguments and request/model fields rather than relying on line positions or whitespace-sensitive anchors.
describe("WO8 final permanent contracts (I099–I128)", () => {
  const source = (f: string) => parseSource(f, read(f));
  it("D-I101 exact Release lookup and WO6 bindings cannot be replaced with names or guessed profiles", () => {
    const f = namedFunction(source(G + "character/signature-maneuver.ts"), "evaluateCharacterSignatureManeuver");
    expect(callsNamed(f, "findBundleDefinition").some(c => c.arguments.length === 2 && syntaxIs(c.arguments[0]!, "bundle") && syntaxIs(c.arguments[1]!, "a.source.definition"))).toBe(true);
    for (const kind of ["weapon", "attack"]) expect(callsNamed(f, "isSameExactDefinition").some(c => syntaxIs(c.arguments[0]!, `x.${kind}`) && syntaxIs(c.arguments[1]!, `source.${kind}`))).toBe(true);
    const binding = exactlyOne(callsNamed(f, "bindWeaponAttackToManeuver"), "WO6 binding");
    const properties = descendants(binding.arguments[0]!, ts.isPropertyAssignment);
    expect(properties.some(p => syntaxIs(p, "damageProfileKey: source.damageProfileKey"))).toBe(true);
    expect(descendants(f, ts.isPropertyAssignment).some(p => syntaxIs(p, "provenance: [source.weapon, source.attack]"))).toBe(true);
  });
  it("D-I108 I123 I124 I125 I128 the opt-in floor and final AP bind the actual M4 stages", () => {
    const f = namedFunction(source(G + "ability/maneuver-cost.ts"), "compileManeuverCostCore");
    const floor = namedVariable(f, "protectedActionAp").initializer!;
    expect(ts.isConditionalExpression(floor) && syntaxIs(floor.condition, "policy.extension")).toBe(true);
    expect(syntaxIs(namedVariable(f, "actionAp").initializer!, 'ofCurrency(contributions.filter(c => c.source === "FOUNDATION"), "AP")')).toBe(true);
    const final = namedVariable(f, "finalAp").initializer!;
    expect(callsNamed(final, "bind").some(c => syntaxIs(c.arguments[1]!, "postConditionAp"))).toBe(true);
    expect(callsNamed(final, "modifier").some(c => ts.isStringLiteral(c.arguments[0]!) && c.arguments[0].text === "maneuver.signature" && syntaxIs(c.arguments[2]!, '"SUBTRACT"'))).toBe(true);
    const post = namedVariable(f, "postConditionAp").initializer!;
    expect(callsNamed(post, "bind").some(c => syntaxIs(c.arguments[1]!, "protectedActionAp ?? attackFloor"))).toBe(true);
  });
  it("D-I126 I127 Performance uses the exact Skill, actual rank and separate preparation", () => {
    const f = namedFunction(source(G + "ability/duration-conditions.ts"), "compileDurationConditions");
    expect(callsNamed(f, "findBundleDefinition").some(c => syntaxIs(c.arguments[1]!, "cr.performance.skill"))).toBe(true);
    expect(syntaxIs(namedVariable(f, "rank").initializer!, "input.skillRanks?.find(q => q.skillKey === cr.performance!.skill.canonicalKey)?.rankKey")).toBe(true);
    expect(callsNamed(f, "Object.hasOwn").some(c => syntaxIs(c.arguments[0]!, "parameters") && syntaxIs(c.arguments[1]!, "cr.performance.rankParameter"))).toBe(true);
    expect(descendants(f, ts.isPropertyAssignment).some(p => syntaxIs(p, "consumesSlot: cr.consumesSlot"))).toBe(true);
    const listed = namedVariable(namedFunction(source(G + "ability/maneuver-cost.ts"), "compileManeuverCostCore"), "contributions");
    expect(ts.isArrayLiteralExpression(listed.initializer!) && listed.initializer.elements.length === 0).toBe(true);
  });
  it("D-I099 I111 I119 persisted models contain only ownership, choices, versions and immutable history", () => {
    const schema = read("packages/prowess-db/prisma/schema.prisma");
    const expected: Record<string, string[]> = {
      CharacterSignatureAbility: ["id", "characterId", "character", "abilityKind", "status", "currentRevisionId", "currentRevision", "currentManeuverRevisionId", "currentManeuverRevision", "draftPayload", "lockVersion", "createdAt", "updatedAt", "retiredAt", "revisions", "maneuverRevisions"],
      CharacterSignatureManeuverRevision: ["id", "abilityId", "ability", "revisionNumber", "characterReleaseId", "characterRelease", "previousRevisionId", "previousRevision", "nextRevision", "payload", "createdAt", "currentOf"],
    };
    for (const [model, fields] of Object.entries(expected)) {
      const body = new RegExp(`model\\s+${model}\\s*\\{([\\s\\S]*?)^\\}`, "m").exec(schema)?.[1];
      expect(body, model).toBeDefined();
      expect([...body!.matchAll(/^\s*(\w+)\s+\w/gm)].map(m => m[1]).sort(), model).toEqual([...fields].sort());
    }
    expect(/CREATE\s+TRIGGER\s+"character_signature_maneuver_revisions_append_only"\s+BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+"character_signature_maneuver_revisions"/i.test(migration)).toBe(true);
    for (const f of [D + "signature-maneuver-service.ts", D + "signature-maneuver-repository.ts", D + "signature-spell-repository.ts"]) {
      const calls = descendants(source(f), ts.isCallExpression).map(c => c.expression.getText());
      expect(calls.some(c => /\.(entity|entityVersion|rulesetRelease|changeSet|rulesetManifest)\.(create|update|upsert|delete)/.test(c)), f).toBe(false);
      expect(calls.some(c => /characterSignature(?:Maneuver|Spell)Revision\.(update|delete|upsert)/.test(c)), f).toBe(false);
    }
  });
  it("D-I120 the eight APIs accept exact closed fields rather than client prices or targeting", () => {
    for (const [index, f] of routes.entries()) {
      const bodies = callsNamed(source(f), "readStrictBody");
      const expected = index === 0 ? ["name"] : index === 3 ? ["expectedVersion", "draft"] : ["expectedVersion"];
      if ([1, 2].includes(index)) { expect(bodies).toHaveLength(0); continue; }
      const node = exactlyOne(bodies, `strict body in ${f}`).arguments[1]!;
      expect(ts.isArrayLiteralExpression(node)).toBe(true);
      const fields = ts.isArrayLiteralExpression(node) ? node.elements.map(e => ts.isStringLiteral(e) ? e.text : null) : [];
      expect(fields, f).toEqual(expected);
    }
  });
  it("D-I113 I115 I122 only server-valid drafts reach finalization in their own Release/loadout context", () => {
    const root = source(D + "signature-maneuver-service.ts"), f = namedFunction(root, "finalizeCharacterSignatureManeuver");
    const allowedStates = namedVariable(root, "valid").initializer!;
    expect(descendants(allowedStates, ts.isStringLiteral).map(n => n.text)).toEqual(["VALID", "VALID_WITH_RUNTIME_DEFERRED"]);
    const final = exactlyOne(callsNamed(f, "finalizeSignatureManeuver"), "finalization call");
    const properties = descendants(final.arguments[0]!, ts.isPropertyAssignment);
    for (const contract of ["characterLockVersion: ctx.c.lockVersion", "characterReleaseId: ctx.c.rulesetReleaseId", "weaponLoadoutVersion: ctx.loadoutVersion"]) expect(properties.some(p => syntaxIs(p, contract)), contract).toBe(true);
    expect(descendants(f, ts.isIfStatement).some(n => syntaxIs(n.expression, "valid(result)") && descendants(n.thenStatement, ts.isPropertyAssignment).some(p => syntaxIs(p, "ok: true")))).toBe(true);
    expect(descendants(namedFunction(root, "entryOf"), ts.isBinaryExpression).some(n => syntaxIs(n, "rev.characterReleaseId === ctx.c.rulesetReleaseId"))).toBe(true);
    expect(descendants(namedFunction(root, "detailOf"), ts.isBinaryExpression).some(n => syntaxIs(n, "r.characterReleaseId === ctx.c.rulesetReleaseId"))).toBe(true);
  });
  it("D-I116 I117 no Maneuver frontend or formatter owns mechanical arithmetic or combat execution", () => {
    const front = [...files(UI), ...files("apps/studio/app/characters/[characterId]/maneuvers"), "apps/studio/app/characters/_lib/maneuver-format.ts", "apps/studio/app/characters/_components/sheet/ManeuverRows.tsx"].filter(f => /\.tsx?$/.test(f));
    for (const f of front) expect(maneuverUiFindings(f, read(f)), f).toEqual([]);
    expect(maneuverUiFindings("example.tsx", "const a = value.finalApCost; const b = a; export const price = b - 1;")).toContain("client-mechanical-arithmetic");
    expect(syntaxTokens('value /* comment */ === "ACTIVE"')).toBe(syntaxTokens("value === 'ACTIVE'"));
  });
  it("D-I103 I106 I121 the public construction contract is Action-first with one global Effect minimum", () => {
    const root = source(G + "character/signature-maneuver.ts");
    const steps = namedVariable(root, "SIGNATURE_MANEUVER_STEPS").initializer!;
    const labels = descendants(steps, ts.isStringLiteral).map(n => n.text);
    expect(labels).toEqual(["CONCEPT", "ACTION_SELECTION", "ACTION_SEQUENCE", "EFFECTS", "TRAITS", "DURATION", "CONDITIONS", "REVIEW", "FINALIZE"]);
    const missing = namedVariable(namedFunction(root, "evaluateCharacterSignatureManeuver"), "missing").initializer!;
    expect(descendants(missing, ts.isConditionalExpression).some(n => syntaxIs(n.condition, "!draft.effects.length") && syntaxIs(n.whenTrue, '["EFFECTS"]'))).toBe(true);
    expect(descendants(root, ts.isPropertyAssignment).some(p => syntaxIs(p, "enforceActionBlockCapacity: true"))).toBe(true);
  });
  it("D-I099–I128 every declared invariant has existing permanent guards and a mutation inventory", () => {
    const invariants = JSON.parse(read("docs/architecture/m6-invariants.json")) as { id: string; guards: string[] }[];
    const expected = Array.from({ length: 30 }, (_, i) => `M6-I${String(i + 99).padStart(3, "0")}`);
    const rows = invariants.filter(x => expected.includes(x.id));
    expect(rows.map(x => x.id)).toEqual(expected);
    for (const row of rows) { expect(row.guards).toContain("apps/studio/tests/unit/m6-wo8-static.test.ts"); expect(row.guards).toContain("scripts/m6-wo8-negative-controls.mjs"); for (const f of row.guards) expect(existsSync(path.join(ROOT, f)), `${row.id}: ${f}`).toBe(true); }
  });
});
