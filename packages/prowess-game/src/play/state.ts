import { clonePlainData, deepFreeze, isPlainObject } from "../internal/plain-data.js";
import { PLAY_CONTRACT_VERSION, type PlayRuntimeState } from "./contract.js";

/**
 * PAS-10 M6-WO10 — reads a STORED Play runtime state back (persistence → domain). Closed fields, exact types; the identity
 * (Character, Release, Ruleset provenance) is checked against the Character being played. The held Active Magic state is
 * validated by M5-WO13 itself on every transition (never trusted blindly, never repaired here). Returns null with a reason
 * when the stored value cannot be read — the caller reports a reconciliation state instead of deleting anything.
 */
const FIELDS = ["contractVersion", "characterId", "releaseId", "rulesetProvenance", "advancementCount", "combat", "movementAllowance", "reservedMp", "movement", "activeMagic"];
const COMBAT_FIELDS = ["active", "round", "surprised", "phase", "turn"];
const closed = (v: unknown, fields: readonly string[]): v is Record<string, unknown> => isPlainObject(v) && Object.keys(v).length === fields.length && fields.every((f) => Object.hasOwn(v, f));
const nat = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

export function readPlayRuntimeState(value: unknown, expected: { readonly characterId: string }): { readonly ok: true; readonly state: PlayRuntimeState } | { readonly ok: false; readonly reason: string } {
  if (!closed(value, FIELDS)) return { ok: false, reason: "the stored play state does not have the WO10 contract fields" };
  if (value.contractVersion !== PLAY_CONTRACT_VERSION) return { ok: false, reason: `unsupported play state contract ${String(value.contractVersion)}` };
  if (value.characterId !== expected.characterId) return { ok: false, reason: "the stored play state belongs to another Character" };
  if (typeof value.releaseId !== "string" || !isPlainObject(value.rulesetProvenance)) return { ok: false, reason: "the stored play state has no Release identity" };
  if (!nat(value.advancementCount) || !nat(value.movementAllowance) || !nat(value.reservedMp)) return { ok: false, reason: "the stored counters are not whole numbers" };
  const c = value.combat;
  if (!closed(c, COMBAT_FIELDS) || typeof c.active !== "boolean" || typeof c.surprised !== "boolean" || !(c.round === null || (nat(c.round) && c.round >= 1))) return { ok: false, reason: "the stored combat timing is malformed" };
  if (!["OUT_OF_COMBAT", "AWAITING_ROUND", "ROUND"].includes(String(c.phase)) || !["NOT_TAKEN", "ACTIVE", "ENDED"].includes(String(c.turn))) return { ok: false, reason: "the stored combat phase is malformed" };
  if ((c.phase === "OUT_OF_COMBAT") === c.active) return { ok: false, reason: "the stored combat phase contradicts its active flag" };
  const m = value.movement;
  if (!closed(m, ["grants", "segments"]) || !Array.isArray(m.grants) || !m.grants.every(nat) || !Array.isArray(m.segments) || !m.segments.every((s) => closed(s, ["distance", "terrainKey", "allowanceCost"]) && nat(s.distance) && typeof s.terrainKey === "string" && nat(s.allowanceCost))) return { ok: false, reason: "the stored movement record is malformed" };
  if (!(value.activeMagic === null || isPlainObject(value.activeMagic))) return { ok: false, reason: "the stored Active Magic state is malformed" };
  // A state of another Release is returned as-is: the evaluator reports RECONCILIATION_REQUIRED (never reinterpreted).
  return { ok: true, state: deepFreeze(clonePlainData(value)) as unknown as PlayRuntimeState };
}
