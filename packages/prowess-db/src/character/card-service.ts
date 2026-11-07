import {
  CARD_CONTRACT_VERSION,
  buildActionDirectory,
  buildCharacterAttackLibrary,
  buildSignatureManeuverCatalog,
  evaluateCharacterSignatureSpell,
  mageArtDomainOf,
  projectEquipmentCards,
  projectManeuverCard,
  projectSpellCard,
  readSignatureManeuverDraft,
  readSignatureSpellDraft,
  signatureManeuverComponentRefs,
  signatureSpellComponentRefs,
  type ActionDirectory,
  type AttackCard,
  type CardAbilityIdentity,
  type CardValue,
  type CharacterCardContext,
  type ManeuverCard,
  type ProwessDefinitionRef,
  type SignatureManeuverDraft,
  type SignatureManeuverEvaluation,
  type SignatureSpellDraft,
  type SpellCard,
  type WeaponCard,
} from "@prowess/game";
import { loadSignatureContext, type SignatureContext } from "./signature-context.js";
import { getCharacterSignatureManeuver } from "./signature-maneuver-service.js";
import { performanceForDisplay } from "./signature-maneuver-presentation.js";
import { selectSignatureAbilities, type StoredSignatureAbility } from "./signature-spell-repository.js";
import { namesOf, releaseSummary, type CharacterReleaseSummary } from "./service.js";
import { libraryRefs, loadEquippedCharacter } from "./weapon-service.js";

/**
 * Character Card Library and Action Directory services (PAS-10 M6-WO9 Phase B). READ-ONLY orchestration:
 *
 *   Character + exact Release → the existing authorities (M6-WO4 profile, M6-WO6 Attack Library and loadout, M6-WO7
 *   Signature Spell evaluation, M6-WO8 Signature Maneuver detail and Performance display, M5-WO3 ACTION Definitions,
 *   M6-WO9 ACTION_IMPROVEMENT evaluation) → the pure @prowess/game card projections → views
 *
 * Nothing here evaluates a rule, prices an Ability or persists a derived value: every card is rebuilt from the stored
 * selections on each read against the Character's pinned Release. A revision pinned to another Release is never
 * re-evaluated against this one (it is reported unavailable). No route, no UI, no write (Phase C owns the public API).
 */

export interface CardSlot<C> {
  readonly revisionNumber: number | null;
  readonly card: C | null;
  /** Why no card could be projected (unreadable payload, another Release …), else null. */
  readonly unavailable: { readonly code: string; readonly reason: string } | null;
}
export interface AbilityCardEntry<C> {
  readonly abilityId: string;
  readonly abilityKind: "SPELL" | "MANEUVER";
  readonly status: StoredSignatureAbility["status"];
  readonly lockVersion: number;
  /** The revision the Character uses (ACTIVE) — for a RETIRED Ability its last revision, presented as HISTORICAL. */
  readonly current: CardSlot<C> | null;
  readonly draft: CardSlot<C> | null;
  /** Earlier finalized revisions, oldest first (never the current one). */
  readonly history: readonly CardSlot<C>[];
}

export interface CharacterCardLibraryView {
  readonly contractVersion: typeof CARD_CONTRACT_VERSION;
  readonly character: { readonly id: string; readonly name: string; readonly level: number; readonly lockVersion: number };
  readonly release: CharacterReleaseSummary;
  readonly loadout: { readonly version: number; readonly status: "VALID" | "INVALID" };
  readonly spells: readonly AbilityCardEntry<SpellCard>[];
  readonly maneuvers: readonly AbilityCardEntry<ManeuverCard>[];
  readonly weapons: readonly WeaponCard[];
  readonly attacks: readonly AttackCard[];
  readonly actions: ActionDirectory;
  /** Mage Arts are UNAVAILABLE (reserved kind, no Character-facing domain): no card is fabricated. */
  readonly mageArts: { readonly domain: CardValue<never>; readonly cards: readonly never[] };
  readonly names: Readonly<Record<string, string>>;
}

export interface CharacterActionDirectoryView {
  readonly contractVersion: typeof CARD_CONTRACT_VERSION;
  readonly character: { readonly id: string; readonly name: string; readonly level: number; readonly lockVersion: number };
  readonly release: CharacterReleaseSummary;
  readonly directory: ActionDirectory;
  readonly names: Readonly<Record<string, string>>;
}

const UNREADABLE = { code: "CARD.REVISION_UNREADABLE", reason: "the stored payload no longer reads against its contract" };
const OTHER_RELEASE = { code: "CARD.REVISION_OTHER_RELEASE", reason: "this revision is pinned to another Release and is never re-evaluated against the Character's Release" };
const identityOf = (kind: "SPELL" | "MANEUVER", a: StoredSignatureAbility, revisionNumber: number | null, role: CardAbilityIdentity["revisionRole"]): CardAbilityIdentity => ({ kind, abilityId: a.id, revisionNumber, revisionRole: role });
const activeCount = (all: readonly StoredSignatureAbility[], except: string | null) => all.filter((a) => a.status === "ACTIVE" && a.id !== except).length;
const storedSpell = (raw: unknown): SignatureSpellDraft | null => {
  const out = readSignatureSpellDraft(raw);
  return out.ok ? out.value : null;
};
const actionRefs = (ctx: { readonly bundle: SignatureContext["bundle"] }): ProwessDefinitionRef[] =>
  ctx.bundle.definitions.filter((d) => d.definitionKind === "ACTION" || d.definitionKind === "ACTION_IMPROVEMENT").map((d) => ({ entityId: d.entityId, entityVersionId: d.entityVersionId, canonicalKey: d.canonicalKey, definitionKind: d.definitionKind, systemFamily: d.systemFamily }) as ProwessDefinitionRef);

/** Spell cards: the ONE M6-WO7 evaluator (evaluateCharacterSignatureSpell) over each stored revision / draft. */
function spellEntries(ctx: SignatureContext, all: readonly StoredSignatureAbility[], names: Readonly<Record<string, string>>): AbilityCardEntry<SpellCard>[] {
  return all
    .filter((a) => a.abilityKind === "SPELL")
    .map((a) => {
      const used = activeCount(all, a.id);
      const slot = (raw: unknown, releaseId: string | null, revisionNumber: number | null, role: CardAbilityIdentity["revisionRole"]): CardSlot<SpellCard> => {
        const draft = storedSpell(raw);
        if (draft === null) return { revisionNumber, card: null, unavailable: UNREADABLE };
        if (releaseId !== null && releaseId !== ctx.c.rulesetReleaseId) return { revisionNumber, card: null, unavailable: OTHER_RELEASE };
        const evaluation = evaluateCharacterSignatureSpell({ bundle: ctx.bundle, ruleset: ctx.ruleset, profile: ctx.profile, keywords: ctx.keywords, draft, usedSlots: used, subject: { kind: "CHARACTER_SIGNATURE_SPELL", characterId: ctx.c.id, signatureAbilityId: a.id, revisionNumber } });
        return { revisionNumber, card: projectSpellCard({ evaluation, draft, context: { characterId: ctx.c.id, characterReleaseId: ctx.c.rulesetReleaseId, identity: identityOf("SPELL", a, revisionNumber, role), names } }), unavailable: null };
      };
      const rev = a.revisions.find((r) => r.id === a.currentRevisionId) ?? null;
      return {
        abilityId: a.id,
        abilityKind: "SPELL" as const,
        status: a.status,
        lockVersion: a.lockVersion,
        current: rev === null ? null : slot(rev.payload, rev.characterReleaseId, rev.revisionNumber, a.status === "ACTIVE" ? "CURRENT" : "HISTORICAL"),
        draft: a.draftPayload === null ? null : slot(a.draftPayload, null, null, "DRAFT"),
        history: a.revisions.filter((r) => r.id !== a.currentRevisionId).map((r) => slot(r.payload, r.characterReleaseId, r.revisionNumber, "HISTORICAL")),
      };
    });
}

/** Maneuver cards: the M6-WO8 detail (its own evaluations and release rule) + the WO8 Performance display authority. */
async function maneuverEntries(characterId: string, all: readonly StoredSignatureAbility[], names: Readonly<Record<string, string>>, performance: ReturnType<typeof performanceForDisplay>, releaseId: string): Promise<AbilityCardEntry<ManeuverCard>[]> {
  const out: AbilityCardEntry<ManeuverCard>[] = [];
  for (const a of all.filter((x) => x.abilityKind === "MANEUVER")) {
    const detail = await getCharacterSignatureManeuver(characterId, a.id);
    const slot = (draft: SignatureManeuverDraft | null, evaluation: SignatureManeuverEvaluation | null, revisionReleaseId: string | null, revisionNumber: number | null, role: CardAbilityIdentity["revisionRole"]): CardSlot<ManeuverCard> => {
      if (draft === null) return { revisionNumber, card: null, unavailable: UNREADABLE };
      if (evaluation === null) return { revisionNumber, card: null, unavailable: revisionReleaseId !== null && revisionReleaseId !== releaseId ? OTHER_RELEASE : UNREADABLE };
      const chosen = draft.conditions.map((q) => q.definition.entityVersionId);
      const matched = performance.filter((p) => chosen.includes(p.definition.entityVersionId));
      return { revisionNumber, card: projectManeuverCard({ evaluation, draft, context: { characterId, characterReleaseId: releaseId, identity: identityOf("MANEUVER", a, revisionNumber, role), names }, performance: matched.length === 0 ? null : { conditions: matched } }), unavailable: null };
    };
    const currentRev = detail.history.find((h) => h.current) ?? null;
    out.push({
      abilityId: a.id,
      abilityKind: "MANEUVER",
      status: a.status,
      lockVersion: a.lockVersion,
      current: currentRev === null ? null : slot(currentRev.draft, currentRev.evaluation, currentRev.characterReleaseId, currentRev.revisionNumber, a.status === "ACTIVE" ? "CURRENT" : "HISTORICAL"),
      draft: detail.maneuver.draft === null ? null : slot(detail.maneuver.draft.draft, detail.maneuver.draft.evaluation, null, null, "DRAFT"),
      history: detail.history.filter((h) => !h.current).map((h) => slot(h.draft, h.evaluation, h.characterReleaseId, h.revisionNumber, "HISTORICAL")),
    });
  }
  return out;
}

/** The read-only card inputs shared by the Card Library and the Action Directory: equipped state + context. */
async function cardContextOf(characterId: string) {
  const equipped = await loadEquippedCharacter(characterId);
  const context: Omit<CharacterCardContext, "names"> = { characterId: equipped.c.id, characterReleaseId: equipped.c.rulesetReleaseId, rulesetProvenance: equipped.bundle.rulesetProvenance };
  return { equipped, context };
}

/**
 * The Character Card Library: every card of the Character for its exact Release — Signature Spells and Maneuvers
 * (current, draft and historical revisions; retired Abilities kept as HISTORICAL), the CURRENT loadout's Weapon and
 * Attack cards, the General Action directory and the Mage Art domain status. Read-only; nothing is persisted.
 */
export async function getCharacterCardLibrary(characterId: string): Promise<CharacterCardLibraryView> {
  const { equipped, context } = await cardContextOf(characterId);
  const { c, bundle, base, profile, choice, index, resolved, loadoutVersion } = equipped;
  const spellCtx = await loadSignatureContext(characterId);
  const all = await selectSignatureAbilities(c.id);
  // The M6-WO6 library reads the Character's own (unequipped) profile — exactly as the Attack Library read does.
  const library = buildCharacterAttackLibrary({ bundle, characterProfile: base, loadout: choice });
  // The M6-WO8 Performance display authority over the Maneuver catalog of the equipped Character.
  const maneuverLibrary = buildCharacterAttackLibrary({ bundle, characterProfile: profile, loadout: choice });
  const catalog = buildSignatureManeuverCatalog({ bundle, profile, attackLibrary: maneuverLibrary });
  const performance = performanceForDisplay({ bundle, profile, attackLibrary: maneuverLibrary }, catalog);
  const payloads = (kind: "SPELL" | "MANEUVER") => all.filter((a) => a.abilityKind === kind).flatMap((a) => [a.draftPayload, ...a.revisions.map((r) => r.payload)]);
  const names = await namesOf([
    ...payloads("SPELL").flatMap((raw) => {
      const spell = storedSpell(raw);
      return spell === null ? [] : signatureSpellComponentRefs(spell);
    }),
    ...payloads("MANEUVER").flatMap((raw) => {
      const maneuver = readSignatureManeuverDraft(raw);
      return maneuver.ok ? [...signatureManeuverComponentRefs(maneuver.value)] : [];
    }),
    ...libraryRefs(library),
    ...actionRefs({ bundle }),
  ]);
  const ctx: CharacterCardContext = { ...context, names };
  const equipment = projectEquipmentCards({ library, weapons: index.weapons, context: ctx });
  return {
    contractVersion: CARD_CONTRACT_VERSION,
    character: { id: c.id, name: c.name, level: c.level, lockVersion: c.lockVersion },
    release: await releaseSummary(c.rulesetReleaseId),
    loadout: { version: loadoutVersion, status: resolved.status },
    spells: spellEntries(spellCtx, all, names),
    maneuvers: await maneuverEntries(characterId, all, names, performance, c.rulesetReleaseId),
    weapons: equipment.weapons,
    attacks: equipment.attacks,
    actions: buildActionDirectory({ bundle, profile, context: ctx }),
    mageArts: { domain: mageArtDomainOf(bundle), cards: [] },
    names,
  };
}

/** The Character's Action Directory: every ACTION its Release pins as a General Action card, with its improvements. */
export async function getCharacterActionDirectory(characterId: string): Promise<CharacterActionDirectoryView> {
  const { equipped, context } = await cardContextOf(characterId);
  const { c, bundle, profile } = equipped;
  const names = await namesOf(actionRefs({ bundle }));
  return {
    contractVersion: CARD_CONTRACT_VERSION,
    character: { id: c.id, name: c.name, level: c.level, lockVersion: c.lockVersion },
    release: await releaseSummary(c.rulesetReleaseId),
    directory: buildActionDirectory({ bundle, profile, context: { ...context, names } }),
    names,
  };
}
