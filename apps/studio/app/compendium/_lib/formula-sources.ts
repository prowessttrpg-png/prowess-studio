import type { FormulaNode } from "@prowess/rules";
import { formatEnumLabel } from "@prowess/ui";

/** A core Formula variable source as authored (`{ kind, stat? | statistic? | field? }`). Presentation helpers only. */
export interface FormulaSourceDto {
  readonly kind: string;
  readonly stat?: string;
  readonly statistic?: string;
  readonly field?: string;
}

export function sourceLabel(s: FormulaSourceDto): string {
  if (s.kind === "STAT") return `Stat ${s.stat ?? "?"}`;
  if (s.kind === "DERIVED") return `derived ${formatEnumLabel(s.statistic ?? "?")}`;
  if (s.kind === "CHARACTER") return `Character ${formatEnumLabel(s.field ?? "?")}`;
  if (s.kind === "") return "no source";
  return formatEnumLabel(s.kind);
}

/** A readable, unused Formula variable name for a source (`str`, `con`, `accuracy`, `level`, `bonuses` …). */
export function variableNameFor(s: FormulaSourceDto, taken: readonly string[]): string {
  const stem = (s.kind === "STAT" ? s.stat : s.kind === "DERIVED" ? s.statistic : s.kind === "CHARACTER" ? s.field : s.kind === "EXPLICIT_BONUSES" ? "bonuses" : s.kind)?.toLowerCase().replace(/[^a-z0-9_]/g, "_") || "input";
  const base = /^[a-z_]/.test(stem) ? stem : `v_${stem}`;
  let name = base;
  for (let i = 2; taken.includes(name); i += 1) name = `${base}_${i}`;
  return name;
}

/** Renames one variable throughout an AST (structure, precedence and every other node unchanged). */
export function renameVariable(n: FormulaNode, from: string, to: string): FormulaNode {
  switch (n.type) {
    case "NUMBER":
      return n;
    case "VARIABLE":
      return n.key === from ? { ...n, key: to } : n;
    case "UNARY":
      return { ...n, operand: renameVariable(n.operand, from, to) };
    case "BINARY":
      return { ...n, left: renameVariable(n.left, from, to), right: renameVariable(n.right, from, to) };
    case "CALL":
      return { ...n, arguments: n.arguments.map((a) => renameVariable(a, from, to)) };
  }
}
