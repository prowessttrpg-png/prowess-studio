import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { callsNamed, descendants, namedFunction, namedVariable, parseSource, syntaxIs } from "./m6-wo8-audit-helpers";

/**
 * PAS-10 M6-WO11 — Character Library / Save / Load: the permanent architecture gate (invariants M6-I173 – M6-I179).
 * Every test names the invariants it protects (prefix "W11-"); scripts/m6-wo11-negative-controls.mjs mutates the real
 * sources these assertions read and requires the named test to fail. Behaviour is proven by the DB, API, UI and
 * browser suites registered with this gate; this file pins the structure those suites rely on.
 */
const ROOT = path.resolve(process.cwd(), "../..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const src = (f: string) => parseSource(f, read(f));
const REPO = "packages/prowess-db/src/character/repository.ts";
const SERVICE = "packages/prowess-db/src/character/service.ts";
const ROUTE = "apps/studio/app/api/characters/route.ts";
const CLIENT = "apps/studio/app/characters/_lib/character-client.ts";
const SAVE = "apps/studio/app/characters/_lib/creation-save.ts";
const INDEX = "apps/studio/app/characters/_components/CharacterIndex.tsx";
const WIZARD = "apps/studio/app/characters/_components/CharacterWizard.tsx";
const exported = (file: string, name: string) => {
  const v = descendants(src(file), ts.isVariableDeclaration).find((d) => ts.isIdentifier(d.name) && d.name.text === name);
  return v ?? namedFunction(src(file), name);
};

describe("M6-WO11 permanent Character Library / Save / Load contracts", () => {
  it("W11-I173 one filter predicate for count and rows, applied before pagination, in a deterministic order", () => {
    const repo = src(REPO);
    const count = namedFunction(repo, "countCharacters");
    const pageFn = namedFunction(repo, "selectCharacterPage");
    expect(syntaxIs(count.body!, "{ return prisma.character.count({ where: characterListWhere(filter) }); }")).toBe(true);
    const findMany = callsNamed(pageFn, "prisma.character.findMany")[0]!.arguments[0]!.getText();
    expect(findMany).toContain("where: characterListWhere(filter),");
    expect(findMany).toContain('orderBy: [{ updatedAt: "desc" }, { id: "asc" }],');
    expect(findMany.indexOf("where:")).toBeLessThan(findMany.indexOf("skip,"));
    // Literal search: LIKE metacharacters are escaped before Prisma's contains; matching is case-insensitive.
    expect(syntaxIs(namedVariable(repo, "literalLikeText").initializer!, "(text: string) => text.replace(/[\\\\%_]/g, (c) => `\\\\${c}`)")).toBe(true);
    const where = namedFunction(repo, "characterListWhere").getText();
    expect(where).toContain('{ name: { contains: literalLikeText(filter.search), mode: "insensitive" as const } }');
    expect(where).toContain('filter.status === "DRAFT" ? { coreCreationCompletedAt: null } : filter.status === "CORE_COMPLETE" ? { coreCreationCompletedAt: { not: null } } : {}');
    // The service validates once and gives the SAME filter to both queries.
    const list = namedFunction(src(SERVICE), "listCharacters");
    expect(callsNamed(list, "readCharacterListFilter")).toHaveLength(1);
    expect(list.getText()).toContain("Promise.all([countCharacters(filter), selectCharacterPage((query.page - 1) * query.pageSize, query.pageSize, filter)])");
    const reader = namedFunction(src(SERVICE), "readCharacterListFilter").getText();
    expect(reader).toContain('raw === null || raw.trim() === "" ? null : raw.trim()');
    // The route: exactly four accepted keys, each filter given once, invalid values refused with API.INVALID_QUERY.
    const route = read(ROUTE);
    expect(route).toContain('strictQuery(searchParams, ["page", "pageSize", "q", "status"]);');
    expect(route).toContain('for (const key of ["q", "status"]) if (searchParams.getAll(key).length > 1) throw new ApiError("API.INVALID_QUERY"');
    expect(route).toContain('const LIBRARY_STATUSES: readonly string[] = ["ALL", "DRAFT", "CORE_COMPLETE"];');
    expect(route).toContain("if (status !== null && !LIBRARY_STATUSES.includes(status)) throw new ApiError(\"API.INVALID_QUERY\"");
    expect(route).toContain('readStrictBody(request, ["name", "concept", "rulesetReleaseId"])');
    // The client: without a filter it sends exactly the WO3 request.
    const client = namedFunction(src(CLIENT), "listCharacters").getText();
    expect(client).toContain("export async function listCharacters(page = 1, pageSize = 50, filter: CharacterLibraryFilter = {})");
    expect(client).toContain('const status = filter.status === undefined || filter.status === "ALL" ? undefined : filter.status;');
    expect(client).toContain("const q = filter.q?.trim() ? filter.q.trim() : undefined;");
  });

  it("W11-I174 W11-I177 opening is a read: summary rows only; Character reads never write, repair or repin", () => {
    const service = src(SERVICE);
    const list = namedFunction(service, "listCharacters");
    for (const forbidden of ["releaseRules", "validateCharacterCreation", "profileOf", "getCharacterSheet", "materializeProwessDefinitionsFromRelease"]) expect(callsNamed(list, forbidden), forbidden).toHaveLength(0);
    expect(list.getText()).toContain("release: { id: r.rulesetRelease.id,");
    const get = namedFunction(service, "getCharacter").getText();
    expect(get).toContain("await releaseRules(c.rulesetReleaseId)");
    for (const fn of [list, namedFunction(service, "getCharacter")]) expect(fn.getText()).not.toMatch(/\.(create|update|upsert|delete)(Many)?\(|claim\(|inTransaction\(/);
    // Sheet, Play and Card reads stay read-only (their WO5 / WO9 / WO10 gates pin the services; WO11 pins the pages).
    for (const page of ["apps/studio/app/characters/[characterId]/page.tsx", "apps/studio/app/characters/[characterId]/create/page.tsx", "apps/studio/app/characters/[characterId]/play/page.tsx"]) expect(read(page), page).toMatch(/key=\{characterId\}/);
    const play = read("apps/studio/app/characters/_components/play/PlayWorkspace.tsx");
    expect(play).toContain("setView(await getPlayWorkspace(characterId));");
    // The Library UI only lists: no write call, no domain package, no fetch of its own.
    const index = strip(read(INDEX));
    expect(index).not.toMatch(/(save|update|create|complete|commit|finalize|delete)[A-Z]\w*\(/);
    for (const f of [INDEX, SAVE, WIZARD]) {
      expect(strip(read(f)), f).not.toMatch(/from "(@prowess\/(db|game|rules|model)|@prisma\/client)[^"]*"/);
      expect(strip(read(f)), f).not.toMatch(/\bfetch\(/);
    }
  });

  it("W11-I175 save means server-acknowledged: adopt each write, retry only the rest, reconcile unknown outcomes by reading", () => {
    const wizard = read(WIZARD);
    const save = wizard.slice(wizard.indexOf("const saveAndContinue = async () => {"), wizard.indexOf("const runCheck = async () => {"));
    expect(save).toContain("if (saving.current) return; // one save at a time");
    expect(save).toContain("const profileChanged = !sameProfile(character, sentProfile);");
    // Each acknowledged write is adopted before the next one is sent, so a retry carries the acknowledged version.
    expect(save).toContain("adopt(await saveProfile(current.id, current.lockVersion,");
    expect(save).toContain("if (choicesChanged) adopt(await saveCreation(current.id, current.lockVersion, sentCandidate), { profile: false, choices: true });");
    expect(save.indexOf("profileSaved = true;")).toBeLessThan(save.indexOf("if (choicesChanged) adopt("));
    // Edits made while saving stay unsaved.
    expect(save).toContain("setCandidate((x) => (x === sentCandidate ? candidateFrom(c.choices) : x));");
    expect(save).toContain("setProfile((p) => (p === sentProfile ? { name: c.name, concept: c.concept ?? \"\" } : p));");
    expect(save).toContain("setDirty(candidateRef.current !== sentCandidate);");
    // Unknown outcome → a READ and a comparison; the catch path never re-sends a write.
    const failure = save.slice(save.indexOf("} catch (e) {"));
    expect(failure).toContain("if (isUnknownOutcome(e)) {");
    expect(failure).toContain("const now = await getCharacter(forId);");
    expect(failure).not.toMatch(/saveProfile\(|saveCreation\(/);
    expect(failure).toContain("The profile was saved, but the creation choices were not");
    // Success is reported only after the awaited writes.
    expect(save.indexOf('text: later ? "Saved what was submitted.')).toBeGreaterThan(save.indexOf("if (choicesChanged) adopt("));
    // Leaving with unsaved edits asks first; a reopened Draft continues from its saved progress.
    expect(wizard).toContain('window.addEventListener("beforeunload", beforeUnload);');
    expect(wizard).toContain('document.addEventListener("click", onClick, true);');
    expect(wizard).toContain("setStep(continuationStep(candidateFrom(c.choices), c.resolution));");
    const helpers = src(SAVE);
    expect(namedFunction(helpers, "isUnknownOutcome").getText()).toContain('e.code === "NETWORK_ERROR" || e.code === "INVALID_RESPONSE" || e.status >= 500');
    expect(namedFunction(helpers, "continuationStep").getText()).toContain("if (!hasSavedChoices(choices)) return 0;");
    expect(namedFunction(helpers, "continuationStep").getText()).toContain('if (resolution.status === "READY") return REVIEW;');
  });

  it("W11-I176 play resumes through the WO10 read and idempotent commit — nothing on open advances, pays or ticks", () => {
    const service = src("packages/prowess-db/src/character/play-service.ts");
    const get = namedFunction(service, "getCharacterPlayWorkspace");
    expect(callsNamed(get, "commitPlayOperation")).toHaveLength(0);
    expect(callsNamed(get, "evaluatePlayOperation")).toHaveLength(0);
    const commit = namedFunction(service, "commitCharacterPlayOperation").getText();
    expect(commit).toContain('if (result.outcome === "duplicate") return replay();');
    expect(commit).toContain("if (prior.requestHash !== requestHash) throw fail(CHARACTER_ERROR_CODES.PLAY_IDEMPOTENCY_CONFLICT");
    const ws = read("apps/studio/app/characters/_components/play/PlayWorkspace.tsx");
    expect(ws).toContain("if (pendingKey.current === null || pendingKey.current.body !== body) pendingKey.current = { key: newKey(), body };");
  });

  it("W11-I178 only the latest response owns the screen", () => {
    const index = read(INDEX);
    const load = namedVariable(src(INDEX), "load").initializer!.getText();
    expect(load).toContain("const mine = ++seq.current;");
    expect(load.match(/if \(mine !== seq\.current\) return;/g)).toHaveLength(2);
    expect(index).toContain("const shown = result !== null && result.query === query ? result : null;");
    const wizard = read(WIZARD);
    const loadW = wizard.slice(wizard.indexOf("const load = useCallback(async () => {"), wizard.indexOf("}, [characterId]);"));
    expect(loadW.match(/if \(shownId\.current !== forId\) return;/g)).toHaveLength(2);
    expect(wizard).toContain("if (shownId.current !== forId) return;\n      current = c;");
  });

  it("W11-I179 Library destinations come from the persisted status and id; same names are told apart", () => {
    const actions = exported(INDEX, "libraryActions").getText();
    expect(actions).toContain('c.status === "CORE_COMPLETE"');
    expect(actions).toContain('{ label: "Open sheet", href: `/characters/${id}`, testid: "library-open-sheet" }');
    expect(actions).toContain('{ label: "Resume play", href: `/characters/${id}/play`, testid: "library-resume-play" }');
    expect(actions).toContain('[{ label: "Continue creation", href: `/characters/${id}/create`, testid: "library-continue-creation" }]');
    const index = read(INDEX);
    expect(index).toContain('<Link href={`/characters/${encodeURIComponent(c.id)}`}>{c.name}</Link>');
    expect(index).toContain('id <code>{c.id.slice(0, 8)}</code>');
    expect(index).toContain("Record updated (UTC)");
    for (const f of ["apps/studio/app/characters/[characterId]/cards/page.tsx", "apps/studio/app/characters/[characterId]/cards/print/page.tsx", "apps/studio/app/characters/[characterId]/print/page.tsx", "apps/studio/app/characters/[characterId]/play/page.tsx", "apps/studio/app/characters/[characterId]/create/page.tsx"]) expect(existsSync(path.join(ROOT, f)), f).toBe(true);
  });

  it("W11-I173–I179 every declared invariant names existing permanent guards, this gate and the mutation inventory", () => {
    const invariants = JSON.parse(read("docs/architecture/m6-invariants.json")) as { id: string; title: string; guards: string[] }[];
    const expected = Array.from({ length: 7 }, (_, i) => `M6-I${String(i + 173).padStart(3, "0")}`);
    const rows = invariants.filter((x) => expected.includes(x.id));
    expect(rows.map((x) => x.id)).toEqual(expected);
    expect(invariants.map((x) => x.id)).toEqual(Array.from({ length: invariants.length }, (_, i) => `M6-I${String(i + 1).padStart(3, "0")}`));
    const md = read("docs/architecture/m6-invariants.md");
    expect(md).toContain("## M6-WO11 — Character Library / Save / Load (M6-I173 – M6-I179)");
    for (const row of rows) {
      expect(row.guards).toContain("apps/studio/tests/unit/m6-wo11-static.test.ts");
      expect(row.guards).toContain("scripts/m6-wo11-negative-controls.mjs");
      for (const f of row.guards) expect(existsSync(path.join(ROOT, f)), `${row.id}: ${f}`).toBe(true);
      expect(md).toContain(`### ${row.id} — ${row.title}`);
    }
  });
});
