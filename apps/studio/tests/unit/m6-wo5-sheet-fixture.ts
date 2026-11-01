import type { CharacterSheetDto } from "../../app/characters/_lib/character-client";

/** A server-shaped Character Sheet read model for UI tests (PAS-10 M6-WO5). Every number here is "the server's". */
const ref = (id: string, kind: string, canonicalKey = `test.${id}`) => ({ entityId: id, entityVersionId: `${id}-v`, canonicalKey, definitionKind: kind, systemFamily: "CHARACTER" });
const value = (v: number | null, unit: string | null = null, unavailable: string | null = null) => ({ value: v, unit, unavailable, source: v === null ? null : ref("src", "DERIVED_STAT") });
const ranks = (held: number) => ["TRAINED", "EXPERT", "MASTER"].map((rankKey, i) => ({ rankKey, held: i < held }));
const skill = (id: string, rankKey: string, score: number, held: number) => ({ skill: ref(id, "SKILL"), rankKey, score, attemptAllowed: held > 0, ranks: ranks(held) });

export function sheetFixture(over: Partial<CharacterSheetDto> = {}): CharacterSheetDto {
  return {
    identity: { id: "c1", name: "Brakka", concept: "Harbor scout", level: 6, maximumLevel: 99, status: "CORE_COMPLETE", ancestry: ref("orcani", "ANCESTRY"), primaryAffinity: ref("evocation", "AFFINITY"), companyPac: "Harbor Watch" },
    release: { id: "rel1", rulesetId: "rs1", rulesetName: "Core Playtest", releaseNumber: 3, versionLabel: "0.3.0", channel: "CORE_PLAYTEST" },
    portrait: { hasImage: false, mimeType: null, width: null, height: null, zoom: 1, offsetX: 0, offsetY: 0, version: 0, imageUrl: null, maxBytes: 8 * 1024 * 1024 },
    mechanics: {
      stats: ["STR", "AGI", "CON", "PER", "RES", "PRO"].map((stat, i) => ({ stat, total: 3 + i, savingThrow: value(3 + i), definition: ref(`stat-${stat}`, "STAT") })),
      combat: {
        characterDie: { dieKey: "D8", faces: 8 },
        characterDc: value(13),
        accuracy: value(2),
        armor: value(1),
        dodge: value(11),
        initiative: value(6.5),
        movement: value(25, "ft"),
        range: value(90, "ft"),
        concentration: { maximum: value(null, null, "Concentration capacity: this Release defines no rule for it yet") },
      },
      skills: [skill("arcana", "MASTER", 6, 3), skill("athletics", "EXPERT", 4, 2), skill("performance", "UNTRAINED", 0, 0), skill("stealth", "TRAINED", 2, 1)],
      affinities: [
        { affinity: ref("evocation", "AFFINITY"), identity: "EVOCATION", role: "PRIMARY", rank: "EXPERT", authority: { minimumRank: "TRAINED", eligible: true }, strengths: [{ strengthKey: "DIRECT_DAMAGE", matchAny: [] }, { strengthKey: "AREA_EFFECT", matchAny: [] }], weaknesses: [{ weaknessKey: "HEALING", matchAny: [], activationPenaltyPercent: 30, severity: "MAJOR" }] },
        { affinity: ref("conjuration", "AFFINITY"), identity: "CONJURATION", role: "SECONDARY", rank: "TRAINED", authority: { minimumRank: "TRAINED", eligible: true }, strengths: [{ strengthKey: "SUMMON_OR_CONSTRUCT", matchAny: [] }, { strengthKey: "BARRIERS", matchAny: [] }], weaknesses: [{ weaknessKey: "DIRECT_DAMAGE", matchAny: [], activationPenaltyPercent: 20, severity: "MODERATE" }] },
      ],
      attunement: { maximum: value(null, null, "Attunement: this Release defines no rule for it yet"), used: value(null, null, "Attunement: this Release defines no rule for it yet") },
      carry: { currentWeight: value(null, null, "Carry & Weight: this Release defines no rule for it yet"), maximumLoad: value(null, null, "Carry & Weight: this Release defines no rule for it yet") },
      signatureCapacity: 4,
      issues: [],
    },
    resources: [
      { resourceKey: "AP", definition: ref("ap", "RESOURCE"), minimum: 0, maximum: 4, maximumSource: "BASE_AP_CAPACITY", refresh: [], current: 4, stored: false },
      { resourceKey: "HP", definition: ref("hp", "RESOURCE"), minimum: 0, maximum: 18, maximumSource: "MAXIMUM_HP", refresh: [], current: 12, stored: true },
      { resourceKey: "MP", definition: ref("mp", "RESOURCE"), minimum: 0, maximum: 9, maximumSource: "MAXIMUM_MP", refresh: [], current: 9, stored: true },
      { resourceKey: "ME", definition: ref("me", "RESOURCE"), minimum: 0, maximum: 5, maximumSource: "BASE_MANA_EFFICIENCY", refresh: [], current: 5, stored: true },
      { resourceKey: "COUNTER_ACTION", definition: ref("counter", "RESOURCE"), minimum: 0, maximum: 1, maximumSource: "COUNTER_ACTION_CAPACITY", refresh: [], current: 1, stored: true },
    ],
    playStateVersion: 3,
    notes: { actionNotes: "", characterNotes: "", possessions: [], version: 0, limits: { companyPac: 120, actionNotes: 20000, characterNotes: 20000, possessions: 200, category: 60, item: 200, weight: 20 } },
    grantedEffects: [],
    equipment: { available: false, mainHand: null, offHand: null, armor: null, accessorySlots: null, accessories: [] },
    advancementHistoryCount: 5,
    names: { "orcani-v": "Orcani", "evocation-v": "Evocation", "conjuration-v": "Conjuration", "arcana-v": "Arcana", "athletics-v": "Athletics", "performance-v": "Performance", "stealth-v": "Stealth" },
    ...over,
  };
}
