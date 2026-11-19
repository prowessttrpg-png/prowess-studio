import { CHARACTER_ERROR_CODES, DomainError } from "@prowess/model";
import {
  PROWESS_STATS,
  authoredValuesOf,
  evaluateCalculatedValues,
  indexCoreDefinitions,
  previewConcentration,
  type CalculatedValueResult,
  type ConcentrationPreviewResult,
  type ConcentrationRulePayload,
  type ProwessDefinitionBundle,
} from "@prowess/game";
import type { RulesetContext } from "@prowess/rules";
import { prisma } from "../client.js";
import { materializeProwessDefinitionBundle } from "../prowess-definition/service.js";
import { resolveRulesetContextFromRelease } from "../ruleset-context/index.js";
import { evaluateDerivedForExample } from "./service.js";

/**
 * RULES-WO1 — side-effect-free preview of AUTHORED rules (calculated values, Skill benefits, the Concentration rule) for
 * one sample Character, in the published Release and in an isolated CANDIDATE overlay.
 *
 * The candidate is the Release's exact pins with the named Draft revisions applied: a Draft of a pinned Entity replaces
 * its pin; a Draft of an Entity the Release does not pin yet (a NEW rule) is added. It is built in memory only — no
 * Release, Manifest, pin or revision is created, changed or published — and it is evaluated by the same M5 / M4 code the
 * Character sheet uses (`evaluateCalculatedValues`, `previewConcentration`, the derived-statistic compilation).
 */
const invalid = (message: string) => new DomainError(CHARACTER_ERROR_CODES.INVALID_INPUT, message);
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export interface AuthoredRuleSample {
  readonly level: number;
  readonly stats: Readonly<Record<string, number>>;
  readonly skillRanks: ReadonlyArray<{ readonly skillEntityId: string; readonly rankKey: string }>;
  readonly effects: ReadonlyArray<{ readonly label: string; readonly castAp: number; readonly assignedPoints: number }>;
}

export interface AuthoredRulesSide {
  readonly ok: boolean;
  readonly problems: readonly string[];
  readonly values: readonly (CalculatedValueResult & { readonly displayName: string | null })[];
  readonly concentration: ReadonlyArray<{ readonly canonicalKey: string; readonly displayName: string | null; readonly preview: ConcentrationPreviewResult }>;
  /** The Skills that benefits in this bundle belong to (for choosing a sample rank) and the Skill rank ladder in order. */
  readonly skills: ReadonlyArray<{ readonly entityId: string; readonly canonicalKey: string; readonly displayName: string | null }>;
  readonly ranks: readonly string[];
}

export interface AuthoredRulesPreview {
  readonly release: { readonly id: string; readonly rulesetId: string; readonly releaseNumber: number; readonly versionLabel: string };
  readonly overlay: ReadonlyArray<{ readonly entityId: string; readonly entityVersionId: string; readonly revisionNumber: number; readonly status: string; readonly mode: "REPLACES_PIN" | "ADDED" }>;
  readonly published: AuthoredRulesSide;
  readonly candidate: AuthoredRulesSide;
}

function readSample(value: unknown): AuthoredRuleSample {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalid("sample is an object { level, stats, skillRanks, effects }");
  const r = value as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!["level", "stats", "skillRanks", "effects"].includes(k)) throw invalid(`sample has an unknown field ${JSON.stringify(k)}`);
  const int = (v: unknown, what: string, min: number, max: number) => {
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) throw invalid(`${what} is a whole number from ${min} to ${max}`);
    return v;
  };
  const level = int(r.level, "sample.level", 1, 1000);
  const rawStats = r.stats;
  if (rawStats === null || typeof rawStats !== "object" || Array.isArray(rawStats)) throw invalid("sample.stats lists every Stat");
  const stats: Record<string, number> = {};
  for (const s of PROWESS_STATS) stats[s] = int((rawStats as Record<string, unknown>)[s], `sample.stats.${s}`, 0, 1000);
  for (const k of Object.keys(rawStats)) if (!(PROWESS_STATS as readonly string[]).includes(k)) throw invalid(`sample.stats has an unknown Stat ${JSON.stringify(k)}`);
  const list = (v: unknown, what: string) => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.length > 20) throw invalid(`${what} is a list of at most 20 entries`);
    return v.map((x, i) => {
      if (x === null || typeof x !== "object" || Array.isArray(x)) throw invalid(`${what}[${i}] must be an object`);
      return x as Record<string, unknown>;
    });
  };
  const skillRanks = list(r.skillRanks, "sample.skillRanks").map((x, i) => {
    if (!isUuid(x.skillEntityId) || typeof x.rankKey !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(x.rankKey)) throw invalid(`sample.skillRanks[${i}] is { skillEntityId, rankKey }`);
    return { skillEntityId: x.skillEntityId, rankKey: x.rankKey };
  });
  const effects = list(r.effects, "sample.effects").map((x, i) => ({
    label: typeof x.label === "string" && x.label.trim() !== "" ? x.label.slice(0, 80) : `Effect ${i + 1}`,
    castAp: int(x.castAp, `sample.effects[${i}].castAp`, 0, 100),
    assignedPoints: int(x.assignedPoints, `sample.effects[${i}].assignedPoints`, 0, 100),
  }));
  return { level, stats, skillRanks, effects };
}

async function displayNames(versionIds: readonly string[]): Promise<Map<string, string>> {
  const rows = await prisma.entityVersion.findMany({ where: { id: { in: [...new Set(versionIds)] } }, select: { id: true, displayName: true } });
  return new Map(rows.map((r) => [r.id, r.displayName]));
}

async function evaluateSide(bundle: ProwessDefinitionBundle, ruleset: RulesetContext, sample: AuthoredRuleSample): Promise<AuthoredRulesSide> {
  const problems: string[] = [];
  // Derived statistics for the sample come from the same compile + M4 path as the Character profile.
  const derivedOutcome = evaluateDerivedForExample(bundle, ruleset, { label: "sample", level: sample.level, stats: sample.stats, baseHp: 0, baseMp: 0 });
  const derived: Record<string, number> = {};
  for (const v of derivedOutcome.values) if (v.value !== null) derived[v.statistic] = v.value;
  const { values, benefits } = authoredValuesOf(bundle);
  const core = indexCoreDefinitions(bundle);
  const ladder = core.ok ? core.value.skillLadder.payload.ranks : [];
  const outcome = evaluateCalculatedValues({ values, benefits, ladder, facts: { stats: sample.stats, level: sample.level, derived, skillRanks: sample.skillRanks } });
  for (const i of outcome.issues) problems.push(i.message);
  const rules = bundle.definitions.filter((d) => d.definitionKind === "CONCENTRATION_RULE");
  const skillIds = new Set(benefits.map((b) => b.payload.skill.entityId));
  const skills = bundle.definitions.filter((d) => d.definitionKind === "SKILL" && skillIds.has(d.entityId));
  const names = await displayNames([...outcome.values.flatMap((v) => (v.definition ? [v.definition.entityVersionId] : [])), ...rules.map((r) => r.entityVersionId), ...skills.map((d) => d.entityVersionId)]);
  return {
    ok: problems.length === 0,
    problems,
    values: outcome.values.map((v) => ({ ...v, displayName: v.definition ? (names.get(v.definition.entityVersionId) ?? null) : null })),
    concentration: rules.map((r) => ({
      canonicalKey: r.canonicalKey,
      displayName: names.get(r.entityVersionId) ?? null,
      preview: previewConcentration({ rule: r.payload as unknown as ConcentrationRulePayload, stats: sample.stats, level: sample.level, effects: sample.effects }),
    })),
    skills: skills.map((d) => ({ entityId: d.entityId, canonicalKey: d.canonicalKey, displayName: names.get(d.entityVersionId) ?? null })),
    ranks: [...ladder].sort((a, b) => a.order - b.order).map((r) => r.rankKey),
  };
}

export async function previewAuthoredRules(input: { readonly releaseId: unknown; readonly drafts: unknown; readonly sample: unknown }): Promise<AuthoredRulesPreview> {
  if (!isUuid(input.releaseId)) throw invalid("releaseId must be a UUID");
  const release = await prisma.rulesetRelease.findUnique({ where: { id: input.releaseId }, select: { id: true, rulesetId: true, releaseNumber: true, versionLabel: true } });
  if (release === null) throw invalid(`Release ${input.releaseId} does not exist`);
  const sample = readSample(input.sample);
  if (!Array.isArray(input.drafts) || input.drafts.length > 20 || !input.drafts.every(isUuid)) throw invalid("drafts is a list of at most 20 EntityVersion ids");
  const draftIds = [...new Set(input.drafts as string[])];
  const base = await resolveRulesetContextFromRelease(release.id);
  const published = await materializeProwessDefinitionBundle(base);
  const versions = await prisma.entityVersion.findMany({
    where: { id: { in: draftIds } },
    select: { id: true, entityId: true, revisionNumber: true, status: true, entity: { select: { canonicalKey: true, entityType: true } } },
  });
  const overlay: Array<AuthoredRulesPreview["overlay"][number]> = [];
  const rules = base.rules.map((r) => {
    const v = versions.find((x) => x.entityId === r.entityId);
    if (v === undefined) return r;
    overlay.push({ entityId: v.entityId, entityVersionId: v.id, revisionNumber: v.revisionNumber, status: v.status, mode: "REPLACES_PIN" });
    return { ...r, entityVersionId: v.id as typeof r.entityVersionId };
  });
  const added: (typeof base.rules)[number][] = [];
  for (const id of draftIds) {
    const v = versions.find((x) => x.id === id);
    if (v === undefined) throw invalid(`EntityVersion ${id} does not exist`);
    if (base.rules.some((r) => r.entityId === v.entityId)) continue;
    if (versions.filter((x) => x.entityId === v.entityId).length > 1) throw invalid(`more than one revision of Entity ${v.entityId} was named; a candidate holds one revision per Entity`);
    overlay.push({ entityId: v.entityId, entityVersionId: v.id, revisionNumber: v.revisionNumber, status: v.status, mode: "ADDED" });
    added.push({ entityId: v.entityId, entityVersionId: v.id, canonicalKey: v.entity.canonicalKey, entityType: v.entity.entityType, sourceRulesetId: null, sourceManifestId: null } as unknown as (typeof base.rules)[number]);
  }
  // The candidate is NOT a Release: no release identity, no manifest hash. It is never persisted.
  const candidateContext: RulesetContext = { ...base, manifestHash: null, release: null, rules: [...rules, ...added] };
  let candidateSide: AuthoredRulesSide;
  try {
    const candidate = await materializeProwessDefinitionBundle(candidateContext);
    candidateSide = await evaluateSide(candidate, candidateContext, sample);
  } catch (e) {
    candidateSide = { ok: false, problems: [e instanceof Error ? e.message : String(e)], values: [], concentration: [], skills: [], ranks: [] };
  }
  return { release, overlay, published: await evaluateSide(published, base, sample), candidate: candidateSide };
}
