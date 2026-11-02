import { CHARACTER_ERROR_CODES } from "@prowess/model";
import {
  buildSignatureSpellCatalog,
  emptySignatureSpellDraft,
  evaluateCharacterSignatureSpell,
  readSignatureSpellDraft,
  signatureSpellComponentRefs,
  summarizeSignatureSpell,
  type CharacterMechanicalProfile,
  type CharacterSpellSubject,
  type ProwessDefinitionBundle,
  type ProwessDefinitionRef,
  type SignatureSpellCatalog,
  type SignatureSpellDraft,
  type SignatureSpellState,
  type SignatureSpellSummary,
} from "@prowess/game";
import type { RulesetContext } from "@prowess/rules";
import { prisma } from "../client.js";
import { isUuid } from "../ruleset-release/repository.js";
import { loadCompleted, requireProfile } from "./advancement-service.js";
import { profileOf } from "./progression.js";
import { fail, namesOf, releaseSummary, type CharacterReleaseSummary } from "./service.js";
import {
  finalizeSignatureSpell,
  insertSignatureSpellDraft,
  retireSignatureSpell,
  selectSignatureAbilities,
  selectSignatureAbility,
  startSignatureSpellRebuild,
  writeSignatureSpellDraft,
  type FinalizeOutcome,
  type SignatureAbilityStatus,
  type SpellWriteOutcome,
  type StoredSignatureAbility,
} from "./signature-spell-repository.js";

/**
 * Character Signature Spell service (PAS-10 M6-WO7). Orchestration and persistence only:
 *
 *   Character + exact Release → the ONE mechanical profile (M6-WO4) → the persisted selections (strict reader)
 *   → @prowess/game evaluateCharacterSignatureSpell (the M5 construction, cost and chain compilers) → views
 *
 * Nothing here computes a rule. Every read re-evaluates the stored selections against the Character's exact Release —
 * a stored value is never trusted (§78, §119). The client submits only selections, versions and prose; never a cost,
 * capacity, discount, Signature availability, Sustain or Concentration (§121). Character Spells are never Compendium
 * canon: no Entity, EntityVersion, ChangeSet or Release is created or changed (§6–§7).
 */

export interface SpellContext {
  readonly c: Awaited<ReturnType<typeof loadCompleted>>["c"];
  readonly bundle: ProwessDefinitionBundle;
  readonly ruleset: RulesetContext;
  readonly profile: CharacterMechanicalProfile;
  readonly keywords: readonly { readonly keywordId: string; readonly canonicalKey: string; readonly categoryId: string | null }[];
}

/**
 * The exact M1 Keyword references for every Keyword the Release's Definitions author (component Keywords and Affinity
 * Strength / Weakness lists). A Keyword the database does not define is simply absent: M5 then fails closed.
 */
async function keywordCatalogFor(bundle: ProwessDefinitionBundle): Promise<SpellContext["keywords"]> {
  const keys = new Set<string>();
  const collect = (v: unknown): void => {
    if (Array.isArray(v)) for (const x of v) collect(x);
    else if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v)) (k === "keywords" || k === "matchAny") && Array.isArray(x) ? x.forEach((y) => typeof y === "string" && keys.add(y)) : collect(x);
  };
  for (const d of bundle.definitions) collect(d.payload);
  if (keys.size === 0) return [];
  const rows = await prisma.keywordDefinition.findMany({ where: { canonicalKey: { in: [...keys] } }, select: { id: true, canonicalKey: true, categoryId: true }, orderBy: { canonicalKey: "asc" } });
  return rows.map((r) => ({ keywordId: r.id, canonicalKey: r.canonicalKey, categoryId: r.categoryId }));
}

export async function loadSpellContext(characterId: string): Promise<SpellContext> {
  const { c, bundle, ruleset, progression } = await loadCompleted(characterId);
  const profile = requireProfile(profileOf(bundle, ruleset, progression));
  return { c, bundle, ruleset, profile, keywords: await keywordCatalogFor(bundle) };
}

const subjectOf = (ctx: SpellContext, ability: StoredSignatureAbility | null, revisionNumber: number | null): CharacterSpellSubject => ({ kind: "CHARACTER_SIGNATURE_SPELL", characterId: ctx.c.id, signatureAbilityId: ability?.id ?? null, revisionNumber });
const activeCount = (all: readonly StoredSignatureAbility[], except: string | null) => all.filter((a) => a.status === "ACTIVE" && a.id !== except).length;

/** Reads a stored payload strictly; a payload that no longer reads is reported, never coerced. */
function storedDraft(raw: unknown): SignatureSpellDraft | null {
  const out = readSignatureSpellDraft(raw);
  return out.ok ? out.value : null;
}

export function evaluateStored(ctx: SpellContext, draft: SignatureSpellDraft, usedSlots: number, subject: CharacterSpellSubject): SignatureSpellSummary {
  return summarizeSignatureSpell(evaluateCharacterSignatureSpell({ bundle: ctx.bundle, ruleset: ctx.ruleset, profile: ctx.profile, keywords: ctx.keywords, draft, usedSlots, subject }));
}

export interface SignatureSpellEntry {
  readonly id: string;
  readonly abilityKind: "SPELL";
  readonly status: SignatureAbilityStatus;
  readonly lockVersion: number;
  readonly createdAt: Date;
  readonly retiredAt: Date | null;
  readonly current: { readonly revisionId: string; readonly revisionNumber: number; readonly createdAt: Date; readonly draft: SignatureSpellDraft | null; readonly evaluation: SignatureSpellSummary | null } | null;
  readonly draft: { readonly draft: SignatureSpellDraft | null; readonly evaluation: SignatureSpellSummary | null } | null;
  /** Presentation state of what the Character uses (the current revision), else of the draft. */
  readonly state: SignatureSpellState | "UNREADABLE";
}

function entryOf(ctx: SpellContext, a: StoredSignatureAbility, all: readonly StoredSignatureAbility[]): SignatureSpellEntry {
  const used = activeCount(all, a.id);
  const rev = a.revisions.find((r) => r.id === a.currentRevisionId) ?? null;
  const currentDraft = rev === null ? null : storedDraft(rev.payload);
  const working = a.draftPayload === null ? null : storedDraft(a.draftPayload);
  const current = rev === null ? null : { revisionId: rev.id, revisionNumber: rev.revisionNumber, createdAt: rev.createdAt, draft: currentDraft, evaluation: currentDraft === null ? null : evaluateStored(ctx, currentDraft, used, subjectOf(ctx, a, rev.revisionNumber)) };
  const draft = a.draftPayload === null ? null : { draft: working, evaluation: working === null ? null : evaluateStored(ctx, working, used, subjectOf(ctx, a, null)) };
  const shown = current ?? draft;
  return { id: a.id, abilityKind: "SPELL", status: a.status, lockVersion: a.lockVersion, createdAt: a.createdAt, retiredAt: a.retiredAt, current, draft, state: shown === null || shown.evaluation === null ? "UNREADABLE" : shown.evaluation.state };
}

export interface CharacterAbilitiesView {
  readonly character: { readonly id: string; readonly name: string; readonly level: number; readonly lockVersion: number };
  readonly release: CharacterReleaseSummary;
  /** Signature capacity (the M5 / WO2 statistic on the profile) and the finalized Abilities using it (§15–§18). */
  readonly signature: { readonly capacity: number | null; readonly used: number };
  readonly spells: readonly SignatureSpellEntry[];
  readonly names: Readonly<Record<string, string>>;
}

async function namesFor(ctx: SpellContext, drafts: readonly (SignatureSpellDraft | null)[], extra: readonly ProwessDefinitionRef[] = []): Promise<Record<string, string>> {
  return namesOf([...drafts.flatMap((d) => (d === null ? [] : signatureSpellComponentRefs(d))), ...extra]);
}

export async function getCharacterAbilities(characterId: string): Promise<CharacterAbilitiesView> {
  const ctx = await loadSpellContext(characterId);
  const all = await selectSignatureAbilities(ctx.c.id);
  const spells = all.map((a) => entryOf(ctx, a, all));
  return {
    character: { id: ctx.c.id, name: ctx.c.name, level: ctx.c.level, lockVersion: ctx.c.lockVersion },
    release: await releaseSummary(ctx.c.rulesetReleaseId),
    signature: { capacity: ctx.profile.signatureCapacity, used: activeCount(all, null) },
    spells,
    names: await namesFor(ctx, spells.flatMap((s) => [s.current?.draft ?? null, s.draft?.draft ?? null])),
  };
}

/** One compact Signature Spell line for the Character Sheet's Actions (§94–§95, §134): the CURRENT revision only. */
export interface SheetSignatureSpell {
  readonly id: string;
  readonly name: string;
  readonly revisionNumber: number;
  readonly state: SignatureSpellState;
  readonly finalAp: number | null;
  readonly finalMp: number | null;
  readonly targeting: ProwessDefinitionRef | null;
  readonly range: NonNullable<SignatureSpellSummary["targeting"]>["range"] | null;
  readonly effectFamilies: readonly string[];
  readonly keywords: readonly string[];
  readonly duration: ProwessDefinitionRef | null;
  readonly deferred: SignatureSpellSummary["runtime"]["deferred"];
}

/**
 * The finalized, active Signature Spells for the Character Sheet (M6-WO7 §94). A Character with no Signature Ability
 * row never loads the Spell context, so the M6-WO5 / WO6 sheet is unchanged for it.
 */
export async function signatureSpellsForSheet(characterId: string): Promise<{ readonly spells: readonly SheetSignatureSpell[]; readonly refs: readonly ProwessDefinitionRef[] }> {
  const all = await selectSignatureAbilities(characterId);
  const active = all.filter((a) => a.status === "ACTIVE" && a.currentRevisionId !== null);
  if (active.length === 0) return { spells: [], refs: [] };
  const ctx = await loadSpellContext(characterId);
  const spells: SheetSignatureSpell[] = [];
  const refs: ProwessDefinitionRef[] = [];
  for (const a of active) {
    const rev = a.revisions.find((r) => r.id === a.currentRevisionId);
    const draft = rev === undefined ? null : storedDraft(rev.payload);
    if (rev === undefined || draft === null) continue;
    const e = evaluateStored(ctx, draft, activeCount(all, a.id), subjectOf(ctx, a, rev.revisionNumber));
    refs.push(...signatureSpellComponentRefs(draft));
    spells.push({
      id: a.id,
      name: draft.concept.name,
      revisionNumber: rev.revisionNumber,
      state: e.state,
      finalAp: e.cost?.finalAp ?? null,
      finalMp: e.cost?.finalMp ?? null,
      targeting: draft.targeting?.definition ?? null,
      range: e.targeting?.range ?? null,
      effectFamilies: e.effects.map((x) => x.family),
      keywords: e.keywords,
      duration: draft.duration?.definition ?? null,
      deferred: e.runtime.deferred,
    });
  }
  return { spells, refs };
}

export interface SignatureSpellDetailView extends Omit<CharacterAbilitiesView, "spells"> {
  readonly spell: SignatureSpellEntry;
  /** Every finalized revision, oldest first, each re-evaluated against its own pinned Release (§133). */
  readonly history: readonly { readonly revisionId: string; readonly revisionNumber: number; readonly createdAt: Date; readonly characterReleaseId: string; readonly current: boolean; readonly draft: SignatureSpellDraft | null; readonly evaluation: SignatureSpellSummary | null }[];
}

async function requireAbility(ctx: SpellContext, spellId: string): Promise<{ ability: StoredSignatureAbility; all: StoredSignatureAbility[] }> {
  const id = spellId.trim().toLowerCase();
  const all = await selectSignatureAbilities(ctx.c.id);
  const ability = isUuid(id) ? all.find((a) => a.id === id) : undefined;
  if (ability === undefined) throw fail(CHARACTER_ERROR_CODES.SIGNATURE_SPELL_NOT_FOUND, `No Signature Spell ${spellId} belongs to this Character`);
  return { ability, all };
}

async function detailOf(ctx: SpellContext, ability: StoredSignatureAbility, all: readonly StoredSignatureAbility[]): Promise<SignatureSpellDetailView> {
  const spell = entryOf(ctx, ability, all);
  const used = activeCount(all, ability.id);
  const history = ability.revisions.map((r) => {
    // Characters are pinned to one Release; a revision pinned to another Release (only possible after a future, explicit
    // migration) is never re-evaluated against this one — its mechanics are shown as unavailable instead (§80).
    const draft = storedDraft(r.payload);
    const evaluation = draft === null || r.characterReleaseId !== ctx.c.rulesetReleaseId ? null : evaluateStored(ctx, draft, used, subjectOf(ctx, ability, r.revisionNumber));
    return { revisionId: r.id, revisionNumber: r.revisionNumber, createdAt: r.createdAt, characterReleaseId: r.characterReleaseId, current: r.id === ability.currentRevisionId, draft, evaluation };
  });
  return {
    character: { id: ctx.c.id, name: ctx.c.name, level: ctx.c.level, lockVersion: ctx.c.lockVersion },
    release: await releaseSummary(ctx.c.rulesetReleaseId),
    signature: { capacity: ctx.profile.signatureCapacity, used: activeCount(all, null) },
    spell,
    history,
    names: await namesFor(ctx, [spell.current?.draft ?? null, spell.draft?.draft ?? null, ...history.map((h) => h.draft)]),
  };
}

export async function getCharacterSignatureSpell(characterId: string, spellId: string): Promise<SignatureSpellDetailView> {
  const ctx = await loadSpellContext(characterId);
  const { ability, all } = await requireAbility(ctx, spellId);
  return detailOf(ctx, ability, all);
}

export interface SignatureSpellBuilderView extends SignatureSpellDetailView {
  /** Exactly the Character's Release components, with eligibility and alignment (§82–§85). */
  readonly catalog: SignatureSpellCatalog;
  readonly stats: Readonly<Partial<Record<string, number>>>;
}

/** The ONE builder read (§82, §122): the Spell, its live evaluation and every catalog the builder needs. */
export async function getSignatureSpellBuilder(characterId: string, spellId: string): Promise<SignatureSpellBuilderView> {
  const ctx = await loadSpellContext(characterId);
  const { ability, all } = await requireAbility(ctx, spellId);
  const detail = await detailOf(ctx, ability, all);
  const catalog = buildSignatureSpellCatalog({ bundle: ctx.bundle, profile: ctx.profile });
  const refs = [...catalog.targeting, ...catalog.effects, ...catalog.traits, ...catalog.durations, ...catalog.castingConditions].map((o) => o.ref);
  const names = { ...detail.names, ...(await namesOf([...refs, ...catalog.affinities.map((a) => a.affinity)])) };
  return { ...detail, catalog, stats: ctx.profile.constructionContext.stats, names };
}

// ---- writes ---------------------------------------------------------------------------------------------------------

const readVersion = (value: unknown, what = "expectedVersion"): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw fail(CHARACTER_ERROR_CODES.INVALID_INPUT, `${what} is the version the Signature Spell was loaded at`);
  return value;
};
const requireBody = (body: unknown, fields: readonly string[]): Record<string, unknown> => {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw fail(CHARACTER_ERROR_CODES.INVALID_INPUT, `The body is { ${fields.join(", ")} }`);
  for (const k of Object.keys(body)) if (!fields.includes(k)) throw fail(CHARACTER_ERROR_CODES.INVALID_INPUT, `Unknown field "${k}" — only Spell selections and prose are submitted; cost, capacity and Signature availability are derived`);
  return body as Record<string, unknown>;
};
const readDraft = (raw: unknown): SignatureSpellDraft => {
  const out = readSignatureSpellDraft(raw);
  if (!out.ok) throw fail(CHARACTER_ERROR_CODES.INVALID_SIGNATURE_SPELL, `The Signature Spell draft is not well formed: ${out.problems.map((q) => `${q.path || "/"} ${q.message}`).join("; ")}`);
  return out.value;
};
function writeResult(out: SpellWriteOutcome | FinalizeOutcome): void {
  switch (out.outcome) {
    case "ok":
      return;
    case "stale":
      throw fail(CHARACTER_ERROR_CODES.STALE_WRITE, `This Signature Spell changed since it was loaded (now at version ${out.current}). Reload and try again.`);
    case "not_found":
      throw fail(CHARACTER_ERROR_CODES.SIGNATURE_SPELL_NOT_FOUND, "No such Signature Spell belongs to this Character");
    case "state":
      throw fail(CHARACTER_ERROR_CODES.SIGNATURE_SPELL_STATE, `Not possible for a ${out.status.toLowerCase()} Signature Spell: ${out.reason}`);
    case "character_changed":
      throw fail(CHARACTER_ERROR_CODES.STALE_WRITE, "The Character changed since the Spell was evaluated (e.g. it advanced). Reload and try again.");
    case "rejected":
      throw fail(out.reason === "capacity" ? CHARACTER_ERROR_CODES.SIGNATURE_CAPACITY_EXCEEDED : CHARACTER_ERROR_CODES.SIGNATURE_SPELL_NOT_FINALIZABLE, out.detail);
  }
}

/** Creates a DRAFT Signature Spell with a name; it uses no Signature slot (§12, M6-I089). */
export async function createCharacterSignatureSpell(characterId: string, body: unknown): Promise<SignatureSpellDetailView> {
  const raw = requireBody(body, ["name"]);
  if (typeof raw.name !== "string" || raw.name.trim() === "") throw fail(CHARACTER_ERROR_CODES.INVALID_INPUT, "A new Spell needs a name (display text only)");
  const draft = readDraft(JSON.parse(JSON.stringify(emptySignatureSpellDraft(raw.name))));
  const ctx = await loadSpellContext(characterId);
  const created = await insertSignatureSpellDraft(ctx.c.id, draft);
  return detailOf(ctx, created, await selectSignatureAbilities(ctx.c.id));
}

/** Saves the working composition (any completeness / legality — §12); optimistic concurrency (§87). */
export async function updateCharacterSignatureSpellDraft(characterId: string, spellId: string, body: unknown): Promise<SignatureSpellDetailView> {
  const raw = requireBody(body, ["expectedVersion", "draft"]);
  const expected = readVersion(raw.expectedVersion);
  const draft = raw.draft === null ? null : readDraft(raw.draft);
  const ctx = await loadSpellContext(characterId);
  const { ability } = await requireAbility(ctx, spellId);
  writeResult(await writeSignatureSpellDraft(ctx.c.id, ability.id, expected, draft));
  return getCharacterSignatureSpell(characterId, ability.id);
}

/** Validates the working composition without writing anything (§13 preview). */
export async function validateCharacterSignatureSpell(characterId: string, spellId: string, body: unknown): Promise<{ readonly evaluation: SignatureSpellSummary; readonly lockVersion: number }> {
  requireBody(body ?? {}, ["expectedVersion"]);
  const ctx = await loadSpellContext(characterId);
  const { ability, all } = await requireAbility(ctx, spellId);
  const draft = ability.draftPayload === null ? null : storedDraft(ability.draftPayload);
  if (draft === null) throw fail(CHARACTER_ERROR_CODES.SIGNATURE_SPELL_STATE, "There is no readable draft to validate");
  return { evaluation: evaluateStored(ctx, draft, activeCount(all, ability.id), subjectOf(ctx, ability, null)), lockVersion: ability.lockVersion };
}

/**
 * Finalizes the working composition as revision N+1 — atomically against the Signature roster (§88–§89). Refused unless
 * M5 reports the Spell VALID (or VALID with an explicit runtime deferral, §76) with a Signature slot available.
 */
export async function finalizeCharacterSignatureSpell(characterId: string, spellId: string, body: unknown): Promise<SignatureSpellDetailView> {
  const raw = requireBody(body, ["expectedVersion"]);
  const expected = readVersion(raw.expectedVersion);
  const ctx = await loadSpellContext(characterId);
  const { ability } = await requireAbility(ctx, spellId);
  const out = await finalizeSignatureSpell({
    characterId: ctx.c.id,
    abilityId: ability.id,
    expected,
    characterLockVersion: ctx.c.lockVersion,
    characterReleaseId: ctx.c.rulesetReleaseId,
    decide: (stored, usedSlots) => {
      const draft = storedDraft(stored);
      if (draft === null) return { ok: false, reason: "invalid", detail: "The stored draft no longer reads as a Character Spell" };
      const e = evaluateStored(ctx, draft, usedSlots, subjectOf(ctx, ability, null));
      if (e.state === "VALID" || e.state === "VALID_WITH_RUNTIME_DEFERRED") return { ok: true, payload: JSON.parse(JSON.stringify(draft)) as object };
      // A capacity refusal is one M5 would accept with a free slot: the same Spell evaluated with no other slot used.
      const unconstrained = e.construction?.signature.satisfied === false ? evaluateStored(ctx, draft, 0, subjectOf(ctx, ability, null)).state : null;
      const capacityOnly = unconstrained === "VALID" || unconstrained === "VALID_WITH_RUNTIME_DEFERRED";
      return { ok: false, reason: capacityOnly ? "capacity" : "invalid", detail: capacityOnly ? `No Signature slot is available (${String(usedSlots)} of ${String(e.construction?.signature.capacity ?? "?")} used)` : `The Spell is ${e.state.toLowerCase().replaceAll("_", " ")}: ${e.issues.map((q) => q.message).join("; ") || e.costUnresolved.map((q) => q.message).join("; ")}` };
    },
  });
  writeResult(out);
  return getCharacterSignatureSpell(characterId, ability.id);
}

/** Starts a rebuild of a finalized Spell: the draft becomes a copy of the current revision; the current one stays usable (§91–§92). */
export async function rebuildCharacterSignatureSpell(characterId: string, spellId: string, body: unknown): Promise<SignatureSpellDetailView> {
  const raw = requireBody(body, ["expectedVersion"]);
  const expected = readVersion(raw.expectedVersion);
  const ctx = await loadSpellContext(characterId);
  const { ability } = await requireAbility(ctx, spellId);
  writeResult(await startSignatureSpellRebuild(ctx.c.id, ability.id, expected));
  return getCharacterSignatureSpell(characterId, ability.id);
}

/** Retires the Spell: its Signature slot is released; its history remains (§90, M6-I094). */
export async function retireCharacterSignatureSpell(characterId: string, spellId: string, body: unknown): Promise<SignatureSpellDetailView> {
  const raw = requireBody(body, ["expectedVersion"]);
  const expected = readVersion(raw.expectedVersion);
  const ctx = await loadSpellContext(characterId);
  const { ability } = await requireAbility(ctx, spellId);
  writeResult(await retireSignatureSpell(ctx.c.id, ability.id, expected));
  return getCharacterSignatureSpell(characterId, ability.id);
}
