/**
 * Card presentation helpers (PAS-10 M6-WO9 Phase C). Pure FORMATTING of the server's Card Presentation Contract: labels,
 * the library's entry list and lookups by exact identity. Nothing here computes a cost, a range, an eligibility or a
 * progression state — every value shown is the server's, and a value the server could not establish is shown with the
 * server's own reason (never zero, never guessed).
 */
import { formatEnumLabel } from "@prowess/ui";
import type { SignatureCardEntryDto, CardCategoryDto, CardDto, CardImprovementEntryDto, CardLibraryDto, CardSlotDto, CardValueDto } from "./card-types";
import type { DefinitionRefDto } from "./character-client";

export const CATEGORY_LABELS: Readonly<Record<CardCategoryDto, string>> = {
  SIGNATURE_SPELL: "Signature Spell",
  SIGNATURE_MANEUVER: "Signature Maneuver",
  WEAPON: "Weapon",
  ATTACK: "Attack",
  GENERAL_ACTION: "General Action",
  MAGE_ART: "Mage Art",
};
export const CATEGORY_FILTERS: ReadonlyArray<{ key: CardCategoryDto | "ALL"; label: string }> = [
  { key: "ALL", label: "All cards" },
  { key: "SIGNATURE_SPELL", label: "Spells" },
  { key: "SIGNATURE_MANEUVER", label: "Maneuvers" },
  { key: "WEAPON", label: "Weapons" },
  { key: "ATTACK", label: "Attacks" },
  { key: "GENERAL_ACTION", label: "General Actions" },
  { key: "MAGE_ART", label: "Mage Arts" },
];

export const AVAILABILITY_LABELS: Readonly<Record<CardDto["availability"], string>> = {
  AVAILABLE: "Available",
  AVAILABLE_WITH_RUNTIME_DEFERRED: "Available — runtime deferred",
  INVALID: "Invalid",
  INCOMPLETE: "Incomplete",
  UNAVAILABLE: "Unavailable",
};

/** The library state of an entry — always shown as text (never colour alone). */
export type EntryState = "ACTIVE" | "DRAFT" | "HISTORICAL" | "RETIRED" | "EQUIPPED" | "AVAILABLE" | "UNAVAILABLE";
export const ENTRY_STATE_LABELS: Readonly<Record<EntryState, string>> = {
  ACTIVE: "Active",
  DRAFT: "Draft — not usable",
  HISTORICAL: "Historical revision — not usable",
  RETIRED: "Retired — not usable",
  EQUIPPED: "Equipped",
  AVAILABLE: "Available",
  UNAVAILABLE: "Unavailable",
};
/** States that may be presented as usable now. Drafts, history and retired Abilities never are. */
export const USABLE_STATES: readonly EntryState[] = ["ACTIVE", "EQUIPPED", "AVAILABLE"];

export const IMPROVEMENT_STATUS_LABELS: Readonly<Record<CardImprovementEntryDto["status"], string>> = {
  ACTIVE: "Active",
  CONDITIONAL: "Conditional",
  FUTURE: "Future",
  UNAVAILABLE: "Unavailable",
  UNRESOLVED: "Unresolved",
};
export const PROGRESSION_LABELS: Readonly<Record<string, string>> = {
  MET: "Met",
  REACHABLE: "Not yet — reached by advancement",
  UNREACHABLE: "Cannot be met in this Release",
  UNDETERMINED: "Not met — no authored progression path",
  UNRESOLVED: "Could not be evaluated",
};
export const SUPPORT_LABELS: Readonly<Record<string, string>> = { APPLIED: "Applied", REFERENCE: "Reference — not executed by the Studio", UNSUPPORTED: "Unsupported — never executed" };

export const refName = (names: Readonly<Record<string, string>>, ref: DefinitionRefDto | null | undefined): string => (ref ? (names[ref.entityVersionId] ?? ref.canonicalKey) : "—");
export const tokenText = (token: string): string => formatEnumLabel(token);

/** A card value as text: the server's value, or the server's reason it has none. */
export function valueText(v: CardValueDto<number> | null | undefined, unit: string): string {
  if (!v) return "—";
  if (v.status === "AVAILABLE") return `${v.value} ${unit}`;
  if (v.status === "DEFERRED") return `Deferred — ${v.reason}`;
  return `Unavailable — ${v.reason}`;
}
/** The short form used on the card's cost strip. */
export function valueShort(v: CardValueDto<number> | null | undefined): string {
  if (!v) return "—";
  return v.status === "AVAILABLE" ? String(v.value) : v.status === "DEFERRED" ? "Deferred" : "—";
}

export function rangeText(card: CardDto): string {
  const t = card.targeting;
  if (t.status !== "AVAILABLE") return t.status === "DEFERRED" ? `Deferred — ${t.reason}` : "—";
  const r = t.value.range;
  if (r.status !== "AVAILABLE") return r.status === "DEFERRED" ? `Deferred — ${r.reason}` : r.reason;
  if (r.value.value !== null) return `${r.value.value} ${r.value.unit ?? ""}`.trim();
  return r.value.ruleText ?? tokenText(r.value.model);
}

export interface LibraryEntry {
  readonly key: string;
  readonly category: CardCategoryDto;
  readonly name: string;
  readonly state: EntryState;
  readonly card: CardDto | null;
  /** Why no card exists (an unreadable revision, another Release, an unavailable domain). */
  readonly reason: string | null;
  readonly abilityId: string | null;
  readonly revisionNumber: number | null;
}

function slotEntry(e: SignatureCardEntryDto, slot: CardSlotDto, state: EntryState, category: CardCategoryDto, suffix: string): LibraryEntry {
  const card = slot.card;
  return {
    key: card?.cardKey ?? `${category}:${e.abilityId}:${suffix}`,
    category,
    name: card?.name ?? "Unreadable revision",
    state,
    card,
    reason: slot.unavailable?.reason ?? null,
    abilityId: e.abilityId,
    revisionNumber: slot.revisionNumber,
  };
}

/** Every Signature Ability slot as library entries: current (ACTIVE / RETIRED), the working draft, then history. */
export function abilityEntries(entries: readonly SignatureCardEntryDto[], category: "SIGNATURE_SPELL" | "SIGNATURE_MANEUVER"): LibraryEntry[] {
  return entries.flatMap((e) => [
    ...(e.current === null ? [] : [slotEntry(e, e.current, e.status === "ACTIVE" ? "ACTIVE" : "RETIRED", category, `r${e.current.revisionNumber ?? ""}`)]),
    ...(e.draft === null ? [] : [slotEntry(e, e.draft, "DRAFT", category, "draft")]),
    ...e.history.map((h) => slotEntry(e, h, "HISTORICAL", category, `r${h.revisionNumber ?? ""}`)),
  ]);
}

/** The whole library as one ordered list (sheet order: Spells, Maneuvers, Weapons, Attacks, General Actions, Mage Arts). */
export function libraryEntries(lib: CardLibraryDto): LibraryEntry[] {
  const plain = (card: CardDto, state: EntryState): LibraryEntry => ({ key: card.cardKey, category: card.category, name: card.name, state, card, reason: null, abilityId: null, revisionNumber: null });
  return [
    ...abilityEntries(lib.spells, "SIGNATURE_SPELL"),
    ...abilityEntries(lib.maneuvers, "SIGNATURE_MANEUVER"),
    ...lib.weapons.map((c) => plain(c, c.availability === "UNAVAILABLE" ? "UNAVAILABLE" : "EQUIPPED")),
    ...lib.attacks.map((c) => plain(c, c.availability === "UNAVAILABLE" ? "UNAVAILABLE" : "AVAILABLE")),
    ...lib.actions.cards.map((c) => plain(c, c.availability === "UNAVAILABLE" ? "UNAVAILABLE" : "AVAILABLE")),
    { key: "MAGE_ART:domain", category: "MAGE_ART" as const, name: "Mage Arts", state: "UNAVAILABLE" as const, card: null, reason: lib.mageArts.domain.status === "AVAILABLE" ? null : lib.mageArts.domain.reason, abilityId: null, revisionNumber: null },
  ];
}

/** Library filtering: category, name search and (by default) only the cards usable now. Pure list selection. */
export function filterEntries(entries: readonly LibraryEntry[], filter: { category: CardCategoryDto | "ALL"; search: string; includeHistory: boolean }): LibraryEntry[] {
  const q = filter.search.trim().toLowerCase();
  return entries.filter(
    (e) =>
      (filter.category === "ALL" || e.category === filter.category) &&
      (q === "" || e.name.toLowerCase().includes(q)) &&
      (filter.includeHistory || USABLE_STATES.includes(e.state) || e.category === "MAGE_ART" || (e.state === "UNAVAILABLE" && e.card !== null)),
  );
}

/**
 * The entry a link asks for, by exact identity only: `card` (an exact card key, including its revision), `ability` (the
 * Ability's current revision — never a draft or a historical one), or `attack` + `hand` (the exact Weapon Attack in that
 * hand). Null when nothing matches: the library never falls back to another revision or another Character's card.
 */
export function findEntry(entries: readonly LibraryEntry[], q: { card?: string | null; ability?: string | null; attack?: string | null; hand?: string | null }): LibraryEntry | null {
  if (q.card) return entries.find((e) => e.key === q.card) ?? null;
  if (q.ability) return entries.find((e) => e.abilityId === q.ability && (e.state === "ACTIVE" || e.state === "RETIRED")) ?? null;
  if (q.attack) return entries.find((e) => e.card?.section.kind === "ATTACK" && e.card.section.attackKey === q.attack && (q.hand === null || q.hand === undefined || e.card.section.equipped.hand === q.hand)) ?? null;
  return null;
}

/** Every revision of one Ability (for the viewer's history list), newest identity first as the server ordered it. */
export function revisionsOf(entries: readonly LibraryEntry[], abilityId: string | null): LibraryEntry[] {
  return abilityId === null ? [] : entries.filter((e) => e.abilityId === abilityId);
}

export const improvementGroups = (list: readonly CardImprovementEntryDto[]) => [
  { key: "ACTIVE", title: "Active improvements", items: list.filter((i) => i.status === "ACTIVE") },
  { key: "CONDITIONAL", title: "Conditional improvements", items: list.filter((i) => i.status === "CONDITIONAL") },
  { key: "FUTURE", title: "Future improvements", items: list.filter((i) => i.status === "FUTURE") },
  { key: "BLOCKED", title: "Unavailable and unresolved improvements", items: list.filter((i) => i.status === "UNAVAILABLE" || i.status === "UNRESOLVED") },
];

export const cardHref = (characterId: string, cardKey: string, mode?: string) => `/characters/${encodeURIComponent(characterId)}/cards?card=${encodeURIComponent(cardKey)}${mode ? `&mode=${encodeURIComponent(mode)}` : ""}`;
export const directoryHref = (characterId: string, actionKey?: string) => `/characters/${encodeURIComponent(characterId)}/actions${actionKey ? `?action=${encodeURIComponent(actionKey)}` : ""}`;
