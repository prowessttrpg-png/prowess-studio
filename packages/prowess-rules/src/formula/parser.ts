import { deepFreeze } from "../internal/plain-data.js";
import type { FormulaNode } from "./ast.js";
import {
  arityRule,
  diagnostic,
  FORMULA_DIAGNOSTIC_CODES,
  FORMULA_LIMITS,
  hasValidArity,
  isFormulaFunctionName,
  type FormulaDiagnostic,
} from "./diagnostics.js";
import { tokenizeFormula, type FormulaToken, type FormulaTokenType } from "./lexer.js";

/**
 * The Formula parser (PAS-10 M4-WO3 §9–13, §21–30, §61–63): hand-written recursive descent over the lexer's tokens.
 *
 *   expression     → additive
 *   additive       → multiplicative ( ( "+" | "-" ) multiplicative )*
 *   multiplicative → unary ( ( "*" | "/" ) unary )*
 *   unary          → ( "+" | "-" ) unary | primary
 *   primary        → NUMBER
 *                  | IDENTIFIER "(" [ expression ( "," expression )* ] ")"     function call
 *                  | IDENTIFIER                                                variable
 *                  | "(" expression ")"
 *
 * Binary operators are left-associative. A call's name must be floor / ceil / min / max (UNKNOWN_FUNCTION otherwise,
 * reported before its arguments are read) and its arity is checked at parse time. The whole source must be consumed.
 * Nesting (parentheses, calls, unary operators) is bounded during parsing, so pathological input fails cleanly long
 * before the JavaScript stack could overflow; node count and final tree depth are bounded too.
 */
export interface FormulaParseSuccess {
  readonly ok: true;
  readonly ast: FormulaNode;
  /** Every distinct variable key, in first-reference (left-to-right source) order. */
  readonly variables: readonly string[];
}

export interface FormulaParseFailure {
  readonly ok: false;
  readonly diagnostics: readonly FormulaDiagnostic[];
}

export type FormulaParseResult = FormulaParseSuccess | FormulaParseFailure;

/** Internal control-flow signal; never escapes `parseFormulaExpression`. */
class ParseStop {
  constructor(readonly diagnostic: FormulaDiagnostic) {}
}

const describeToken = (token: FormulaToken) => (token.type === "END" ? "end of expression" : `"${token.text}"`);

function parseTokens(tokens: readonly FormulaToken[]): FormulaNode {
  let position = 0;
  let depth = 0;
  let nodes = 0;

  const peek = (): FormulaToken => tokens[position] as FormulaToken;
  const advance = (): FormulaToken => tokens[position++] as FormulaToken;
  const stop = (code: FormulaDiagnostic["code"], message: string, token: { startOffset: number; endOffset: number }): never => {
    throw new ParseStop(diagnostic(code, message, { startOffset: token.startOffset, endOffset: token.endOffset, path: "/expression" }));
  };
  const expect = (type: FormulaTokenType, what: string): FormulaToken => {
    const token = peek();
    if (token.type !== type) stop(FORMULA_DIAGNOSTIC_CODES.INVALID_SYNTAX, `expected ${what}, found ${describeToken(token)}`, token);
    return advance();
  };
  const countNode = (at: FormulaToken) => {
    nodes += 1;
    if (nodes > FORMULA_LIMITS.MAX_AST_NODES) stop(FORMULA_DIAGNOSTIC_CODES.EXPRESSION_LIMIT_EXCEEDED, `expression exceeds ${FORMULA_LIMITS.MAX_AST_NODES} nodes`, at);
  };
  const nest = <T>(at: FormulaToken, parse: () => T): T => {
    depth += 1;
    if (depth > FORMULA_LIMITS.MAX_NESTING_DEPTH) stop(FORMULA_DIAGNOSTIC_CODES.EXPRESSION_LIMIT_EXCEEDED, `expression nests deeper than ${FORMULA_LIMITS.MAX_NESTING_DEPTH} levels`, at);
    const result = parse();
    depth -= 1;
    return result;
  };

  const binaryLevel = (next: () => FormulaNode, operators: Partial<Record<FormulaTokenType, "+" | "-" | "*" | "/">>) => (): FormulaNode => {
    let left = next();
    for (;;) {
      const token = peek();
      const operator = operators[token.type];
      if (operator === undefined) return left;
      advance();
      countNode(token);
      const right = next();
      left = { type: "BINARY", operator, left, right, startOffset: left.startOffset, endOffset: right.endOffset };
    }
  };

  const unary = (): FormulaNode => {
    const token = peek();
    if (token.type === "PLUS" || token.type === "MINUS") {
      advance();
      countNode(token);
      const operand = nest(token, unary);
      return { type: "UNARY", operator: token.type === "PLUS" ? "+" : "-", operand, startOffset: token.startOffset, endOffset: operand.endOffset };
    }
    return primary();
  };

  const primary = (): FormulaNode => {
    const token = peek();
    if (token.type === "NUMBER") {
      advance();
      countNode(token);
      return { type: "NUMBER", value: Number(token.text), startOffset: token.startOffset, endOffset: token.endOffset };
    }
    if (token.type === "IDENTIFIER") {
      advance();
      countNode(token);
      if (peek().type !== "LPAREN") return { type: "VARIABLE", key: token.text, startOffset: token.startOffset, endOffset: token.endOffset };
      const name = token.text;
      if (!isFormulaFunctionName(name)) {
        stop(FORMULA_DIAGNOSTIC_CODES.UNKNOWN_FUNCTION, `"${name}" is not a Formula function (only floor, ceil, min, max)`, token);
      }
      const open = advance();
      const args = nest(open, () => {
        const list: FormulaNode[] = [];
        if (peek().type !== "RPAREN") {
          list.push(expression());
          while (peek().type === "COMMA") {
            advance();
            list.push(expression());
          }
        }
        return list;
      });
      const close = expect("RPAREN", `"," or ")" to close ${name}(`);
      if (isFormulaFunctionName(name) && !hasValidArity(name, args.length)) {
        stop(FORMULA_DIAGNOSTIC_CODES.INVALID_ARITY, `${name} takes ${arityRule(name)}, got ${args.length}`, { startOffset: token.startOffset, endOffset: close.endOffset });
      }
      return { type: "CALL", name: name as "floor", arguments: args, startOffset: token.startOffset, endOffset: close.endOffset };
    }
    if (token.type === "LPAREN") {
      const open = advance();
      const inner = nest(open, expression);
      expect("RPAREN", '")"');
      return inner;
    }
    return stop(FORMULA_DIAGNOSTIC_CODES.INVALID_SYNTAX, `expected a number, variable, function call or "(", found ${describeToken(token)}`, token);
  };

  const multiplicative = binaryLevel(unary, { STAR: "*", SLASH: "/" });
  const additive = binaryLevel(multiplicative, { PLUS: "+", MINUS: "-" });
  const expression = (): FormulaNode => additive();

  const root = expression();
  const rest = peek();
  if (rest.type !== "END") stop(FORMULA_DIAGNOSTIC_CODES.INVALID_SYNTAX, `unexpected ${describeToken(rest)} after a complete expression`, rest);
  return root;
}

/** Child nodes in evaluation (authored left-to-right) order. */
export function childrenOf(node: FormulaNode): readonly FormulaNode[] {
  switch (node.type) {
    case "UNARY":
      return [node.operand];
    case "BINARY":
      return [node.left, node.right];
    case "CALL":
      return node.arguments;
    default:
      return [];
  }
}

/** Tree depth and first-reference variable order, computed iteratively (no recursion on untrusted depth). */
export function analyzeAst(root: FormulaNode): { depth: number; variables: string[] } {
  const variables: string[] = [];
  const seen = new Set<string>();
  let depth = 0;
  const stack: Array<[FormulaNode, number]> = [[root, 1]];
  while (stack.length > 0) {
    const [node, level] = stack.pop() as [FormulaNode, number];
    if (level > depth) depth = level;
    if (node.type === "VARIABLE" && !seen.has(node.key)) {
      seen.add(node.key);
      variables.push(node.key);
    }
    const children = childrenOf(node);
    for (let k = children.length - 1; k >= 0; k -= 1) stack.push([children[k] as FormulaNode, level + 1]);
  }
  return { depth, variables };
}

/**
 * Parses Formula source into an immutable AST. Never throws for ordinary invalid input: every failure is a structured
 * diagnostic with a source span. Parsing identical source always yields deep-equal results.
 */
export function parseFormulaExpression(expression: string): FormulaParseResult {
  if (typeof expression !== "string") {
    return deepFreeze({ ok: false as const, diagnostics: [diagnostic(FORMULA_DIAGNOSTIC_CODES.INVALID_DEFINITION, "expression must be a string", { path: "/expression" })] });
  }
  const lexed = tokenizeFormula(expression);
  if (!lexed.ok) return deepFreeze({ ok: false as const, diagnostics: [lexed.diagnostic] });
  let ast: FormulaNode;
  try {
    ast = parseTokens(lexed.tokens);
  } catch (error) {
    if (error instanceof ParseStop) return deepFreeze({ ok: false as const, diagnostics: [error.diagnostic] });
    throw error;
  }
  const { depth, variables } = analyzeAst(ast);
  if (depth > FORMULA_LIMITS.MAX_AST_DEPTH) {
    return deepFreeze({
      ok: false as const,
      diagnostics: [diagnostic(FORMULA_DIAGNOSTIC_CODES.EXPRESSION_LIMIT_EXCEEDED, `expression tree is deeper than ${FORMULA_LIMITS.MAX_AST_DEPTH} levels`, { startOffset: 0, endOffset: expression.length, path: "/expression" })],
    });
  }
  return deepFreeze({ ok: true as const, ast, variables });
}
