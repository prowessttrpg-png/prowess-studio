import type { RulesetContext } from "@prowess/rules";
import { buildCharacterMechanicalProfile, type CharacterCreationCandidate, type CharacterProgressionState, type CommittedAdvancement, type ProfileEquipmentContext, type ProfileResult, type ProwessDefinitionBundle } from "@prowess/game";
import type { AdvancementRow } from "./advancement-repository.js";

/**
 * Persisted Character → the pure progression state @prowess/game rebuilds a profile from (PAS-10 M6-WO4). This module
 * only RESHAPES rows: the creation choices and the ordered advancement records, exactly as stored. It computes nothing;
 * the one CharacterMechanicalProfile builder lives in @prowess/game (§49–§50).
 */
export function committedOf(row: AdvancementRow): CommittedAdvancement {
  return {
    toLevel: row.toLevel,
    statAllocations: Object.fromEntries(row.statAdvancements.map((s) => [s.stat, s.pointsSpent])),
    skillAdvancements: row.skillAdvancements.map((s) => ({ action: s.action, skill: { entityId: s.skillEntityId, entityVersionId: s.skillEntityVersionId } })),
    affinityChoice:
      row.affinityChoice === null
        ? null
        : { optionKey: row.affinityChoice.optionKey, affinity: row.affinityChoice.affinityEntityId !== null && row.affinityChoice.affinityEntityVersionId !== null ? { entityId: row.affinityChoice.affinityEntityId, entityVersionId: row.affinityChoice.affinityEntityVersionId } : null },
  };
}

export function progressionOf(creation: CharacterCreationCandidate, level: number, history: readonly AdvancementRow[]): CharacterProgressionState {
  return { creation, level, history: history.map(committedOf) };
}

/**
 * The Character's present mechanical profile, rebuilt against its exact Release bundle. PAS-10 M6-WO6: an optional
 * equipment context (the equipped Weapons' while-equipped modifiers) goes to the SAME builder; without it the call is
 * exactly the M6-WO4 call.
 */
export function profileOf(bundle: ProwessDefinitionBundle, ruleset: RulesetContext, progression: CharacterProgressionState, equipment: ProfileEquipmentContext | null = null): ProfileResult {
  return equipment === null ? buildCharacterMechanicalProfile({ bundle, ruleset, character: progression }) : buildCharacterMechanicalProfile({ bundle, ruleset, character: progression, equipment });
}
