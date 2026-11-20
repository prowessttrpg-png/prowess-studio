import { getAuthoring, postAuthoring } from "./authoring-client";

/**
 * PRE-M7-WO1 — clients for the two side-effect-free rule tools used while authoring. Both are POST only because they
 * carry a body; neither writes, creates or publishes anything.
 *   - the guided Formula operations (the server parses with the M4 parser; the Studio never does);
 *   - the rule preview (published Release vs. a never-persisted candidate with saved Drafts substituted).
 */

export interface FormulaSourceDto {
  readonly kind: string;
  readonly stat?: string;
  readonly statistic?: string;
  readonly field?: string;
}
export type FormulaTermDto =
  | { readonly sign: 1 | -1; readonly kind: "CONSTANT"; readonly value: number; readonly text?: string }
  | { readonly sign: 1 | -1; readonly kind: "INPUT"; readonly variable: string; readonly text?: string }
  | { readonly sign: 1 | -1; readonly kind: "SCALED"; readonly variable: string; readonly factor: number; readonly text?: string }
  | { readonly sign: 1 | -1; readonly kind: "DIVIDED"; readonly variable: string; readonly divisor: number; readonly rounding: "floor" | "ceil" | null; readonly text?: string }
  | { readonly sign: 1 | -1; readonly kind: "OTHER"; readonly text: string };
export interface FormulaDescriptionDto {
  readonly parse: { readonly ok: true; readonly variables: readonly string[] } | { readonly ok: false; readonly problem: string };
  readonly guided: { readonly ok: true; readonly terms: readonly FormulaTermDto[] } | { readonly ok: false; readonly reason: string };
  readonly hazards: readonly string[];
  readonly sourceLabels: readonly string[];
}
type Changed = { ok: true; expression: string; variables?: readonly string[]; description: FormulaDescriptionDto } | { ok: false; reason: string };

const FORMULA = "/api/compendium-rules/formula";
export const describeFormula = async (expression: string, sources: readonly FormulaSourceDto[]) => (await postAuthoring<{ description: FormulaDescriptionDto }>(FORMULA, { op: "describe", expression, sources })).description;
export const composeFormula = (terms: readonly FormulaTermDto[], sources: readonly FormulaSourceDto[]) => postAuthoring<Changed>(FORMULA, { op: "compose", terms, sources });
export const renameFormulaInput = (expression: string, from: string, to: string, sources: readonly FormulaSourceDto[]) => postAuthoring<Changed>(FORMULA, { op: "rename", expression, from, to, sources });
export const nameFormulaInput = (source: FormulaSourceDto, taken: readonly string[]) => postAuthoring<{ variable: string; label: string }>(FORMULA, { op: "name", source, taken });

export interface PreviewExampleDto {
  label: string;
  level: number;
  stats: Record<string, number>;
  baseHp: number;
  baseMp: number;
}
export interface PreviewOutcomeDto {
  ok: boolean;
  values: Array<{ statistic: string; value: number | null }>;
  problems: string[];
}
export interface RuleCandidatePreviewDto {
  release: { id: string; rulesetId: string; releaseNumber: number; versionLabel: string };
  substitutions: Array<{ entityId: string; from: string; to: string; toRevision: number; toStatus: string }>;
  candidateProblems: string[];
  examples: Array<{ label: string; published: PreviewOutcomeDto; candidate: PreviewOutcomeDto }>;
  changed: string[];
}
export const previewRuleCandidate = (body: { releaseId: string; drafts: string[]; examples: PreviewExampleDto[] }) => postAuthoring<RuleCandidatePreviewDto>("/api/compendium-rules/preview", body);

// ---- RULES-WO1: authored rules (calculated values, Skill benefits, the Concentration rule) -----------------------------
export interface AuthoredRuleSampleDto {
  level: number;
  stats: Record<string, number>;
  skillRanks: Array<{ skillEntityId: string; rankKey: string }>;
  effects: Array<{ label: string; castAp: number; assignedPoints: number }>;
}
export interface AuthoredValueDto {
  valueKey: string;
  displayName: string | null;
  definition: { entityId: string; entityVersionId: string; canonicalKey: string } | null;
  unit: string | null;
  canonStatus: string;
  placement: string;
  note: string | null;
  baseStated: boolean;
  base: number | null;
  contributions: Array<{ benefitKey: string; contributionKey: string; minimumRankKey: string; applies: boolean; amount: number | null; skill: { canonicalKey: string } }>;
  total: number | null;
  unavailable: string | null;
}
export interface ConcentrationPreviewDto {
  capacity: number | null;
  assignedPoints: number;
  freePoints: number | null;
  effects: Array<{ label: string; castAp: number; upkeepAp: number | null; assignedPoints: number; coveredAp: number | null; payableAp: number | null }>;
  totalPayableAp: number | null;
  mpUpkeepStillPaid: boolean;
  manaLockStillApplies: boolean;
  openQuestions: string[];
  appliesInPlay: false;
  issues: Array<{ code: string; message: string }>;
}
export interface AuthoredRulesSideDto {
  ok: boolean;
  problems: string[];
  values: AuthoredValueDto[];
  concentration: Array<{ canonicalKey: string; displayName: string | null; preview: ConcentrationPreviewDto }>;
  skills: Array<{ entityId: string; canonicalKey: string; displayName: string | null }>;
  ranks: string[];
}
export interface AuthoredRulesPreviewDto {
  release: { id: string; rulesetId: string; releaseNumber: number; versionLabel: string };
  overlay: Array<{ entityId: string; entityVersionId: string; revisionNumber: number; status: string; mode: "REPLACES_PIN" | "ADDED" }>;
  published: AuthoredRulesSideDto;
  candidate: AuthoredRulesSideDto;
}
export const previewAuthoredRules = (body: { releaseId: string; drafts: string[]; sample: AuthoredRuleSampleDto }) => postAuthoring<AuthoredRulesPreviewDto>("/api/compendium-rules/authored-preview", body);

// ---- RULES-WO1 Phase C: readable source sections and reference previews -------------------------------------------
export interface SourceSectionOptionDto {
  locator: string;
  title: string;
  headingLevel: number;
  parentTitle: string | null;
}
export interface SourceSectionLookupDto {
  snapshot: { id: string; label: string; sectionCount: number } | null;
  snapshots: Array<{ id: string; label: string; sectionCount: number }>;
  matches: SourceSectionOptionDto[];
  known: SourceSectionOptionDto[];
  unknown: string[];
}
export const lookupSourceSections = (q: string, locators: readonly string[]) =>
  getAuthoring<SourceSectionLookupDto>(`/api/compendium-rules/source-sections?q=${encodeURIComponent(q)}&locators=${encodeURIComponent(locators.join(","))}`);
export interface ReferencePreviewDto {
  definitionKind: string;
  result: Record<string, unknown>;
}
export interface AuthoringOptionDto {
  token: string;
  label: string;
}
export const listAuthoringOptions = (list: "skillRanks" | "calculatedValues") => getAuthoring<AuthoringOptionDto[]>(`/api/compendium-rules/authoring-options?list=${list}`);
export const previewReference = (body: { entityVersionId: string; sample: Record<string, unknown> }) => postAuthoring<ReferencePreviewDto>("/api/compendium-rules/reference-preview", body);
