import { CharacterApiError, type CandidateDto, type CharacterDto, type ResolutionDto } from "./character-client";

/**
 * PAS-10 M6-WO11 — creation save and resume semantics (Studio side; no rules). Pure helpers used by the creation wizard:
 *
 * - `continuationStep`: where a reopened Draft continues, from the SAVED choices and the server's stored-choice
 *   validation. A Draft with no saved creation choice starts at Concept (a fresh or pre-WO11 Draft without progress);
 *   otherwise the first step that still has an issue; a READY Draft opens on Review.
 * - `isUnknownOutcome`: a request whose result the client cannot know (no response, unreadable response, server error).
 *   Such a save is reconciled by READING the authoritative Character, never by repeating the write blindly.
 * - `sameChoices` / `sameProfile`: compare a submission with what the server holds (order-insensitive, zero
 *   allocations ignored) to decide whether an unknown-outcome save actually landed.
 */
export const CREATION_STEPS = ["Concept", "Race / Ancestry", "Stats", "Skills", "Primary Affinity", "Review"] as const;
const REVIEW = CREATION_STEPS.length - 1;
const STEP_OF_PATH: ReadonlyArray<readonly [string, number]> = [
  ["ancestryStatChoices", 1],
  ["ancestry", 1],
  ["statAllocations", 2],
  ["skills", 3],
  ["primaryAffinity", 4],
];

export function hasSavedChoices(choices: CandidateDto): boolean {
  return choices.ancestry !== null || choices.ancestryStatChoices.length > 0 || Object.values(choices.statAllocations).some((v) => v !== 0) || choices.skills.length > 0 || choices.primaryAffinity !== null;
}

export function continuationStep(choices: CandidateDto, resolution: ResolutionDto): number {
  if (!hasSavedChoices(choices)) return 0;
  if (resolution.status === "READY") return REVIEW;
  const steps = resolution.issues.map((i) => STEP_OF_PATH.find(([prefix]) => i.path === prefix || i.path.startsWith(`${prefix}.`) || i.path.startsWith(`${prefix}[`))?.[1]).filter((s): s is number => s !== undefined);
  return steps.length === 0 ? REVIEW : steps.reduce((a, b) => (b < a ? b : a));
}

export function isUnknownOutcome(e: unknown): boolean {
  return e instanceof CharacterApiError && (e.code === "NETWORK_ERROR" || e.code === "INVALID_RESPONSE" || e.status >= 500);
}

function normalized(c: CandidateDto): string {
  const key = (s: { entityId: string; entityVersionId: string } | null) => (s === null ? null : `${s.entityId}/${s.entityVersionId}`);
  return JSON.stringify({
    ancestry: key(c.ancestry),
    ancestryStatChoices: c.ancestryStatChoices.map((x) => `${x.grantKey}:${x.stat}`).sort(),
    statAllocations: Object.entries(c.statAllocations).filter(([, v]) => v !== 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    skills: c.skills.map((s) => `${key(s.skill) ?? ""}|${s.sourceKind}|${s.sourceGrantKey ?? ""}`).sort(),
    primaryAffinity: key(c.primaryAffinity),
  });
}
export const sameChoices = (a: CandidateDto, b: CandidateDto) => normalized(a) === normalized(b);
export const sameProfile = (c: Pick<CharacterDto, "name" | "concept">, p: { name: string; concept: string }) => c.name === p.name.trim() && (c.concept ?? "") === (p.concept.trim() === "" ? "" : p.concept);
