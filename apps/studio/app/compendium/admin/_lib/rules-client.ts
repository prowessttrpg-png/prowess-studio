import { postAuthoring } from "./authoring-client";

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
