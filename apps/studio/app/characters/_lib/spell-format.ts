/**
 * Signature Spell presentation helpers (PAS-10 M6-WO7). Pure FORMATTING of the server's M5 evaluation: every number
 * shown (MP, AP, capacity, range, Sustain) is copied from the evaluation as given. Nothing here computes a cost, a
 * capacity, a discount or a penalty (§5, §121, M6-I082, M6-I083).
 */
import { formatEnumLabel } from "@prowess/ui";
import type { DefinitionRefDto, SignatureSpellDraftDto, SignatureSpellEntryDto, SpellEvaluationDto, SpellStateDto, SpellStepDto } from "./character-client";

export const SPELL_STEPS: ReadonlyArray<{ key: SpellStepDto | "FINALIZE"; label: string }> = [
  { key: "CONCEPT", label: "Concept" },
  { key: "AUTHORITY", label: "Authority" },
  { key: "TARGETING", label: "Targeting" },
  { key: "EFFECTS", label: "Effects" },
  { key: "EFFECT_CHAIN", label: "Effect Chain" },
  { key: "TRAITS", label: "Traits" },
  { key: "DURATION", label: "Duration" },
  { key: "CASTING_CONDITIONS", label: "Casting Conditions" },
  { key: "REVIEW", label: "Review" },
  { key: "FINALIZE", label: "Finalize" },
];
export type BuilderStep = (typeof SPELL_STEPS)[number]["key"];

/** Text labels for the presentation states (never colour alone, §124). */
export const STATE_LABELS: Readonly<Record<SpellStateDto, string>> = {
  INCOMPLETE: "Incomplete",
  INVALID: "Invalid",
  VALID: "Valid",
  VALID_WITH_RUNTIME_DEFERRED: "Valid — runtime deferred",
  UNREADABLE: "Unreadable",
};
export const STATUS_LABELS: Readonly<Record<SignatureSpellEntryDto["status"], string>> = { DRAFT: "Draft", ACTIVE: "Active", RETIRED: "Retired" };

export const refName = (names: Record<string, string>, ref: DefinitionRefDto | null | undefined): string => (ref ? (names[ref.entityVersionId] ?? ref.canonicalKey) : "—");
export const keywordLabel = (key: string): string => formatEnumLabel(key.replace(/^keyword\./, ""));
export const authorityLabel = (a: string | null): string => (a === null ? "Not chosen" : a === "ARCANE_AUTHORITY" ? "Arcane Authority" : a === "AFFINITY_AUTHORITY" ? "Affinity Authority" : formatEnumLabel(a));

/** The finalizable states — the server still decides on finalization. */
export const isFinalizable = (state: SpellStateDto | undefined): boolean => state === "VALID" || state === "VALID_WITH_RUNTIME_DEFERRED";

/** "11 MP · 2 AP", or null when M5 could not determine the cost (the caller says "Cost unresolved", never zero; §128). */
export function costText(e: SpellEvaluationDto | null | undefined): string | null {
  if (!e || e.cost === null) return null;
  return `${e.cost.finalMp} MP · ${e.cost.finalAp} AP`;
}
/** Why the cost is unresolved: the M5 cost problems, else the first construction issue, else what is missing. */
export function costUnresolvedReason(e: SpellEvaluationDto | null | undefined): string {
  if (!e) return "the Spell could not be read";
  if (e.costUnresolved.length > 0) return e.costUnresolved.map((q) => q.message).join("; ");
  if (e.missing.length > 0) return `choose ${e.missing.map((s) => formatEnumLabel(s).toLowerCase()).join(", ")} first`;
  return e.issues[0]?.message ?? "the Spell is not valid yet";
}

export function rangeText(e: SpellEvaluationDto | null | undefined): string {
  const r = e?.targeting?.range;
  if (!r) return "—";
  if (r.value !== null) return `${r.value} ${r.unit ?? ""}`.trim();
  return r.ruleText ?? formatEnumLabel(r.model);
}

/** The draft that the Character uses (the current revision), else the working draft. */
export function shownOf(entry: SignatureSpellEntryDto): { draft: SignatureSpellDraftDto | null; evaluation: SpellEvaluationDto | null } {
  return entry.current ?? entry.draft ?? { draft: null, evaluation: null };
}

/** The compact Sheet / Library line (§94): "Ember Bolt — 2 AP · 11 MP — Single Target · 45 ft — Damage". */
export function compactSpellLine(entry: SignatureSpellEntryDto, names: Record<string, string>): { name: string; cost: string; targeting: string; effects: string } {
  const { draft, evaluation } = shownOf(entry);
  return {
    name: draft?.concept.name ?? "Unreadable Spell",
    cost: evaluation?.cost ? `${evaluation.cost.finalAp} AP · ${evaluation.cost.finalMp} MP` : "Cost unresolved",
    targeting: draft?.targeting ? `${refName(names, draft.targeting.definition)} · ${rangeText(evaluation)}` : "—",
    effects: evaluation ? evaluation.effects.map((x) => formatEnumLabel(x.family)).join(", ") || "—" : "—",
  };
}

/** Narrative tags are free text, split on commas (never mechanical Keywords, §86). */
export const tagsFromText = (text: string): string[] => text.split(",").map((t) => t.trim()).filter((t) => t !== "");

export const stepOf = (key: string): BuilderStep => (SPELL_STEPS.some((s) => s.key === key) ? (key as BuilderStep) : "REVIEW");
