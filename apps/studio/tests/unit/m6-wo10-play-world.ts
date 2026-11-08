/**
 * PAS-10 M6-WO10 — the Play Workspace PRESENTATION test world. A test-only, in-memory stand-in for the Play Workspace API
 * whose every response is produced by the REAL @prowess/game play domain (`buildPlayWorkspace`, `evaluatePlayOperation`)
 * over the isolated M6-WO10 test Release (packages/prowess-game/src/testing/play-fixtures.ts). It mirrors the service's
 * contract — versions, idempotent commit, refusal without writing, newest-first events — so Studio tests prove
 * presentation and interaction; atomic persistence is proven by the DB / API suites. No app code imports it.
 */
import { buildPlayWorkspace } from "../../../../packages/prowess-game/src/play/workspace";
import { evaluatePlayOperation, type PlayStored } from "../../../../packages/prowess-game/src/play/operations";
import { playWorld, PLAY_CHARACTER_ID, PLAY_RELEASE_ID } from "../../../../packages/prowess-game/src/testing/play-fixtures";
import type { PlayCommitDto, PlayEventDto, PlayPreviewDto, PlayViewDto } from "../../app/characters/_lib/play-types";

export { PLAY_CHARACTER_ID, PLAY_RELEASE_ID };
export const PLAY_RELEASE = { id: PLAY_RELEASE_ID, rulesetId: "00000000-0000-4000-8000-0000000f0010", rulesetName: "Play Test Ruleset", releaseNumber: 1, versionLabel: "R1", channel: "CORE_PLAYTEST" };
const json = <T>(v: unknown): T => JSON.parse(JSON.stringify(v)) as T;

export class StaleError extends Error {
  readonly code = "CHARACTER.STALE_WRITE";
}
export class ConflictError extends Error {
  readonly code = "CHARACTER.PLAY_IDEMPOTENCY_CONFLICT";
}

export class FakePlayServer {
  stored: PlayStored = { sheetResources: null, runtime: null };
  versions = { runtimeVersion: 0, playStateVersion: 0 };
  events: PlayEventDto[] = [];
  private readonly keys = new Map<string, { body: string; event: PlayEventDto }>();
  readonly ctx = playWorld().context;

  view(): PlayViewDto {
    const w = buildPlayWorkspace(this.ctx, this.stored);
    return json({ character: { id: PLAY_CHARACTER_ID, name: this.ctx.characterName, level: this.ctx.level, lockVersion: 3 }, release: PLAY_RELEASE, versions: this.versions, workspace: w, recentEvents: [...this.events].reverse().slice(0, 25) });
  }
  private check(r: number, s: number) {
    if (r !== this.versions.runtimeVersion || s !== this.versions.playStateVersion) throw new StaleError("This Character's play state changed since it was evaluated.");
  }
  preview(operation: unknown, r: number, s: number): PlayPreviewDto {
    this.check(r, s);
    return json({ versions: this.versions, outcome: evaluatePlayOperation(this.ctx, this.stored, operation) });
  }
  commit(operation: unknown, key: string, r: number, s: number): PlayCommitDto {
    const body = JSON.stringify(operation);
    const prior = this.keys.get(key);
    if (prior !== undefined) {
      if (prior.body !== body) throw new ConflictError("This idempotency key was already used for a different play operation.");
      return json({ committed: true, replayed: true, outcome: null, event: prior.event, workspace: this.view() });
    }
    this.check(r, s);
    const outcome = evaluatePlayOperation(this.ctx, this.stored, operation);
    if (outcome.status !== "COMMITTABLE") return json({ committed: false, replayed: false, outcome, event: null, workspace: this.view() });
    const sheetKeys = new Set(this.ctx.mechanics.resources.map((m) => m.resourceKey));
    const before = new Map(outcome.resourcesBefore.map((x) => [x.resourceKey, x.current]));
    const changed = (outcome.resourcesAfter ?? []).some((x) => sheetKeys.has(x.resourceKey) && before.get(x.resourceKey) !== x.current);
    this.stored = { sheetResources: (outcome.resourcesAfter ?? []).filter((x) => sheetKeys.has(x.resourceKey)).map((x) => ({ resourceKey: x.resourceKey, current: x.current })), runtime: outcome.runtimeAfter };
    this.versions = { runtimeVersion: this.versions.runtimeVersion + 1, playStateVersion: changed ? this.versions.playStateVersion + 1 : this.versions.playStateVersion };
    const event = json<PlayEventDto>({ id: `00000000-0000-4000-8000-${String(this.events.length + 1).padStart(12, "0")}`, sequence: this.events.length + 1, operationKind: outcome.operation.kind, classification: outcome.classification, summary: outcome.summary, rulesetReleaseId: PLAY_RELEASE_ID, runtimeVersion: this.versions.runtimeVersion, playStateVersion: this.versions.playStateVersion, createdAt: "2026-11-08T00:00:00.000Z", record: outcome });
    this.events.push(event);
    this.keys.set(key, { body, event });
    return json({ committed: true, replayed: false, outcome, event, workspace: this.view() });
  }
  /** A Character Sheet edit elsewhere: the sheet version moves on (the next Play submission is stale). */
  sheetEdit(resourceKey: string, current: number) {
    const base = buildPlayWorkspace(this.ctx, this.stored).resources.filter((x) => !x.runtimeOnly).map((x) => ({ resourceKey: x.resourceKey, current: x.current }));
    this.stored = { ...this.stored, sheetResources: base.map((x) => (x.resourceKey === resourceKey ? { ...x, current } : x)) };
    this.versions = { ...this.versions, playStateVersion: this.versions.playStateVersion + 1 };
  }
}
