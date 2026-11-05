import type { ManeuverDraftDto, ManeuverEntryDto, ManeuverEvaluationDto, ManeuverSourceDto } from "./maneuver-types";
import { isFinalizable, refName } from "./spell-format";

export const MANEUVER_STEPS = ["CONCEPT", "ACTION_SELECTION", "ACTION_SEQUENCE", "EFFECTS", "TRAITS", "DURATION", "CONDITIONS", "REVIEW", "FINALIZE"] as const;
export type ManeuverStep = typeof MANEUVER_STEPS[number];
export const ordered = <T extends { order: number }>(rows: readonly T[]): T[] => [...rows].sort((a, b) => a.order < b.order ? -1 : a.order > b.order ? 1 : 0);
export const renumber = <T extends { order: number }>(rows: readonly T[]): T[] => rows.map((row, i) => ({ ...row, order: i + 1 }));
export function nextKey(prefix: string, draft: ManeuverDraftDto): string {
  const used = [...draft.actions, ...draft.effects, ...draft.traits, ...draft.conditions].map(x => x.componentKey);
  let n = 1; while (used.includes(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}
export const actionLabel = (names: Record<string, string>, source: ManeuverSourceDto): string => source.kind === "FOUNDATION" ? refName(names, source.definition) : `${refName(names, source.weapon)} · ${refName(names, source.attack)} · ${source.damageProfileKey}`;
export const shownManeuver = (entry: ManeuverEntryDto) => entry.current ?? entry.draft ?? { draft: null, evaluation: null };
export const maneuverCost = (e: ManeuverEvaluationDto | null | undefined) => e && isFinalizable(e.state) && e.cost?.valid ? e.cost : null;
/** Explicit authored relationships only; the server decides whether a group is legal. */
export const attachmentGroups = (draft: ManeuverDraftDto, names: Record<string, string>) => [
  ...(draft.powerfulBlow ? [{ key: "powerful-blow", label: `Powerful Blow (${draft.powerfulBlow.actionKeys.join(", ")})`, actionKeys: draft.powerfulBlow.actionKeys }] : []),
  ...ordered(draft.actions).filter(a => !draft.powerfulBlow?.actionKeys.includes(a.componentKey)).map(a => ({ key: a.componentKey, label: `${a.componentKey}: ${actionLabel(names, a.source)}`, actionKeys: [a.componentKey] })),
];
export function maneuverIssueStep(path: string): ManeuverStep {
  if (/concept/.test(path)) return "CONCEPT";
  if (/powerfulBlow|action_blocks/.test(path)) return "ACTION_SEQUENCE";
  if (/actions|foundation/.test(path)) return "ACTION_SELECTION";
  if (/effect|attachment/i.test(path)) return "EFFECTS";
  if (/trait/i.test(path)) return "TRAITS";
  if (/duration/i.test(path)) return "DURATION";
  if (/condition|performance/i.test(path)) return "CONDITIONS";
  return "REVIEW";
}
