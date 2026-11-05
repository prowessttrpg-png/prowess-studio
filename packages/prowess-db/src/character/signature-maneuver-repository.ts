import { insertSignatureSpellDraft, writeSignatureSpellDraft, startSignatureSpellRebuild, retireSignatureSpell, finalizeSignatureSpell } from "./signature-spell-repository.js";
/** The shared storage adapter owns both tables and the ONE Character lock. These names select the Maneuver history. */
export const insertSignatureManeuverDraft = (characterId: string, draft: object) => insertSignatureSpellDraft(characterId, draft, "MANEUVER");
export const writeSignatureManeuverDraft = (characterId: string, id: string, expected: number, draft: object | null) => writeSignatureSpellDraft(characterId, id, expected, draft, "MANEUVER");
export const startSignatureManeuverRebuild = (characterId: string, id: string, expected: number) => startSignatureSpellRebuild(characterId, id, expected, "MANEUVER");
export const retireSignatureManeuver = (characterId: string, id: string, expected: number) => retireSignatureSpell(characterId, id, expected, "MANEUVER");
export const finalizeSignatureManeuver = (input: Parameters<typeof finalizeSignatureSpell>[0]) => finalizeSignatureSpell(input, "MANEUVER");
