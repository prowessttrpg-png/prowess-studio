import { CHARACTER_ERROR_CODES, DomainError } from "@prowess/model";
import {
  PROWESS_COMPILATION_CONTRACT_VERSION,
  PROWESS_STATS,
  buildCoreResolutionContexts,
  compileCoreResolution,
  indexCoreDefinitions,
  resolveCharacterDie,
  type ProwessDefinitionBundle,
} from "@prowess/game";
import { orchestrateRulesEvaluation, type RulesetContext } from "@prowess/rules";
import { prisma } from "../client.js";
import { materializeProwessDefinitionBundle } from "../prowess-definition/service.js";
import { resolveRulesetContextFromRelease } from "../ruleset-context/index.js";
import { buildRuleGraph, dependenciesOf, dependentsOf, derivedCycle, type RuleEdge, type RuleGraph, type RuleNode, type RuleNodeKey } from "./graph.js";

/**
 * PRE-M7-WO1 — Compendium rule control (server). Everything here READS exact content and evaluates with the shared
 * engine; nothing writes. Edits are ordinary Draft revisions saved through the WO1 authoring service and published
 * through the existing review → ChangeSet → Release workflow.
 *
 *   getStatImpacts       — Stats → <Stat> → "What this affects": the actual direct and indirect dependents in one
 *                          exact Release, each with its owning Definition revision, authored expression and any open
 *                          Draft of that owner.
 *   previewRuleCandidate — before / after values of every derived statistic for explicit example inputs: the published
 *                          Release versus a CANDIDATE that substitutes named Draft revisions for their Entities' pins.
 *                          Same compiler, same M4 orchestration as the Character profile; side-effect free.
 */

const invalid = (message: string) => new DomainError(CHARACTER_ERROR_CODES.INVALID_INPUT, message);
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export interface RuleDefinitionSummary {
  readonly entityId: string;
  readonly entityVersionId: string;
  readonly canonicalKey: string;
  readonly definitionKind: string;
  readonly displayName: string;
  readonly revisionNumber: number;
  /** The newest DRAFT / IN_REVIEW revision of the same Entity (where an edit continues), or null. */
  readonly openDraft: { readonly entityVersionId: string; readonly revisionNumber: number; readonly status: string } | null;
}

export interface StatImpactRow {
  readonly role: RuleNode["role"];
  readonly token: string;
  readonly depth: number;
  readonly direct: boolean;
  readonly definition: RuleDefinitionSummary | null;
  readonly through: ReadonlyArray<{ readonly role: RuleNode["role"]; readonly token: string; readonly displayName: string | null }>;
  readonly reads: ReadonlyArray<Pick<RuleEdge, "via" | "path" | "variable" | "expression"> & { readonly from: string }>;
}

export interface StatImpacts {
  readonly release: { readonly id: string; readonly rulesetId: string; readonly releaseNumber: number; readonly versionLabel: string };
  readonly stat: string;
  readonly definition: RuleDefinitionSummary | null;
  readonly payload: Record<string, unknown> | null;
  readonly shortDescription: string | null;
  readonly rulesText: string | null;
  readonly impacts: readonly StatImpactRow[];
  readonly limits: readonly string[];
}

async function summaries(refs: ReadonlyArray<{ entityId: string; entityVersionId: string; canonicalKey: string; definitionKind: string }>): Promise<Map<string, RuleDefinitionSummary>> {
  const ids = [...new Set(refs.map((r) => r.entityVersionId))];
  const entityIds = [...new Set(refs.map((r) => r.entityId))];
  const [versions, drafts] = await Promise.all([
    prisma.entityVersion.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, revisionNumber: true } }),
    prisma.entityVersion.findMany({ where: { entityId: { in: entityIds }, status: { in: ["DRAFT", "IN_REVIEW"] } }, select: { id: true, entityId: true, revisionNumber: true, status: true }, orderBy: { revisionNumber: "desc" } }),
  ]);
  const byId = new Map(versions.map((v) => [v.id, v]));
  const out = new Map<string, RuleDefinitionSummary>();
  for (const r of refs) {
    const v = byId.get(r.entityVersionId);
    const d = drafts.find((x) => x.entityId === r.entityId);
    out.set(r.entityVersionId, { ...r, displayName: v?.displayName ?? r.canonicalKey, revisionNumber: v?.revisionNumber ?? 0, openDraft: d === undefined ? null : { entityVersionId: d.id, revisionNumber: d.revisionNumber, status: d.status } });
  }
  return out;
}

async function releaseIdentity(releaseId: string) {
  if (!isUuid(releaseId)) throw invalid("releaseId must be a UUID");
  const release = await prisma.rulesetRelease.findUnique({ where: { id: releaseId }, select: { id: true, rulesetId: true, releaseNumber: true, versionLabel: true } });
  if (release === null) throw invalid(`Release ${releaseId} does not exist`);
  return release;
}

export async function getStatImpacts(releaseId: string, stat: string): Promise<StatImpacts> {
  if (!(PROWESS_STATS as readonly string[]).includes(stat)) throw invalid(`Not a Stat: ${JSON.stringify(stat)}`);
  const release = await releaseIdentity(releaseId);
  const ruleset = await resolveRulesetContextFromRelease(releaseId);
  const bundle = await materializeProwessDefinitionBundle(ruleset);
  const graph = buildRuleGraph(bundle);
  const start = `STAT:${stat}` as RuleNodeKey;
  const impacts = dependentsOf(graph, start);
  const statNode = graph.nodes.get(start);
  const refs = [...(statNode?.definition ? [statNode.definition] : []), ...impacts.flatMap((i) => [...(i.node.definition ? [i.node.definition] : []), ...i.through.flatMap((t) => (t.definition ? [t.definition] : []))])];
  const names = await summaries(refs);
  const statVersion = statNode?.definition ? await prisma.entityVersion.findUnique({ where: { id: statNode.definition.entityVersionId }, select: { shortDescription: true, rulesText: true } }) : null;
  const statEnvelope = bundle.definitions.find((d) => d.definitionKind === "STAT" && (d.payload as { stat?: unknown }).stat === stat);
  return {
    release,
    stat,
    definition: statNode?.definition ? (names.get(statNode.definition.entityVersionId) ?? null) : null,
    payload: (statEnvelope?.payload as Record<string, unknown> | undefined) ?? null,
    shortDescription: statVersion?.shortDescription ?? null,
    rulesText: statVersion?.rulesText ?? null,
    impacts: impacts.map((i) => ({
      role: i.node.role,
      token: i.node.token,
      depth: i.depth,
      direct: i.depth === 1,
      definition: i.node.definition ? (names.get(i.node.definition.entityVersionId) ?? null) : null,
      through: i.through.map((t) => ({ role: t.role, token: t.token, displayName: t.definition ? (names.get(t.definition.entityVersionId)?.displayName ?? null) : null })),
      reads: i.edges.map((e) => ({ from: e.from, via: e.via, path: e.path, variable: e.variable, expression: e.expression })),
    })),
    limits: [
      "Stat values that come from Character state (Ancestry Stat grants, creation points, advancement) are inputs to this Stat, not rules that depend on it, and are not listed here.",
      "Screens that display a statistic are listed separately as consumers; this list is derived only from rule references in this exact Release.",
    ],
  };
}

// ---- Preview -----------------------------------------------------------------------------------------------------------

export interface PreviewExample {
  readonly label: string;
  readonly level: number;
  readonly stats: Readonly<Record<string, number>>;
  readonly baseHp: number;
  readonly baseMp: number;
}

export interface PreviewValue {
  readonly statistic: string;
  readonly value: number | null;
}
export interface PreviewOutcome {
  readonly ok: boolean;
  readonly values: readonly PreviewValue[];
  readonly problems: readonly string[];
}

export interface RuleCandidatePreview {
  readonly release: { readonly id: string; readonly rulesetId: string; readonly releaseNumber: number; readonly versionLabel: string };
  /** The Draft revisions substituted for their Entities' pins in the candidate. */
  readonly substitutions: ReadonlyArray<{ readonly entityId: string; readonly from: string; readonly to: string; readonly toRevision: number; readonly toStatus: string }>;
  readonly candidateProblems: readonly string[];
  readonly examples: ReadonlyArray<{ readonly label: string; readonly published: PreviewOutcome; readonly candidate: PreviewOutcome }>;
  /** Derived statistics whose value changed for at least one example. */
  readonly changed: readonly string[];
}

function readExamples(value: unknown): PreviewExample[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) throw invalid("examples is a list of 1–12 example Characters");
  return value.map((x, i) => {
    if (x === null || typeof x !== "object") throw invalid(`examples[${i}] must be an object`);
    const r = x as Record<string, unknown>;
    const int = (v: unknown, field: string, min: number, max: number) => {
      if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) throw invalid(`examples[${i}].${field} is a whole number from ${min} to ${max}`);
      return v;
    };
    const stats: Record<string, number> = {};
    const raw = r.stats;
    if (raw === null || typeof raw !== "object") throw invalid(`examples[${i}].stats lists every Stat`);
    for (const s of PROWESS_STATS) stats[s] = int((raw as Record<string, unknown>)[s], `stats.${s}`, 0, 1000);
    for (const k of Object.keys(raw as object)) if (!(PROWESS_STATS as readonly string[]).includes(k)) throw invalid(`examples[${i}].stats has an unknown Stat ${JSON.stringify(k)}`);
    return { label: typeof r.label === "string" && r.label.trim() !== "" ? r.label.slice(0, 80) : `Example ${i + 1}`, level: int(r.level, "level", 1, 1000), stats, baseHp: int(r.baseHp, "baseHp", 0, 100000), baseMp: int(r.baseMp, "baseMp", 0, 100000) };
  });
}

/** Every derived statistic of `bundle` for one example, through the SAME compile + orchestration path as the profile. */
export function evaluateDerivedForExample(bundle: ProwessDefinitionBundle, ruleset: RulesetContext, ex: PreviewExample): PreviewOutcome {
  const core = indexCoreDefinitions(bundle);
  if (!core.ok) return { ok: false, values: [], problems: core.problems.map((p) => `${p.code} at ${p.path}: ${p.message}`) };
  const die = resolveCharacterDie(core.value.progression.payload, ex.level);
  if (die === null) return { ok: false, values: [], problems: [`Level ${ex.level} is not a Character Level in this Release`] };
  for (const s of PROWESS_STATS) {
    const def = core.value.stats[s].payload;
    const v = ex.stats[s] as number;
    if (v < def.minimum || v > def.maximum) return { ok: false, values: [], problems: [`${s} ${v} is outside this Release's range ${def.minimum}–${def.maximum}`] };
  }
  const character = { level: ex.level, characterDie: { dieKey: die.dieKey }, stats: ex.stats, baseHp: ex.baseHp, baseMp: ex.baseMp, skillRanks: [], explicitBonuses: [] };
  const plan = compileCoreResolution({ contractVersion: PROWESS_COMPILATION_CONTRACT_VERSION, subject: { kind: "DERIVED_STATISTICS", subjectKey: "compendium-preview" }, definitions: bundle, ruleset, character });
  if (!plan.ok) return { ok: false, values: [], problems: plan.problems.map((p) => `${p.code} at ${p.path}: ${p.message}`) };
  const contexts = buildCoreResolutionContexts({ definitions: bundle, character, plan: plan.value });
  if (!contexts.ok) return { ok: false, values: [], problems: contexts.problems.map((p) => `${p.code} at ${p.path}: ${p.message}`) };
  const response = orchestrateRulesEvaluation({ evaluationKey: "pre-m7-wo1.compendium-preview", contexts: { ruleset, actor: contexts.value.actor, runtime: contexts.value.runtime }, plan: plan.value.evaluationPlan });
  if (!response.success || response.data === null) return { ok: false, values: [], problems: ["the M4 evaluation did not succeed"] };
  const values: PreviewValue[] = [];
  for (const statistic of core.value.derivedOrder) {
    const stepKey = plan.value.outputs.derived[statistic];
    const step = stepKey === undefined ? undefined : response.data.steps.find((s) => s.stepKey === stepKey);
    const data = step?.response?.data as { finalValue?: unknown } | null | undefined;
    values.push({ statistic, value: step?.executionStatus === "EXECUTED" && typeof data?.finalValue === "number" ? data.finalValue : null });
  }
  return { ok: values.every((v) => v.value !== null), values, problems: values.filter((v) => v.value === null).map((v) => `${v.statistic} did not evaluate`) };
}

export async function previewRuleCandidate(input: { readonly releaseId: unknown; readonly drafts: unknown; readonly examples: unknown }): Promise<RuleCandidatePreview> {
  if (typeof input.releaseId !== "string") throw invalid("releaseId must be a UUID");
  const release = await releaseIdentity(input.releaseId);
  const examples = readExamples(input.examples);
  if (!Array.isArray(input.drafts) || input.drafts.length > 20 || !input.drafts.every(isUuid)) throw invalid("drafts is a list of at most 20 EntityVersion ids");
  const draftIds = [...new Set(input.drafts as string[])];
  const base = await resolveRulesetContextFromRelease(release.id);
  const published = await materializeProwessDefinitionBundle(base);
  const versions = await prisma.entityVersion.findMany({ where: { id: { in: draftIds } }, select: { id: true, entityId: true, revisionNumber: true, status: true } });
  const substitutions: Array<RuleCandidatePreview["substitutions"][number]> = [];
  const rules = base.rules.map((r) => {
    const v = versions.find((x) => x.entityId === r.entityId);
    if (v === undefined) return r;
    substitutions.push({ entityId: r.entityId, from: r.entityVersionId, to: v.id, toRevision: v.revisionNumber, toStatus: v.status });
    return { ...r, entityVersionId: v.id as typeof r.entityVersionId };
  });
  for (const id of draftIds) {
    const v = versions.find((x) => x.id === id);
    if (v === undefined) throw invalid(`EntityVersion ${id} does not exist`);
    if (!base.rules.some((r) => r.entityId === v.entityId)) throw invalid(`EntityVersion ${id} belongs to an Entity this Release does not pin; a candidate only substitutes revisions of pinned Entities`);
  }
  // The candidate is NOT a Release: no release identity, no manifest hash. It is never persisted.
  const candidateContext: RulesetContext = { ...base, manifestHash: null, release: null, rules };
  const candidateProblems: string[] = [];
  let candidate: ProwessDefinitionBundle | null = null;
  try {
    candidate = await materializeProwessDefinitionBundle(candidateContext);
  } catch (e) {
    candidateProblems.push(e instanceof Error ? e.message : String(e));
  }
  if (candidate !== null) {
    const cycle = derivedCycle(buildRuleGraph(candidate));
    if (cycle !== null) candidateProblems.push(`the candidate's derived statistics form a cycle: ${cycle.join(" → ")}`);
  }
  const results = examples.map((ex) => ({
    label: ex.label,
    published: evaluateDerivedForExample(published, base, ex),
    candidate: candidate === null ? { ok: false, values: [], problems: candidateProblems } : evaluateDerivedForExample(candidate, candidateContext, ex),
  }));
  const changed = new Set<string>();
  for (const r of results) for (const v of r.candidate.values) if (r.published.values.find((p) => p.statistic === v.statistic)?.value !== v.value) changed.add(v.statistic);
  return { release, substitutions, candidateProblems, examples: results, changed: [...changed].sort() };
}

/** The rule graph of one exact Release (for "where used" on any rule page). */
export async function getReleaseRuleGraph(releaseId: string): Promise<{ graph: RuleGraph; bundle: ProwessDefinitionBundle }> {
  await releaseIdentity(releaseId);
  const ruleset = await resolveRulesetContextFromRelease(releaseId);
  const bundle = await materializeProwessDefinitionBundle(ruleset);
  return { graph: buildRuleGraph(bundle), bundle };
}

export interface RuleUsage {
  readonly node: { readonly role: RuleNode["role"]; readonly token: string };
  readonly reads: ReadonlyArray<{ readonly from: string; readonly via: RuleEdge["via"]; readonly variable: string | null }>;
  readonly usedBy: ReadonlyArray<{ readonly role: RuleNode["role"]; readonly token: string; readonly displayName: string | null; readonly depth: number }>;
}

/** What one Definition reads and what reads it, in one exact Release. */
export async function getRuleUsage(releaseId: string, entityId: string): Promise<RuleUsage | null> {
  if (!isUuid(entityId)) throw invalid("entityId must be a UUID");
  const { graph } = await getReleaseRuleGraph(releaseId);
  const node = [...graph.nodes.values()].find((n) => n.definition?.entityId === entityId);
  if (node === undefined) return null;
  const deps = dependentsOf(graph, node.key);
  const names = await summaries(deps.flatMap((d) => (d.node.definition ? [d.node.definition] : [])));
  return {
    node: { role: node.role, token: node.token },
    reads: dependenciesOf(graph, node.key).map((e) => ({ from: e.from, via: e.via, variable: e.variable })),
    usedBy: deps.map((d) => ({ role: d.node.role, token: d.node.token, displayName: d.node.definition ? (names.get(d.node.definition.entityVersionId)?.displayName ?? null) : null, depth: d.depth })),
  };
}
