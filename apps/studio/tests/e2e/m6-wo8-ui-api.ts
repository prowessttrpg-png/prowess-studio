import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import "./m6-wo8-fixture-loader";
const spellFixture = JSON.parse(readFileSync(new URL("../unit/fixtures/m6-wo7-builder.json", import.meta.url), "utf8"));
const fixture = JSON.parse(readFileSync(new URL("../unit/fixtures/m6-wo8-builder.json", import.meta.url), "utf8"));
import { sheetFixture } from "../unit/m6-wo5-sheet-fixture";
import type { CharacterDto } from "../../app/characters/_lib/character-client";
import type { ManeuverBuilderDto, ManeuverDraftDto } from "../../app/characters/_lib/maneuver-types";
/** Browser transport fixture only: actual production routes/components and the actual M5/M4 evaluator.
 * Persistence responses are isolated in-memory fixtures; PostgreSQL/API integrity is the accepted Phase B gate.
 * No app imports this file; no fixture is published as a canonical Release. */
export async function maneuverUiApi(page: Page, key = "empty", existingSpell = false) {
  const { signatureManeuverFixture } = await import("../../../../packages/prowess-game/src/testing/signature-maneuver-fixtures");
  const { martialProfile } = await import("../../../../packages/prowess-game/src/testing/weapon-fixtures");
  const { buildCharacterAttackLibrary } = await import("../../../../packages/prowess-game/src/equipment/library");
  const { evaluateCharacterSignatureManeuver } = await import("../../../../packages/prowess-game/src/character/signature-maneuver");
  const views = fixture as unknown as Record<string, ManeuverBuilderDto>;
  const root = structuredClone(views[key]!);
  const sheet = sheetFixture();
  const character: CharacterDto = {
    ...root.character, concept: sheet.identity.concept, status: "CORE_COMPLETE",
    coreCreationCompletedAt: "2026-11-04T00:00:00Z", createdAt: "2026-11-04T00:00:00Z", updatedAt: "2026-11-04T00:00:00Z",
    release: { ...sheet.release, ...root.release }, names: { ...sheet.names, ...root.names },
    choices: { ancestry: sheet.identity.ancestry, ancestryStatChoices: [], statAllocations: {}, skills: [], primaryAffinity: sheet.identity.primaryAffinity },
    resolution: {
      status: "READY", issues: [], capability: { status: "READY", missing: [] },
      resolved: { level: root.character.level, characterDie: sheet.mechanics.combat.characterDie, creationRule: null, ancestry: sheet.identity.ancestry, baseHp: null, baseMp: null, pointBudget: null, pointsSpent: 0, pointsRemaining: null, stats: [], skills: [], freeSkillCount: null, primaryAffinity: sheet.identity.primaryAffinity },
      derivedPreview: null,
    },
  };
  const characterPath = "/api/characters/character", maneuverPath = `${characterPath}/maneuvers/maneuver`;
  const f = signatureManeuverFixture(), base = martialProfile(f, "MASTER");
  let rank: string | null = "MASTER";
  const library = buildCharacterAttackLibrary({ bundle: f.bundle, characterProfile: base, loadout: { mainHand: f.sel("weapon.long_blade"), mainHandGrip: "ONE_HANDED", offHand: null } });
  let version = 1, current: ManeuverBuilderDto["maneuver"]["current"] = null;
  let working = structuredClone(root.maneuver.draft!.draft!);
  let status: "DRAFT" | "ACTIVE" | "RETIRED" = "DRAFT";
  let conflict = false, hasDraft = true;
  const writes: ManeuverDraftDto[] = [], history: ManeuverBuilderDto["history"] = [];
  const evaluate = (draft: ManeuverDraftDto) => evaluateCharacterSignatureManeuver({ bundle: f.bundle, ruleset: f.ruleset, profile: { ...base, constructionContext: { ...base.constructionContext, skillRanks: rank ? [...base.constructionContext.skillRanks, { skillKey: f.ref("test.wo8.skill.performance").canonicalKey, rankKey: rank }] : base.constructionContext.skillRanks } }, attackLibrary: library, draft: draft as unknown as Parameters<typeof evaluateCharacterSignatureManeuver>[0]["draft"], usedSlots: existingSpell ? 1 : 0, subject: { kind: "CHARACTER_SIGNATURE_MANEUVER", characterId: "character", signatureAbilityId: "maneuver", revisionNumber: null }, keywords: [] });
  const view = () => ({ ...root, signature: { ...root.signature, used: status === "ACTIVE" ? current!.evaluation!.authored!.construction.signature.projected : (existingSpell ? 1 : 0) }, maneuver: { ...root.maneuver, status, lockVersion: version, current, draft: hasDraft ? { draft: working, evaluation: evaluate(working) } : null, state: current?.evaluation?.state ?? evaluate(working).state }, history });
  await page.route(url => url.pathname.startsWith("/api/characters/character"), async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const send = (data: unknown, code = 200) => route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(code === 200 ? { data } : data) });
    if (request.method() === "GET") {
      if (path === characterPath) return send(character);
      if (path === `${characterPath}/abilities`) return send({ character: root.character, release: root.release, signature: view().signature, names: root.names, spells: existingSpell ? [spellFixture.finalized.spell] : [], maneuvers: [view().maneuver] });
      if (path === `${characterPath}/sheet`) return send(sheetFixture({ identity: { ...sheet.identity, id: character.id, name: character.name, concept: character.concept, level: character.level }, release: character.release, names: character.names, signatureManeuvers: status === "ACTIVE" && current?.draft ? [{ id: "maneuver", name: current.draft.concept.name, revisionNumber: current.revisionNumber, state: current.evaluation?.state ?? "UNREADABLE", actions: current.draft.actions, effects: current.draft.effects.map(e => e.definition), finalApCost: current.evaluation?.cost?.ap.finalApCost ?? null, finalMpCost: current.evaluation?.cost?.mp.finalMpCost ?? null, keywords: [], warnings: current.evaluation?.runtimeDeferred ?? [] }] : [] }));
      if (path === maneuverPath || path === `${maneuverPath}/builder`) return send(view());
      throw new Error(`Unexpected fixture API request: GET ${path}`);
    }
    const body = request.postDataJSON();
    if (path.endsWith("/maneuvers")) { working.concept.name = body.name; return send(view()); }
    if (conflict || body.expectedVersion !== version) return send({ code: "STALE_WRITE", message: "A different editor saved this Maneuver." }, 409);
    if (path.endsWith("/draft")) { writes.push(structuredClone(body.draft)); working = body.draft; version += 1; return send(view()); }
    if (path.endsWith("/validate")) return send({ evaluation: evaluate(working), lockVersion: version });
    if (path.endsWith("/finalize")) {
      const evaluation = evaluate(working);
      if (evaluation.state !== "VALID" && evaluation.state !== "VALID_WITH_RUNTIME_DEFERRED") return send({ code: "SIGNATURE_MANEUVER_NOT_FINALIZABLE", message: "The server rejected this draft." }, 422);
      const rev = { revisionId: `revision${history.length + 1}`, revisionNumber: history.length + 1, createdAt: "2026-11-04T00:00:00Z", draft: structuredClone(working), evaluation };
      history.forEach(r => { r.current = false; }); history.push({ ...rev, characterReleaseId: "release", current: true } as unknown as ManeuverBuilderDto["history"][number]);
      current = rev as unknown as typeof current; status = "ACTIVE"; hasDraft = false; version += 1;
      return send({ ...view(), maneuver: { ...view().maneuver, draft: null } });
    }
    if (path.endsWith("/rebuild")) { working = structuredClone(current!.draft!); hasDraft = true; version += 1; return send(view()); }
    if (path.endsWith("/retire")) { status = "RETIRED"; hasDraft = false; version += 1; return send(view()); }
    throw new Error(`Unexpected fixture API request: ${request.method()} ${path}`);
  });
  return { root, writes, draft: () => working, version: () => version, setConflict: (value: boolean) => { conflict = value; }, untrain: () => { rank = null; root.performance[0]!.currentRank = "UNTRAINED"; }, noPerformance: () => { root.performance = []; root.catalog.performanceCondition = { present: false, definitions: [] }; root.catalog.conditions = root.catalog.conditions.filter(c => !c.performanceVersion); root.catalog.limitations.push({ code: "MISSING_PERFORMANCE_CONDITION", message: "This Release lacks the approved Performance Condition." }); } };
}
export const builderUrl = "/characters/character/maneuvers/maneuver/edit";
export async function builderStep(page: Page, name: string) { await page.getByRole("tab", { name, exact: true }).click(); }
export async function saveManeuverUi(page: Page) { await page.getByRole("button", { name: "Save now", exact: true }).click(); await expect(page.getByTestId("maneuver-save-state")).toHaveText("Saved"); }
