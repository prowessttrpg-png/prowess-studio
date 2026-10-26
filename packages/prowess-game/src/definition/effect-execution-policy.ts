import type { PathSegment } from "../internal/plain-data.js";
import { Problems, isExactCanonicalKey, own, readEnum, readRecord } from "../internal/problems.js";
import { DEFINITION_ERROR_CODES as C } from "./codes.js";

export const MARTIAL_SAVE_CONTROLS = ["DEFENDER_CHOOSES", "ATTACKER_REMOVES_ONE", "ATTACKER_CHOOSES"] as const;
export type MartialSaveControl = (typeof MARTIAL_SAVE_CONTROLS)[number];
export interface EffectExecutionPolicy {
  readonly defaultChainBehavior: "SUCCESS_ONLY" | "CONTINUE";
  readonly martialSkillKey: string;
  readonly martialSaveControl: Readonly<Record<string, MartialSaveControl>>;
  readonly authority: readonly string[];
}
/** Additive M5-WO12 policy inside ABILITY_CONSTRUCTION_RULE: the ruled default chain behavior and Martial Save control. */
export function readEffectExecutionPolicy(value: unknown, at: readonly PathSegment[], p: Problems): EffectExecutionPolicy | null {
  const before = p.count, e = C.INVALID_PAYLOAD;
  const fields = ["defaultChainBehavior", "martialSkillKey", "martialSaveControl", "authority"];
  const r = readRecord(value, at, p, e, fields, fields); if (!r) return null;
  const defaultChainBehavior = readEnum(own(r, "defaultChainBehavior"), ["SUCCESS_ONLY", "CONTINUE"] as const, [...at, "defaultChainBehavior"], p, e, "default Chain Behavior");
  const martialSkillKey = own(r, "martialSkillKey");
  if (!isExactCanonicalKey(martialSkillKey)) p.add(e, [...at, "martialSkillKey"], "exact Martial Skill canonical key");
  const control = readRecord(own(r, "martialSaveControl"), [...at, "martialSaveControl"], p, e, ["TRAINED", "EXPERT", "MASTER"], ["TRAINED", "EXPERT", "MASTER"]);
  const martialSaveControl: Record<string, MartialSaveControl> = {};
  if (control) for (const rank of ["TRAINED", "EXPERT", "MASTER"]) { const v = readEnum(own(control, rank), MARTIAL_SAVE_CONTROLS, [...at, "martialSaveControl", rank], p, e, "Martial Save control"); if (v) martialSaveControl[rank] = v; }
  const authority = own(r, "authority");
  if (!Array.isArray(authority) || !authority.every((x) => typeof x === "string")) p.add(e, [...at, "authority"], "authority is a list of source locators");
  return p.count > before || !defaultChainBehavior ? null : { defaultChainBehavior, martialSkillKey: martialSkillKey as string, martialSaveControl, authority: authority as string[] };
}
