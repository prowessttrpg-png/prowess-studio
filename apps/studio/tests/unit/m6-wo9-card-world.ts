/**
 * PAS-10 M6-WO9 Phase C — the card PRESENTATION test world. Every card here is produced by the real @prowess/game
 * projections over the real M5 / M6 evaluations (the same functions the server's Card Library service calls); this
 * module only arranges them into the Card Library API's JSON shape. Test-only: no app code imports it, nothing is
 * published, and the ACTION_IMPROVEMENT rows are the Phase B test fixtures (never canonical content).
 *
 * The world combines three isolated test Releases — the Signature Spell fixture (Spells), the Signature Maneuver fixture
 * (Maneuvers) and the Weapon fixture with test improvements (Weapons, Attacks, General Actions) — because no single
 * historical test Release carries all of them. Exact Character / Release scoping is proven by the API and DB suites.
 */
import { buildActionDirectory } from "../../../../packages/prowess-game/src/card/action";
import { projectEquipmentCards, type CharacterCardContext } from "../../../../packages/prowess-game/src/card/equipment";
import { mageArtDomainOf } from "../../../../packages/prowess-game/src/card/mage-art";
import { projectManeuverCard, projectSpellCard, type CardProjectionContext } from "../../../../packages/prowess-game/src/card/projection";
import { renderSpellRules } from "../../../../packages/prowess-game/src/card/language";
import { spellRulesOf } from "../../../../packages/prowess-game/src/card/semantics";
import { compileAbilityExecution } from "../../../../packages/prowess-game/src/ability/effect-execution";
import type { CharacterMechanicalProfile } from "../../../../packages/prowess-game/src/character/advancement";
import { emptySignatureManeuverDraft, evaluateCharacterSignatureManeuver, type SignatureManeuverDraft } from "../../../../packages/prowess-game/src/character/signature-maneuver";
import { emptySignatureSpellDraft, evaluateCharacterSignatureSpell, readSignatureSpellDraft, type SignatureSpellDraft } from "../../../../packages/prowess-game/src/character/signature-spell";
import type { ManeuverDefinitionPayload } from "../../../../packages/prowess-game/src/definition/authored-ability-payload";
import { indexWeaponLibrary } from "../../../../packages/prowess-game/src/equipment/catalog";
import { buildCharacterAttackLibrary } from "../../../../packages/prowess-game/src/equipment/library";
import { executionFixture } from "../../../../packages/prowess-game/src/testing/effect-execution-fixtures";
import { signatureManeuverFixture } from "../../../../packages/prowess-game/src/testing/signature-maneuver-fixtures";
import { signatureSpellFixture } from "../../../../packages/prowess-game/src/testing/signature-spell-fixtures";
import { spellCostCharacter } from "../../../../packages/prowess-game/src/testing/spell-cost-fixtures";
import { martialProfile, weaponFixture } from "../../../../packages/prowess-game/src/testing/weapon-fixtures";
import type { FixtureRow } from "../../../../packages/prowess-game/src/testing/character-fixtures";
import type { ActionDirectoryViewDto, CardDto, CardLibraryDto } from "../../app/characters/_lib/card-types";

export const CHARACTER_ID = "00000000-0000-4000-8000-0000000c0009";
export const RELEASE_ID = "00000000-0000-4000-8000-0000000e0009";
export const SPELL_ID = "00000000-0000-4000-8000-0000000a0001";
export const RETIRED_SPELL_ID = "00000000-0000-4000-8000-0000000a0002";
export const MANEUVER_ID = "00000000-0000-4000-8000-0000000a0003";
const RELEASE = { id: RELEASE_ID, rulesetId: "00000000-0000-4000-8000-0000000f0009", rulesetName: "Card Test Ruleset", releaseNumber: 1, versionLabel: "R1", channel: "CORE_PLAYTEST" };

type Loose = any;
const json = <T>(v: unknown): T => JSON.parse(JSON.stringify(v)) as T;
const label = (key: string) => key.split(".").at(-1)!.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// ---- Phase B test-only ACTION_IMPROVEMENT rows ---------------------------------------------------------------------
function improvementRows(): FixtureRow[] {
  const probe = weaponFixture();
  const action = (k: string) => probe.ref(k);
  const SOURCE = { locators: ["s44"], conflicts: [] };
  const NEAR = { kind: "NUMERIC_COMPARE", factKey: "target.distance", operator: "<=", expected: 10, provenance: null };
  const extraUse = (key: string, condition: unknown = null) => ({ modificationKey: key, kind: "ADDITIONAL_USE_CASE", rulesText: `Test use case ${key}.`, condition, useCaseKey: key });
  const row = (key: string, parent: unknown, prerequisites: unknown[], modifications: unknown[]): FixtureRow =>
    ({ canonicalKey: `test.m6wo9.improvement.${key}`, definitionKind: "ACTION_IMPROVEMENT", schemaVersion: 1, payload: { improvementKey: key.toUpperCase(), action: parent, rulesText: `Test improvement ${key}.`, prerequisites, modifications, source: SOURCE } }) as FixtureRow;
  return [
    row("quick_dodge", action("action.dodge"), [{ prerequisiteKey: "LEVEL_3", kind: "LEVEL_AT_LEAST", minimum: 3 }], [{ modificationKey: "QUICK", kind: "ACTION_POINT_COST", rulesText: "Test cost QUICK.", condition: null, actionPointCost: { model: "FIXED", amount: 2 } }]),
    row("close_guard", action("action.dodge"), [], [extraUse("CLOSE_GUARD", NEAR)]),
    row("far_dodge", action("action.dodge"), [{ prerequisiteKey: "LEVEL_9", kind: "LEVEL_AT_LEAST", minimum: 9 }], [extraUse("FAR")]),
    row("expert_dodge", action("action.dodge"), [{ prerequisiteKey: "MARTIAL_MASTER", kind: "SKILL_RANK_AT_LEAST", skillKey: "skill.martial", minimumRank: "MASTER" }], [extraUse("EXPERT")]),
    row("titan_dodge", action("action.dodge"), [{ prerequisiteKey: "STR_99", kind: "STAT_AT_LEAST", stat: "STR", minimum: 99 }], [extraUse("TITAN")]),
  ];
}

function nameMap(refs: readonly { entityVersionId: string; canonicalKey: string }[]): Record<string, string> {
  return Object.fromEntries(refs.map((r) => [r.entityVersionId, label(r.canonicalKey)]));
}

export interface CardWorld {
  readonly library: CardLibraryDto;
  readonly directory: ActionDirectoryViewDto;
  /** Spell cards whose rules model and instructions are the real M5-WO12 chain renderer's (Save + BRANCH chain; trigger). */
  readonly chainCard: CardDto;
  readonly triggerCard: CardDto;
  /** The level-1 directory (before advancement) for state-transition assertions. */
  readonly directoryLevel1: ActionDirectoryViewDto;
}

let cached: CardWorld | null = null;

/** Builds (once per worker) the card world from the real projections. */
export function cardWorld(): CardWorld {
  if (cached !== null) return cached;

  // ---- Weapons, Attacks, General Actions (one test Release with test improvements) -----------------------------------
  const wf = weaponFixture({ extra: improvementRows() });
  const expert = martialProfile(wf, "EXPERT");
  const untrained = martialProfile(wf, "UNTRAINED");
  const ctx = (names: Record<string, string>): CharacterCardContext => ({ characterId: CHARACTER_ID, characterReleaseId: RELEASE_ID, rulesetProvenance: wf.bundle.rulesetProvenance, names });
  const allNames = nameMap(wf.bundle.definitions);
  const library = buildCharacterAttackLibrary({ bundle: wf.bundle, characterProfile: expert, loadout: { mainHand: wf.sel("weapon.long_blade"), mainHandGrip: "TWO_HANDED", offHand: null } });
  const equipment = projectEquipmentCards({ library, weapons: indexWeaponLibrary(wf.bundle).weapons, context: ctx(allNames) });
  const actions = buildActionDirectory({ bundle: wf.bundle, profile: expert, context: ctx(allNames) });
  const actionsLevel1 = buildActionDirectory({ bundle: wf.bundle, profile: untrained, context: ctx(allNames) });

  // ---- Signature Maneuvers ------------------------------------------------------------------------------------------------
  const mf = signatureManeuverFixture();
  const master = martialProfile(mf, "MASTER");
  const attacks = buildCharacterAttackLibrary({ bundle: mf.bundle, characterProfile: master, loadout: { mainHand: mf.sel("weapon.long_blade"), mainHandGrip: "ONE_HANDED", offHand: null } });
  const maneuverDraft = (key: string, name: string): SignatureManeuverDraft => {
    const p = mf.bundle.definitions.find((d) => d.canonicalKey === `fixture.wo11.maneuver.${key}`)!.payload as unknown as ManeuverDefinitionPayload;
    const a0 = attacks.mainHand!.attacks[0]!;
    return {
      ...emptySignatureManeuverDraft(name),
      actions: p.actions.map((a) => ({ componentKey: a.componentKey, order: a.order, source: a.definition.canonicalKey.includes(".attack.") ? { kind: "WEAPON_ATTACK" as const, attackKey: a0.attackKey, weapon: a0.weapon, attack: a0.attack, damageProfileKey: a0.damage[0]!.profileKey } : { kind: "FOUNDATION" as const, definition: a.definition } })),
      effects: p.composition.effects,
      traits: p.composition.traits,
      duration: p.composition.duration ? { definition: p.composition.duration.definition, parameters: p.composition.duration.parameters } : null,
      conditions: p.composition.conditions,
      effectAttachments: p.effectAttachments,
      powerfulBlow: p.powerfulBlow,
    };
  };
  const maneuverCard = (draft: SignatureManeuverDraft, revisionNumber: number | null, role: CardProjectionContext["identity"]["revisionRole"], names: Record<string, string>) => {
    const evaluation = evaluateCharacterSignatureManeuver({ bundle: mf.bundle, ruleset: mf.ruleset, profile: master, attackLibrary: attacks, draft, usedSlots: 0, subject: { kind: "CHARACTER_SIGNATURE_MANEUVER", characterId: CHARACTER_ID, signatureAbilityId: MANEUVER_ID, revisionNumber }, keywords: [] });
    return projectManeuverCard({ evaluation, draft, context: { characterId: CHARACTER_ID, characterReleaseId: RELEASE_ID, identity: { kind: "MANEUVER", abilityId: MANEUVER_ID, revisionNumber, revisionRole: role }, names } });
  };
  const maneuverNames = nameMap(mf.bundle.definitions);

  // ---- Signature Spells -------------------------------------------------------------------------------------------------
  const sf = signatureSpellFixture();
  const spellDraft = (key: string, name: string): SignatureSpellDraft => {
    const c = (sf.bundle.definitions.find((d) => d.canonicalKey === key)!.payload as unknown as { composition: Record<string, Loose> }).composition;
    const pick = ({ componentKey, definition, order, parameters }: Record<string, Loose>) => ({ componentKey, definition, order, parameters });
    const raw = {
      ...emptySignatureSpellDraft(name),
      authority: c.authority.authority,
      affinity: c.affinity?.definition ?? null,
      targeting: { definition: c.targeting.definition, parameters: c.targeting.parameters },
      effects: c.effects.map(pick),
      effectChain: c.branch.effectChain,
      traits: c.traits.map((t: Record<string, Loose>) => ({ ...pick(t), appliesTo: t.appliesTo })),
      duration: { definition: c.duration.definition, parameters: c.duration.parameters },
      castingConditions: c.conditions.map(pick),
    };
    const read = readSignatureSpellDraft(json(raw));
    if (!read.ok) throw new Error(JSON.stringify(read.problems));
    return read.value;
  };
  const character = spellCostCharacter(4);
  const request = (sf as unknown as { request: (k: string, c: object) => { keywords: unknown; ruleset: unknown } }).request("fixture.spell.simple", character);
  const spellNames = nameMap(sf.bundle.definitions);
  const spellCard = (draft: SignatureSpellDraft, abilityId: string, revisionNumber: number | null, role: CardProjectionContext["identity"]["revisionRole"]) => {
    const evaluation = evaluateCharacterSignatureSpell({ bundle: sf.bundle, ruleset: request.ruleset as never, profile: { constructionContext: character } as unknown as CharacterMechanicalProfile, keywords: request.keywords as never, draft, usedSlots: 0, subject: { kind: "CHARACTER_SIGNATURE_SPELL", characterId: CHARACTER_ID, signatureAbilityId: abilityId, revisionNumber } });
    return projectSpellCard({ evaluation, draft, context: { characterId: CHARACTER_ID, characterReleaseId: RELEASE_ID, identity: { kind: "SPELL", abilityId, revisionNumber, revisionRole: role }, names: spellNames } });
  };
  const ember = spellDraft("fixture.wo10.spell.simple", "Ember Bolt");
  const emberOld = spellDraft("fixture.wo10.spell.half", "Ember Bolt");
  const emberDraft = { ...ember, targeting: null };

  const slot = (card: unknown, revisionNumber: number | null) => ({ revisionNumber, card, unavailable: null });
  const lib = {
    contractVersion: 1,
    character: { id: CHARACTER_ID, name: "Card Tester", level: expert.level, lockVersion: 3 },
    release: RELEASE,
    loadout: { version: 1, status: "VALID" },
    spells: [
      {
        abilityId: SPELL_ID,
        abilityKind: "SPELL",
        status: "ACTIVE",
        lockVersion: 4,
        current: slot(spellCard(ember, SPELL_ID, 2, "CURRENT"), 2),
        draft: slot(spellCard(emberDraft, SPELL_ID, null, "DRAFT"), null),
        history: [slot(spellCard(emberOld, SPELL_ID, 1, "HISTORICAL"), 1), { revisionNumber: 0, card: null, unavailable: { code: "CARD.REVISION_OTHER_RELEASE", reason: "this revision is pinned to another Release and is never re-evaluated against the Character's Release" } }],
      },
      { abilityId: RETIRED_SPELL_ID, abilityKind: "SPELL", status: "RETIRED", lockVersion: 2, current: slot(spellCard(spellDraft("fixture.wo10.spell.simple", "Old Spark"), RETIRED_SPELL_ID, 1, "HISTORICAL"), 1), draft: null, history: [] },
    ],
    maneuvers: [
      {
        abilityId: MANEUVER_ID,
        abilityKind: "MANEUVER",
        status: "ACTIVE",
        lockVersion: 3,
        current: slot(maneuverCard(maneuverDraft("multi", "Twin Strike"), 2, "CURRENT", maneuverNames), 2),
        draft: null,
        history: [slot(maneuverCard(maneuverDraft("powerful_blow", "Twin Strike"), 1, "HISTORICAL", maneuverNames), 1)],
      },
    ],
    weapons: equipment.weapons,
    attacks: equipment.attacks,
    actions,
    mageArts: { domain: mageArtDomainOf(wf.bundle), cards: [] },
    // The isolated test Releases reuse the same fixture UUID scheme; the Weapon / Action Release wins any collision.
    names: { ...spellNames, ...maneuverNames, ...allNames },
  };

  // ---- the generated-language showcase: a real M5-WO12 chain (Saving Throw + transitions) through the real renderer -----
  const F = executionFixture();
  const base = json<CardDto>(lib.spells[0]!.current.card);
  const showcase = (key: string, cardKey: string, name: string): CardDto => {
    const plan = compileAbilityExecution(F.ability(key, "MASTER"));
    if (!plan.ok) throw new Error(JSON.stringify(plan.problems));
    const rules = spellRulesOf({ chain: plan.value.chain!, delivery: plan.value.delivery, targets: { kind: plan.value.targetLimit.kind, count: plan.value.targetLimit.maximum }, traits: [] });
    const instructions = renderSpellRules(rules, { labelOf: (r) => label(r.canonicalKey) });
    return { ...base, cardKey, name, rules: json({ status: "AVAILABLE", value: rules }), instructions: json(instructions), snapshot: { ...base.snapshot, cardKey } };
  };
  const chainCard = showcase("fixture.wo12.spell.branch", "SIGNATURE_SPELL:showcase-branch:1", "Branch Showcase");
  const triggerCard = showcase("fixture.wo12.spell.trigger", "SIGNATURE_SPELL:showcase-trigger:1", "Trigger Showcase");

  const directory = (d: unknown): ActionDirectoryViewDto => json({ contractVersion: 1, character: lib.character, release: RELEASE, directory: d, names: allNames });
  cached = { library: json<CardLibraryDto>(lib), directory: directory(actions), directoryLevel1: directory(actionsLevel1), chainCard, triggerCard };
  return cached;
}
