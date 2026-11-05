import { performanceForDisplay, projectManeuverSheet } from "./signature-maneuver-presentation.js";
import { CHARACTER_ERROR_CODES as E } from "@prowess/model";
import { buildCharacterAttackLibrary, buildSignatureManeuverCatalog, emptySignatureManeuverDraft, evaluateCharacterSignatureManeuver, readSignatureManeuverDraft, signatureManeuverComponentRefs, type SignatureManeuverDraft, type SignatureManeuverEvaluation } from "@prowess/game";
import { loadEquippedCharacter } from "./weapon-service.js";
import { keywordCatalogFor } from "./signature-context.js";
import { selectSignatureAbilities, type StoredSignatureAbility, type FinalizeOutcome } from "./signature-spell-repository.js";
import { insertSignatureManeuverDraft, writeSignatureManeuverDraft, startSignatureManeuverRebuild, retireSignatureManeuver, finalizeSignatureManeuver } from "./signature-maneuver-repository.js";
import { fail, namesOf, releaseSummary } from "./service.js";

async function contextOf(characterId: string) {
  const ctx = await loadEquippedCharacter(characterId);
  return { ...ctx, keywords: await keywordCatalogFor(ctx.bundle), attackLibrary: buildCharacterAttackLibrary({ bundle: ctx.bundle, characterProfile: ctx.profile, loadout: ctx.choice }) };
}
type Context = Awaited<ReturnType<typeof contextOf>>;
const usedSlots = (all: readonly StoredSignatureAbility[], except: string | null) => all.filter(a => a.status === "ACTIVE" && a.id !== except).length;
const stored = (raw: unknown) => { const r = readSignatureManeuverDraft(raw); return r.ok ? r.value : null; };
const evaluate = (ctx: Context, draft: SignatureManeuverDraft, used: number, id: string | null, revisionNumber: number | null) => evaluateCharacterSignatureManeuver({ bundle: ctx.bundle, ruleset: ctx.ruleset, profile: ctx.profile, attackLibrary: ctx.attackLibrary, keywords: ctx.keywords, draft, usedSlots: used, subject: { kind: "CHARACTER_SIGNATURE_MANEUVER", characterId: ctx.c.id, signatureAbilityId: id, revisionNumber } });
const valid = (e: SignatureManeuverEvaluation) => e.state === "VALID" || e.state === "VALID_WITH_RUNTIME_DEFERRED";
export interface SignatureManeuverEntry {
  readonly id: string;
  readonly abilityKind: "MANEUVER";
  readonly status: StoredSignatureAbility["status"];
  readonly lockVersion: number;
  readonly createdAt: Date;
  readonly retiredAt: Date | null;
  readonly current: { readonly revisionId: string; readonly revisionNumber: number; readonly createdAt: Date; readonly draft: SignatureManeuverDraft | null; readonly evaluation: SignatureManeuverEvaluation | null } | null;
  readonly draft: { readonly draft: SignatureManeuverDraft | null; readonly evaluation: SignatureManeuverEvaluation | null } | null;
  readonly state: SignatureManeuverEvaluation["state"] | "UNREADABLE";
}
function entryOf(ctx: Context, a: StoredSignatureAbility, all: readonly StoredSignatureAbility[]): SignatureManeuverEntry {
  const rev = a.revisions.find(r => r.id === a.currentRevisionId), currentDraft = rev ? stored(rev.payload) : null, draft = a.draftPayload === null ? null : stored(a.draftPayload);
  const current = rev ? { revisionId: rev.id, revisionNumber: rev.revisionNumber, createdAt: rev.createdAt, draft: currentDraft, evaluation: currentDraft && rev.characterReleaseId === ctx.c.rulesetReleaseId ? evaluate(ctx, currentDraft, usedSlots(all, a.id), a.id, rev.revisionNumber) : null } : null;
  const working = a.draftPayload === null ? null : { draft, evaluation: draft ? evaluate(ctx, draft, usedSlots(all, a.id), a.id, null) : null };
  return { id: a.id, abilityKind: "MANEUVER", status: a.status, lockVersion: a.lockVersion, createdAt: a.createdAt, retiredAt: a.retiredAt, current, draft: working, state: (current ?? working)?.evaluation?.state ?? "UNREADABLE" };
}
export async function signatureManeuverRoster(characterId: string, all: readonly StoredSignatureAbility[]): Promise<readonly SignatureManeuverEntry[]> {
  const rows = all.filter(a => a.abilityKind === "MANEUVER");
  if (!rows.length) return [];
  const ctx = await contextOf(characterId);
  return rows.map(a => entryOf(ctx, a, all));
}
async function requireAbility(ctx: Context, id: string) {
  const all = await selectSignatureAbilities(ctx.c.id), ability = all.find(a => a.id === id && a.abilityKind === "MANEUVER");
  if (!ability) throw fail(E.SIGNATURE_MANEUVER_NOT_FOUND, "No such Maneuver belongs to this Character");
  return { all, ability };
}
async function detailOf(ctx: Context, ability: StoredSignatureAbility, all: readonly StoredSignatureAbility[]) {
  const maneuver = entryOf(ctx, ability, all);
  const history = ability.revisions.map(r => { const draft = stored(r.payload); return { revisionId: r.id, revisionNumber: r.revisionNumber, characterReleaseId: r.characterReleaseId, createdAt: r.createdAt, current: r.id === ability.currentRevisionId, draft, evaluation: draft && r.characterReleaseId === ctx.c.rulesetReleaseId ? r.id === ability.currentRevisionId ? maneuver.current?.evaluation ?? null : evaluate(ctx, draft, usedSlots(all, ability.id), ability.id, r.revisionNumber) : null }; });
  return { character: { id: ctx.c.id, name: ctx.c.name, level: ctx.c.level, lockVersion: ctx.c.lockVersion }, release: await releaseSummary(ctx.c.rulesetReleaseId), signature: { capacity: ctx.profile.signatureCapacity, used: usedSlots(all, null) }, maneuver, history, names: await namesOf(history.flatMap(r => r.draft ? signatureManeuverComponentRefs(r.draft) : []).concat(maneuver.draft?.draft ? [...signatureManeuverComponentRefs(maneuver.draft.draft)] : [])) };
}
export type SignatureManeuverDetailView = Awaited<ReturnType<typeof detailOf>>;
export async function getCharacterSignatureManeuver(characterId: string, id: string): Promise<SignatureManeuverDetailView> { const ctx = await contextOf(characterId), { ability, all } = await requireAbility(ctx, id); return detailOf(ctx, ability, all); }
export async function getSignatureManeuverBuilder(characterId: string, id: string) {
  const ctx = await contextOf(characterId), { ability, all } = await requireAbility(ctx, id), detail = await detailOf(ctx, ability, all);
  const catalog = buildSignatureManeuverCatalog({ bundle: ctx.bundle, profile: ctx.profile, attackLibrary: ctx.attackLibrary });
  const refs = [...catalog.effects, ...catalog.traits, ...catalog.durations, ...catalog.conditions].map(x => x.ref).concat(catalog.actions.flatMap(a => a.source.kind === "FOUNDATION" ? [a.source.definition] : [a.source.weapon, a.source.attack]));
  const performance = performanceForDisplay(ctx, catalog);
  return { ...detail, catalog, performance, stats: ctx.profile.constructionContext.stats, loadoutVersion: ctx.loadoutVersion, names: { ...detail.names, ...await namesOf(refs) } };
}

/** Read-only sheet projection of CURRENT active revisions through the verified Phase B service. */
export async function signatureManeuversForSheet(characterId: string) {
  const entries = await signatureManeuverRoster(characterId, await selectSignatureAbilities(characterId));
  return projectManeuverSheet(entries);
}


export type SignatureManeuverBuilderView = Awaited<ReturnType<typeof getSignatureManeuverBuilder>>;
function bodyOf(body: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(k => !fields.includes(k)) || fields.some(k => !Object.hasOwn(body, k))) throw fail(E.INVALID_INPUT, `The body contains exactly ${fields.join(", ")}; only authored choices and prose are accepted`);
  return body as Record<string, unknown>;
}
function versionOf(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 1) throw fail(E.INVALID_INPUT, "expectedVersion is the version loaded by the editor"); return value as number; }
function readDraft(raw: unknown): SignatureManeuverDraft { const draft = readSignatureManeuverDraft(raw); if (!draft.ok) throw fail(E.INVALID_SIGNATURE_MANEUVER, draft.problems.map(q => `${q.path}: ${q.message}`).join("; ")); return draft.value; }
function checkWrite(out: FinalizeOutcome): void {
  if (out.outcome === "ok") return;
  if (out.outcome === "stale" || out.outcome === "character_changed") throw fail(E.STALE_WRITE, "The Character, loadout or Maneuver changed. Reload before saving or finalizing.");
  if (out.outcome === "not_found") throw fail(E.SIGNATURE_MANEUVER_NOT_FOUND, "No such Maneuver belongs to this Character");
  if (out.outcome === "state") throw fail(E.SIGNATURE_MANEUVER_STATE, out.reason);
  throw fail(out.reason === "capacity" ? E.SIGNATURE_CAPACITY_EXCEEDED : E.SIGNATURE_MANEUVER_NOT_FINALIZABLE, out.detail);
}
export async function createCharacterSignatureManeuver(characterId: string, body: unknown) {
  const raw = bodyOf(body, ["name"]); if (typeof raw.name !== "string" || !raw.name.trim()) throw fail(E.INVALID_INPUT, "A Maneuver needs a name");
  const draft = readDraft(emptySignatureManeuverDraft(raw.name)), ctx = await contextOf(characterId), created = await insertSignatureManeuverDraft(ctx.c.id, draft);
  return detailOf(ctx, created, await selectSignatureAbilities(ctx.c.id));
}
export async function updateCharacterSignatureManeuverDraft(characterId: string, id: string, body: unknown) {
  const raw = bodyOf(body, ["expectedVersion", "draft"]), expected = versionOf(raw.expectedVersion), draft = raw.draft === null ? null : readDraft(raw.draft), ctx = await contextOf(characterId), { ability } = await requireAbility(ctx, id);
  checkWrite(await writeSignatureManeuverDraft(ctx.c.id, ability.id, expected, draft)); return getCharacterSignatureManeuver(characterId, ability.id);
}
export async function validateCharacterSignatureManeuver(characterId: string, id: string, body: unknown) {
  const raw = bodyOf(body, ["expectedVersion"]), expected = versionOf(raw.expectedVersion), ctx = await contextOf(characterId), { ability, all } = await requireAbility(ctx, id);
  if (ability.lockVersion !== expected) throw fail(E.STALE_WRITE, "The Maneuver changed. Reload before validating.");
  const draft = stored(ability.draftPayload); if (!draft) throw fail(E.SIGNATURE_MANEUVER_STATE, "There is no readable draft to validate");
  return { evaluation: evaluate(ctx, draft, usedSlots(all, ability.id), ability.id, null), lockVersion: ability.lockVersion };
}
export async function finalizeCharacterSignatureManeuver(characterId: string, id: string, body: unknown) {
  const raw = bodyOf(body, ["expectedVersion"]), expected = versionOf(raw.expectedVersion), ctx = await contextOf(characterId), { ability } = await requireAbility(ctx, id);
  const out = await finalizeSignatureManeuver({ characterId: ctx.c.id, abilityId: ability.id, expected, characterLockVersion: ctx.c.lockVersion, characterReleaseId: ctx.c.rulesetReleaseId, weaponLoadoutVersion: ctx.loadoutVersion, decide: (rawDraft, used) => {
    const draft = stored(rawDraft); if (!draft) return { ok: false, reason: "invalid", detail: "The stored Maneuver draft no longer reads" };
    const result = evaluate(ctx, draft, used, ability.id, null);
    if (valid(result)) return { ok: true, payload: JSON.parse(JSON.stringify(draft)) as object };
    const capacityOnly = result.authored?.construction.signature.satisfied === false && valid(evaluate(ctx, draft, 0, ability.id, null));
    return { ok: false, reason: capacityOnly ? "capacity" : "invalid", detail: capacityOnly ? "No shared Signature Ability slot is available" : result.issues.map(q => `${q.path}: ${q.message}`).join("; ") || "The Maneuver is incomplete or unpriceable" };
  } });
  checkWrite(out); return getCharacterSignatureManeuver(characterId, ability.id);
}
export async function rebuildCharacterSignatureManeuver(characterId: string, id: string, body: unknown) { const raw = bodyOf(body, ["expectedVersion"]), expected = versionOf(raw.expectedVersion), ctx = await contextOf(characterId), { ability } = await requireAbility(ctx, id); checkWrite(await startSignatureManeuverRebuild(ctx.c.id, ability.id, expected)); return getCharacterSignatureManeuver(characterId, ability.id); }
export async function retireCharacterSignatureManeuver(characterId: string, id: string, body: unknown) { const raw = bodyOf(body, ["expectedVersion"]), expected = versionOf(raw.expectedVersion), ctx = await contextOf(characterId), { ability } = await requireAbility(ctx, id); checkWrite(await retireSignatureManeuver(ctx.c.id, ability.id, expected)); return getCharacterSignatureManeuver(characterId, ability.id); }
