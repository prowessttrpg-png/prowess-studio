/** Permanent M6-WO11 mutation matrix (M6-I173 – M6-I179). CLOSEOUT-03 harness: one green baseline per distinct guard,
 * each control mutates one uniquely anchored REAL source location, the intended guard must fail for the named
 * behavioural / architectural reason, and every file — and the whole working tree — is restored byte-for-byte.
 * Studio mutations run the Library / creation UI suite and the WO11 static gate; database-side mutations run the
 * static gate (their native PostgreSQL behaviour — filtered totals, literal search, write-free reads, idempotent
 * resumption — stays independently mandatory in the DB / API / browser suites registered with the gate).
 * Includes the four regressions named by the Work Order: filtering after pagination (01), a load that writes an event
 * (11), a stale response that wins (13, 14) and save success shown after a failed write (15). */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEdits, runControls, vitestGuard } from "./lib/control-harness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = ["--maxWorkers=1", "--no-file-parallelism", "--reporter=dot"];
const options = { timeout: 600_000, ciEnv: false };
const architecture = vitestGuard(root, "apps/studio", ["tests/unit/m6-wo11-static.test.ts", "-t", "W11-", ...args], options);
const ui = (pattern) => vitestGuard(root, "apps/studio", ["tests/unit/m6-wo11-library-ui.test.tsx", "-t", pattern.source, ...args], options);

const REPO = "packages/prowess-db/src/character/repository.ts", SERVICE = "packages/prowess-db/src/character/service.ts";
const PLAY = "packages/prowess-db/src/character/play-service.ts", ROUTE = "apps/studio/app/api/characters/route.ts";
const CLIENT = "apps/studio/app/characters/_lib/character-client.ts", SAVE = "apps/studio/app/characters/_lib/creation-save.ts";
const INDEX = "apps/studio/app/characters/_components/CharacterIndex.tsx", WIZARD = "apps/studio/app/characters/_components/CharacterWizard.tsx";

// [name, file, edits, guard, intended test / contract pattern]
const rows = [
  // ---- query integrity -------------------------------------------------------------------------------------------------
  ["01 the filter is applied after pagination (page rows unfiltered)", REPO, [["    where: characterListWhere(filter),\n    orderBy:", "    orderBy:"]], architecture, /W11-I173/],
  ["02 the total counts a different set than the rows", REPO, [["return prisma.character.count({ where: characterListWhere(filter) });", "return prisma.character.count();"]], architecture, /W11-I173/],
  ["03 typed % and _ act as wildcards", REPO, [["export const literalLikeText = (text: string) => text.replace(/[\\\\%_]/g, (c) => `\\\\${c}`);", "export const literalLikeText = (text: string) => text;"]], architecture, /W11-I173/],
  ["04 search becomes case-sensitive", REPO, [['{ name: { contains: literalLikeText(filter.search), mode: "insensitive" as const } }', "{ name: { contains: literalLikeText(filter.search) } }"]], architecture, /W11-I173/],
  ["05 the id tie-breaker is dropped", REPO, [['    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],\n    skip,', '    orderBy: [{ updatedAt: "desc" }],\n    skip,']], architecture, /W11-I173/],
  ["06 the Draft filter returns completed Characters", REPO, [['filter.status === "DRAFT" ? { coreCreationCompletedAt: null }', 'filter.status === "DRAFT" ? { coreCreationCompletedAt: { not: null } }']], architecture, /W11-I173/],
  ["07 an unknown query key is accepted", ROUTE, [['strictQuery(searchParams, ["page", "pageSize", "q", "status"]);', 'strictQuery(searchParams, ["page", "pageSize", "q", "status", "sort"]);']], architecture, /W11-I173/],
  ["08 a repeated filter is accepted", ROUTE, [['    for (const key of ["q", "status"]) if (searchParams.getAll(key).length > 1) throw new ApiError("API.INVALID_QUERY", `${key} is accepted once`, 400, key);\n', ""]], architecture, /W11-I173/],
  ["09 the unfiltered client request changes the WO3 contract", CLIENT, [['const status = filter.status === undefined || filter.status === "ALL" ? undefined : filter.status;', 'const status = filter.status ?? "ALL";']], architecture, /W11-I173/],
  // ---- opening is a read -----------------------------------------------------------------------------------------------
  ["10 the Library evaluates every Character's rules", SERVICE, [["  const [total, rows] = await Promise.all([countCharacters(filter), selectCharacterPage((query.page - 1) * query.pageSize, query.pageSize, filter)]);\n", "  const [total, rows] = await Promise.all([countCharacters(filter), selectCharacterPage((query.page - 1) * query.pageSize, query.pageSize, filter)]);\n  await Promise.all(rows.map((r) => releaseRules(r.rulesetReleaseId)));\n"]], architecture, /W11-I174/],
  ["11 opening the Play Workspace writes an event", PLAY, [["  const l = await load(characterId);\n  return viewOf(l, l.stored, l.versions);", "  const l = await load(characterId);\n  await commitPlayOperation({ characterId, rulesetReleaseId: l.releaseId, expectedRuntimeVersion: l.versions.runtimeVersion, expectedPlayStateVersion: l.versions.playStateVersion, resources: null, state: {}, event: { idempotencyKey: characterId, requestHash: \"0\".repeat(64), operationKind: \"NOTE\", classification: \"NOTE\", summary: \"opened\", record: {} } });\n  return viewOf(l, l.stored, l.versions);"]], architecture, /W11-I176/],
  ["12 opening a Character touches its record", SERVICE, [["  const { c, history } = await requireCharacterSnapshot(id);\n  const release = await releaseSummary(c.rulesetReleaseId);\n  const { bundle, ruleset } = await releaseRules(c.rulesetReleaseId);", "  const { c, history } = await requireCharacterSnapshot(id);\n  await prisma.character.update({ where: { id }, data: { updatedAt: new Date() } });\n  const release = await releaseSummary(c.rulesetReleaseId);\n  const { bundle, ruleset } = await releaseRules(c.rulesetReleaseId);"]], architecture, /W11-I174/],
  // ---- latest response owns the screen --------------------------------------------------------------------------------
  ["13 a slower, older Library response wins", INDEX, [["      if (mine !== seq.current) return; // a newer request owns the screen\n", ""]], ui(/a slower, older response never replaces newer results/), /a slower, older response never replaces newer results/],
  ["14 a late response for Character A fills Character B's form", WIZARD, [["      const [c, ctx] = await Promise.all([getCharacter(forId), getCreationContext(forId)]);\n      if (shownId.current !== forId) return;\n", "      const [c, ctx] = await Promise.all([getCharacter(forId), getCreationContext(forId)]);\n"]], ui(/a late response for Character A never updates Character B's form/), /a late response for Character A never updates Character B's form/],
  ["15 save success shown after the second write failed", WIZARD, [['setMessage({ kind: e instanceof CharacterApiError && e.code === "CHARACTER.STALE_WRITE" ? "stale" : "error", text: `The profile was saved, but the creation choices were not: ${reason}. Your choices are kept here; Save & Continue retries only the choices.` });', 'void reason;\n        setMessage({ kind: "ok", text: "Saved." });']], ui(/a failed second write keeps the acknowledged profile/), /a failed second write keeps the acknowledged profile/],
  // ---- save means server-acknowledged ---------------------------------------------------------------------------------
  ["16 the acknowledged version is not adopted (retry goes stale)", WIZARD, [["      if (shownId.current !== forId) return;\n      current = c;\n", "      if (shownId.current !== forId) return;\n"]], ui(/a failed second write keeps the acknowledged profile/), /a failed second write keeps the acknowledged profile/],
  ["17 an unknown outcome repeats the write instead of reading", WIZARD, [["          const now = await getCharacter(forId);", "          const now = choicesChanged ? await saveCreation(forId, current.lockVersion, sentCandidate) : await saveProfile(forId, current.lockVersion, sentProfile.name, null);"]], ui(/an unknown outcome is reconciled by reading the Character/), /an unknown outcome is reconciled by reading the Character/],
  ["18 edits made while saving are overwritten", WIZARD, [['if (parts.profile) setProfile((p) => (p === sentProfile ? { name: c.name, concept: c.concept ?? "" } : p));', 'if (parts.profile) setProfile({ name: c.name, concept: c.concept ?? "" });']], ui(/one save at a time; edits made while saving stay unsaved/), /one save at a time; edits made while saving stay unsaved/],
  ["19 a double click submits twice", WIZARD, [["    if (saving.current) return; // one save at a time — a double click never submits twice\n", ""]], ui(/one save at a time; edits made while saving stay unsaved/), /one save at a time; edits made while saving stay unsaved/],
  ["20 leaving with unsaved edits is not guarded", WIZARD, [['    document.addEventListener("click", onClick, true);\n', ""]], ui(/leaving with unsaved edits asks first/), /leaving with unsaved edits asks first/],
  ["21 a reopened Draft always restarts at Concept", WIZARD, [["      setStep(continuationStep(candidateFrom(c.choices), c.resolution));", "      setStep(0);"]], ui(/a reopened Draft continues where its saved progress needs/), /a reopened Draft continues where its saved progress needs/],
  ["22 network failures are treated as confirmed rejections", SAVE, [['e.code === "NETWORK_ERROR" || e.code === "INVALID_RESPONSE" || e.status >= 500', 'e.status >= 500']], ui(/an unknown outcome is reconciled by reading the Character/), /an unknown outcome is reconciled by reading the Character/],
  // ---- destinations and identity --------------------------------------------------------------------------------------
  ["23 a Draft is offered Resume play", INDEX, [['    : [{ label: "Continue creation", href: `/characters/${id}/create`, testid: "library-continue-creation" }];', '    : [{ label: "Continue creation", href: `/characters/${id}/create`, testid: "library-continue-creation" }, { label: "Resume play", href: `/characters/${id}/play`, testid: "library-resume-play" }];']], ui(/rows carry status actions and a distinguishing id/), /rows carry status actions and a distinguishing id/],
  ["24 same-named Characters are indistinguishable", INDEX, [["                        id <code>{c.id.slice(0, 8)}</code>\n", ""]], ui(/rows carry status actions and a distinguishing id/), /rows carry status actions and a distinguishing id/],
  ["25 the play page reuses one instance across Characters", "apps/studio/app/characters/[characterId]/play/page.tsx", [["<PlayWorkspace key={characterId} characterId={characterId} />", "<PlayWorkspace characterId={characterId} />"]], architecture, /W11-I174/],
];

runControls({
  root,
  title: "M6-WO11",
  controls: rows.map(([name, file, edits, guard, intended]) => ({
    name,
    file,
    mutate: applyEdits(name, edits),
    guard,
    expect: new RegExp(`(?:AssertionError|expected|FAIL)[\\s\\S]*${intended.source}|${intended.source}[\\s\\S]*(?:AssertionError|expected|FAIL)`, "i"),
  })),
  caught: (name) => `Caught and restored: ${name}`,
  done: (count) => `All ${count} M6-WO11 controls caught and restored.`,
});
