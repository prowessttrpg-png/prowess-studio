import { createHash } from "node:crypto";
import { prisma } from "../../src/index";
import { cleanupCharacterWorlds, seedCharacterRelease, type CharacterReleaseWorld } from "./m6-wo3-character-release";

/**
 * PAS-10 M6-WO12 — the playtest vertical slice's PREPARATION (test-only content, never canon).
 *
 * Seeds ONE isolated Ruleset with its first published Release (R1: the WO3 Character content, WO4 advancement, the WO6
 * Weapon catalog, the WO7 Spell fixture and the WO8 Maneuver fixture, every key `test.m6wo12.<run>.*`) and records the
 * identities a tester needs. Everything the journey is about is deliberately NOT prepared here and must be done in Studio
 * by a person (or the named Playwright journey): the designer's revision, its review, the ChangeSet, Release 2, the
 * Character, its loadout, both Signature Abilities and every play event.
 *
 * Repeatable and run-scoped: `prepare(runId)` first removes any world of the same run, `cleanup(runId)` removes exactly
 * that run. A missing run id is refused. Both use the shared fixture teardown, which lifts the append-only
 * guards only for the rows it deletes.
 */
export const PLAYTEST_PREFIX = "test.m6wo12";
/** The one Definition the designer revises in Compendium Admin (content key in the WO7 Spell fixture). */
export const REVISED_CONTENT_KEY = "fixture.wo9.effect.maintenance";

export interface PlaytestWorld {
  readonly runId: string;
  readonly prefix: string;
  readonly rulesetId: string;
  readonly rulesetName: string;
  readonly policyId: string;
  readonly release1: { readonly id: string; readonly manifestId: string; readonly releaseNumber: number };
  readonly revised: { readonly entityId: string; readonly canonicalKey: string; readonly baseVersionId: string; readonly baseDisplayName: string };
  readonly longBladeVersionId: string;
  readonly preparedAt: string;
}

export const runPrefix = (runId: string) => `${PLAYTEST_PREFIX}.${runId}`;
export function assertRunId(runId: string): string {
  if (typeof runId !== "string" || !/^[a-z0-9]{3,24}$/.test(runId)) throw new Error(`A run id is 3–24 lowercase letters or digits (got "${runId}").`);
  return runId;
}
export const newRunId = () => `r${Date.now().toString(36)}`;

export async function preparePlaytestWorld(runId: string = newRunId()): Promise<PlaytestWorld> {
  return (await preparePlaytestRelease(runId)).summary;
}

/** The same preparation, also returning the seeded world (its exact pins) for service-level tests. */
export async function preparePlaytestRelease(runId: string = newRunId()): Promise<{ summary: PlaytestWorld; world: CharacterReleaseWorld }> {
  assertRunId(runId);
  const prefix = runPrefix(runId);
  await cleanupCharacterWorlds(`${prefix}.`);
  const rulesetName = `M6-WO12 Playtest ${runId}`;
  const w: CharacterReleaseWorld = await seedCharacterRelease(prefix, "R1", { advancement: true, weapons: true, spells: true, maneuvers: true, rulesetName });
  const pin = w.pins.get(REVISED_CONTENT_KEY);
  const blade = w.pins.get("weapon.long_blade");
  if (pin === undefined || blade === undefined) throw new Error("The WO12 Release is missing its fixture content.");
  const base = await prisma.entityVersion.findUniqueOrThrow({ where: { id: pin.entityVersionId }, select: { displayName: true } });
  const summary: PlaytestWorld = {
    runId,
    prefix,
    rulesetId: w.rulesetId,
    rulesetName,
    policyId: w.policyId,
    release1: w.release,
    revised: { entityId: pin.entityId, canonicalKey: pin.canonicalKey, baseVersionId: pin.entityVersionId, baseDisplayName: base.displayName },
    longBladeVersionId: blade.entityVersionId,
    preparedAt: new Date().toISOString(),
  };
  return { summary, world: w };
}

/** Removes exactly the specified run. Returns the Ruleset count that was present. */
export async function cleanupPlaytestWorlds(runId: string): Promise<number> {
  const prefix = `${runPrefix(assertRunId(runId))}.`;
  const n = await prisma.ruleset.count({ where: { canonicalKey: { startsWith: prefix } } });
  await cleanupCharacterWorlds(prefix);
  return n;
}

/** A read-only summary of the WO12 runs present in the database. */
export async function playtestStatus(): Promise<Array<{ runId: string; ruleset: string; releases: number; characters: number; changeSets: number }>> {
  const rulesets = await prisma.ruleset.findMany({ where: { canonicalKey: { startsWith: `${PLAYTEST_PREFIX}.` } }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, canonicalKey: true } });
  const out = [];
  for (const r of rulesets) {
    const releases = await prisma.rulesetRelease.findMany({ where: { rulesetId: r.id }, select: { id: true } });
    out.push({
      runId: r.canonicalKey.slice(PLAYTEST_PREFIX.length + 1).split(".")[0] ?? "?",
      ruleset: r.name,
      releases: releases.length,
      characters: await prisma.character.count({ where: { rulesetReleaseId: { in: releases.map((x) => x.id) } } }),
      changeSets: await prisma.changeSet.count({ where: { rulesetId: r.id } }),
    });
  }
  return out;
}

/** A byte-level fingerprint of every row a read-only step could touch: the Character's rows and the Ruleset's governance rows. */
export async function fingerprint(characterId: string | null, rulesetId: string): Promise<string> {
  const p = prisma;
  const c = characterId === null ? null : { where: { characterId } };
  // Row order is irrelevant to the fingerprint (some tables have composite keys): each row set is serialised and sorted.
  const set = async (q: Promise<unknown[]>) => (await q).map((x) => JSON.stringify(x, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))).sort();
  const rows = {
    ruleset: await p.ruleset.findUnique({ where: { id: rulesetId } }),
    releases: await p.rulesetRelease.findMany({ where: { rulesetId }, orderBy: { id: "asc" } }),
    manifests: await set(p.rulesetManifest.findMany({ where: { rulesetId } })),
    pins: await set(p.rulesetManifestEntry.findMany({ where: { manifest: { rulesetId } } })),
    changeSets: await p.changeSet.findMany({ where: { rulesetId }, orderBy: { id: "asc" } }),
    versions: await set(p.entityVersion.findMany({ where: { manifestEntries: { some: { manifest: { rulesetId } } } } })),
    ...(c === null
      ? {}
      : {
          character: await p.character.findUnique({ where: { id: characterId! } }),
          skills: await set(p.characterSkillRank.findMany(c)),
          stats: await set(p.characterStatAllocation.findMany(c)),
          advancements: await set(p.characterAdvancement.findMany(c)),
          resources: await set(p.characterResourceState.findMany(c)),
          playState: await p.characterPlayState.findUnique({ where: { characterId: characterId! } }),
          runtime: await p.characterPlayRuntime.findUnique({ where: { characterId: characterId! } }),
          events: await p.characterPlayEvent.findMany({ where: { characterId: characterId! }, orderBy: { sequence: "asc" } }),
          loadout: await p.characterWeaponLoadout.findUnique({ where: { characterId: characterId! } }),
          notes: await p.characterSheetNotes.findUnique({ where: { characterId: characterId! } }),
          abilities: await set(p.characterSignatureAbility.findMany(c)),
          spellRevisions: await set(p.characterSignatureSpellRevision.findMany({ where: { ability: { characterId: characterId! } } })),
          maneuverRevisions: await set(p.characterSignatureManeuverRevision.findMany({ where: { ability: { characterId: characterId! } } })),
        }),
  };
  // One digest per table keeps a failed Playwright comparison attributable.
  return Object.entries(rows).map(([table, data]) => table + ": " + createHash("sha256").update(JSON.stringify(data, (_k, v: unknown) => typeof v === "bigint" ? v.toString() : v)).digest("hex")).join("\n");
}
