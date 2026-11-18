import type { JsonObject } from "@prowess/model";
import { deepFreeze, type PathSegment } from "../internal/plain-data.js";
import { Problems, isToken, own, readEnum, readRecord, readSafeInteger } from "../internal/problems.js";
import { DEFINITION_ERROR_CODES as C } from "./codes.js";
import { readSource, type CoreDefinitionSource } from "./core-payload.js";

/**
 * PRE-M7-WO1 — MAGE_ART payload version 1: the smallest contract for AUTHORING and REFERENCE of a Mage Art.
 *
 * It records only what the Core Playtest Mage Art rules establish for every Art (M5 system map §11, s1905–s1913):
 *   - an Art is one fixed discipline (never built from modular Spell components);
 *   - activation costs its listed AP and MP;
 *   - maintenance is paid at the start of each of the user's turns — AP and / or MP, or a special cost stated in text —
 *     and the Art ends when it is not paid;
 *   - while active an Art counts as an Active Effect (Contract only while casting);
 *   - an Art may have modes (Reinforcement: Object / Weapon), each with its own costs and rules.
 * What each Art DOES (Barrier, Domain, Overdrive …) is rules text in v1 — no effect, bonus, radius or cooldown is
 * modelled here, and nothing in this payload is executed: no compiler, card or play operation reads it (the Character
 * card stays UNAVAILABLE, card/mage-art.ts). Executable Mage Arts need a later, explicitly specified version.
 */
export const MAGE_ART_ACTIVE_EFFECT_WINDOWS = deepFreeze(["WHILE_MAINTAINED", "WHILE_CASTING"] as const);
export type MageArtActiveEffectWindow = (typeof MAGE_ART_ACTIVE_EFFECT_WINDOWS)[number];

export interface MageArtCost {
  readonly ap: number;
  readonly mp: number;
}
export interface MageArtMaintenance extends MageArtCost {
  /** A cost that is not AP / MP (e.g. Overdrive's overload damage), stated exactly as authored text; null = none. */
  readonly special: string | null;
}
export interface MageArtMode {
  readonly modeKey: string;
  readonly name: string;
  /** null = the Art's own activation / maintenance apply to this mode. */
  readonly activation: MageArtCost | null;
  readonly maintenance: MageArtMaintenance | null;
  readonly rulesText: string;
}
export interface MageArtPayload {
  readonly artKey: string;
  readonly activation: MageArtCost;
  readonly maintenance: MageArtMaintenance;
  readonly activeEffect: { readonly counts: MageArtActiveEffectWindow };
  readonly modes: readonly MageArtMode[];
  readonly source: CoreDefinitionSource;
}

const FIELDS = ["artKey", "activation", "maintenance", "activeEffect", "modes", "source"];
const MAX_TEXT = 4000;

function cost(value: unknown, at: readonly PathSegment[], p: Problems): MageArtCost | null {
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, ["ap", "mp"], ["ap", "mp"]);
  if (r === null) return null;
  const n = (k: "ap" | "mp") => {
    const v = readSafeInteger(own(r, k), [...at, k], p, C.INVALID_PAYLOAD, k);
    if (v !== null && v < 0) {
      p.add(C.INVALID_PAYLOAD, [...at, k], `${k} is a non-negative whole number`);
      return null;
    }
    return v;
  };
  const ap = n("ap");
  const mp = n("mp");
  return ap === null || mp === null ? null : { ap, mp };
}

function maintenance(value: unknown, at: readonly PathSegment[], p: Problems): MageArtMaintenance | null {
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, ["ap", "mp", "special"], ["ap", "mp", "special"]);
  if (r === null) return null;
  const base = cost({ ap: own(r, "ap"), mp: own(r, "mp") }, at, p);
  const special = own(r, "special");
  if (!(special === null || (typeof special === "string" && special.trim() !== "" && special.length <= MAX_TEXT))) {
    p.add(C.INVALID_PAYLOAD, [...at, "special"], "special is null or the non-empty text of a non-AP/MP maintenance cost");
    return null;
  }
  return base === null ? null : { ...base, special: special as string | null };
}

export function readMageArtPayload(value: unknown, at: readonly PathSegment[], p: Problems): JsonObject | null {
  const before = p.count;
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, FIELDS, FIELDS);
  if (r === null) return null;
  const artKey = own(r, "artKey");
  if (!isToken(artKey)) p.add(C.INVALID_PAYLOAD, [...at, "artKey"], "artKey is a SCREAMING_SNAKE token");
  const activation = cost(own(r, "activation"), [...at, "activation"], p);
  const maint = maintenance(own(r, "maintenance"), [...at, "maintenance"], p);
  const ae = readRecord(own(r, "activeEffect"), [...at, "activeEffect"], p, C.INVALID_PAYLOAD, ["counts"], ["counts"]);
  const counts = ae === null ? null : readEnum(own(ae, "counts"), MAGE_ART_ACTIVE_EFFECT_WINDOWS, [...at, "activeEffect", "counts"], p, C.INVALID_PAYLOAD, "Active Effect window");
  const modes: MageArtMode[] = [];
  const rawModes = own(r, "modes");
  if (!Array.isArray(rawModes)) p.add(C.INVALID_PAYLOAD, [...at, "modes"], "modes is an array (empty = the Art has no modes)");
  else
    rawModes.forEach((x: unknown, i: number) => {
      const mat = [...at, "modes", i];
      const m = readRecord(x, mat, p, C.INVALID_PAYLOAD, ["modeKey", "name", "activation", "maintenance", "rulesText"], ["modeKey", "name", "activation", "maintenance", "rulesText"]);
      if (m === null) return;
      const modeKey = own(m, "modeKey");
      const name = own(m, "name");
      const rulesText = own(m, "rulesText");
      if (!isToken(modeKey) || modes.some((y) => y.modeKey === modeKey)) p.add(C.INVALID_PAYLOAD, [...mat, "modeKey"], "modeKey is a unique SCREAMING_SNAKE token");
      if (typeof name !== "string" || name.trim() === "" || name.length > 200) p.add(C.INVALID_PAYLOAD, [...mat, "name"], "name is non-empty text");
      if (typeof rulesText !== "string" || rulesText.length > MAX_TEXT) p.add(C.INVALID_PAYLOAD, [...mat, "rulesText"], "rulesText is text");
      const act = own(m, "activation") === null ? null : cost(own(m, "activation"), [...mat, "activation"], p);
      const mnt = own(m, "maintenance") === null ? null : maintenance(own(m, "maintenance"), [...mat, "maintenance"], p);
      modes.push({ modeKey: modeKey as string, name: name as string, activation: act, maintenance: mnt, rulesText: rulesText as string });
    });
  const source = readSource(own(r, "source"), [...at, "source"], p);
  if (p.count > before || activation === null || maint === null || counts === null || source === null) return null;
  return { artKey: artKey as string, activation, maintenance: maint, activeEffect: { counts }, modes, source } satisfies MageArtPayload as unknown as JsonObject;
}
