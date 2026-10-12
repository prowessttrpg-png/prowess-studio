# M4 Formula Engine (M4-WO3)

**Status:** M4-WO3 — Formula Engine. Invariants M4-I26 – M4-I39 are catalogued, with their automated guards, in
`m4-rules-engine-core.md`.

## Purpose

A safe, deterministic engine for the mathematical part of rules. **Formulas are data, not code**: authored text is
tokenized and parsed by a purpose-built grammar into a plain AST, and that AST is evaluated by a closed set of numeric
operations. Nothing is ever executed as JavaScript.

M4-WO3 provides the mathematics only. It knows no Prowess rule: an expression like `floor(final_mp / prowess)` is
just arithmetic over two opaque variable keys. The rules that will use it (and their minimums, modifiers and
payment) belong to later content and to M5.

Code: `packages/prowess-rules/src/formula/` — pure, inside `@prowess/rules`, which still depends on `@prowess/model`
only. No database, persistence, route or UI.

| File | Role |
| --- | --- |
| `diagnostics.ts` | `FORMULA.*` codes, complexity limits, the four functions and their arity |
| `ast.ts` | AST node types, identifier grammar |
| `lexer.ts` | single-pass character scanner |
| `parser.ts` | recursive-descent parser, `parseFormulaExpression` |
| `evaluate.ts` | program validation, evaluation, rounding, bounds, trace, `evaluateFormula` |
| `dependency.ts` | `orderFormulaDependencies` |

## Flow

```
Formula Source
      │
      ▼
Tokenizer
      │
      ▼
Parser
      │
      ▼
Immutable AST
      │
      ▼
Variable Binding
      │
      ▼
AST Evaluation
      │
      ▼
Explicit Rounding
      │
      ▼
Minimum / Maximum
      │
      ▼
Formula Result + Trace
```

## Security

```
Authored Formula Text
      │
      ├── X eval
      ├── X Function
      ├── X JS parser/runtime
      └── X arbitrary function lookup
      │
      ▼
Restricted Lexer / Parser
      │
      ▼
Known AST Node Types Only
      │
      ▼
Known Numeric Operations Only
```

- The lexer reads one character at a time with explicit character-class checks; the parser is hand-written recursive
  descent. No JavaScript / TypeScript parser, no `eval`, `Function`, `vm`, dynamic import, and no regular expression
  touches the source inside the lexer or parser.
- A function call is accepted only if its name is exactly `floor`, `ceil`, `min` or `max`, and its evaluation is a
  closed `switch` over those names — never a lookup in `globalThis`, `Math` or any table indexed by authored text.
- Anything outside the grammar is rejected structurally: `process.exit()`, `Math.random()`, `eval(…)`, `require(…)`,
  `import(…)`, `fetch(…)` are unknown functions; `a[0]`, `a = 1`, `a ? b : c`, `a > b`, `a && b`, quotes, braces and `;`
  are unknown tokens; `2 ** 3` is invalid syntax.
- `globalThis`, `this`, `window`, `document` are merely opaque variable keys: unbound they fail as missing variables;
  bound, they are just numbers from the caller's bindings. No global is ever read.
- Identifier segments `__proto__`, `constructor` and `prototype` are rejected; bindings are read as **own** data
  properties only (inherited members such as `toString` are missing; getters are never invoked; non-plain objects are
  rejected).
- A pre-parsed AST supplied by a caller is re-validated (node types, operators, function names, arity, finiteness,
  limits, plain data, no cycles) — never trusted.

The M4-WO1 static audit applies all package purity rules to these files; the M4-WO3 audit adds the formula-specific
ones (`apps/studio/tests/unit/m4-wo3-static.test.ts`).

## Grammar

```
expression     → additive
additive       → multiplicative ( ( "+" | "-" ) multiplicative )*
multiplicative → unary ( ( "*" | "/" ) unary )*
unary          → ( "+" | "-" ) unary | primary
primary        → NUMBER
               | IDENTIFIER "(" [ expression ( "," expression )* ] ")"     function call
               | IDENTIFIER                                                variable
               | "(" expression ")"
```

Precedence, highest first: parentheses / function calls; unary `+ -`; `* /`; `+ -`. Binary operators are
left-associative: `2 + 3 * 4 = 14`, `20 / 5 * 2 = 8`, `10 - 3 - 2 = 5`, `(2 + 3) * 4 = 20`, `--5 = 5`. The whole source
must be consumed (`1 + 2 garbage` fails).

**Tokens.**

- `NUMBER`: `digits` or `digits.digits`. No sign (negation is unary minus), no exponent, no hex / binary, no separators,
  no leading or trailing dot. `1e5`, `0x10`, `1_000`, `.5`, `1.`, `1.5.2` are rejected. A literal too large to be finite
  is rejected.
- `IDENTIFIER`: `[A-Za-z_][A-Za-z0-9_]*` followed by any number of `.segment` where a segment is
  `[A-Za-z0-9_]+` — `power`, `final_mp`, `actor.prowess`, `PRO`.
- Operators `+ - * /`, `(`, `)`, `,`.
- Whitespace: space, tab, LF, CR — insignificant between tokens.

Executable syntax uses ASCII operators only: `×`, `÷`, `−`, non-ASCII whitespace and every other character are
`FORMULA.UNKNOWN_TOKEN`. The engine never guesses what an authored symbol meant; M3 preserves source text as evidence,
and any normalization into executable syntax is a later, explicit materialization step. Rulebook prose such as
"Spell AP Cost = Total MP Cost ÷ Prowess Score" is never interpreted here.

**Identifiers** are exact and case-sensitive (`PRO`, `pro` and `Prowess` are different keys); a dotted identifier is
ONE opaque key, never property access. There is no alias, display-label, case-folding, substring or fuzzy resolution.
Parsing is locale-independent: the decimal separator is always `.`.

## AST

A discriminated union of plain, deep-frozen, JSON-serializable objects:

| Node | Fields |
| --- | --- |
| `NUMBER` | `value` |
| `VARIABLE` | `key` |
| `UNARY` | `operator` (`+` / `-`), `operand` |
| `BINARY` | `operator` (`+ - * /`), `left`, `right` |
| `CALL` | `name` (`floor` / `ceil` / `min` / `max`), `arguments` (authored order) |

Every node carries `startOffset` / `endOffset`: JavaScript UTF-16 code-unit offsets into the expression, end-exclusive.
`floor(final_mp / prowess)` is a `CALL floor` whose single argument is `BINARY /` of `VARIABLE final_mp` (offsets
6–14) and `VARIABLE prowess` (17–24).

`parseFormulaExpression(source)` returns `{ ok: true, ast, variables }` — variables once each, in first-reference
(left-to-right) order — or `{ ok: false, diagnostics }`. It never throws for ordinary invalid input. The AST is the
canonical parsed form; authored source is never rewritten or reformatted.

## Functions

| Function | Arity | Semantics |
| --- | --- | --- |
| `floor(x)` | exactly 1 | `Math.floor` (`floor(-1.2) = -2`) |
| `ceil(x)` | exactly 1 | `Math.ceil` (`ceil(-1.2) = -1`) |
| `min(a, b, …)` | at least 2 | numeric minimum |
| `max(a, b, …)` | at least 2 | numeric maximum |

Arity is checked at parse time. No other function exists.

## Formula programs and evaluation

```ts
evaluateFormula(program, bindings, { ruleset? }): RuleEngineResponse<FormulaResult>
```

A **program** is plain data, not a persistent FormulaDefinition:

| Field | Meaning |
| --- | --- |
| `expression` *or* `ast` | exactly one: authored source (kept as given) or a pre-parsed AST (re-validated) |
| `rounding` | `NONE` (default) / `FLOOR` / `CEIL` |
| `minimum`, `maximum` | optional finite bounds; `minimum > maximum` is invalid (never swapped) |
| `unit` | optional opaque label |
| `provenance` | optional M4-WO1 `RuleProvenance` |

Evaluation order is fixed and tested:

```
1. evaluate the expression AST   → expressionValue
2. explicit result rounding      → rounding.value
3. minimum  (value = max(value, minimum))
4. maximum  (value = min(value, maximum))
                                 → finalValue
```

`0.8` with FLOOR and minimum 1 is `1`: bounds apply after rounding. The Formula bounds are not the `min()` / `max()`
functions; both may appear in one Formula. There is **no implicit minimum of zero** — negative results are valid.

**Rounding is explicit.** `NONE` is the default and keeps fractions. There is no `NEAREST` mode: nothing needs it yet,
and its half-way behaviour would have to be specified first. `floor()` inside an expression and the program-level
rounding mode are separate, independent concepts.

**Result** (`FormulaResult`): `finalValue`, `expressionValue` (kept distinct — `17 / 4` with FLOOR gives
`expressionValue 4.25`, `finalValue 4`), `rounding { mode, value }`, `minimum` / `maximum` `{ bound, applied }` or
null, `unit`, and `variables` — the value used for each referenced variable, in first-reference order.

The response is the M4-WO1 `RuleEngineResponse` produced by the WO1 `evaluate()` boundary (evaluation kind
`formula.evaluate`): there is no second envelope. `ruleset` records the exact RulesetContext (M4-WO2) supplied by the
caller; it is never searched for "the current Formula" — the caller selects and supplies the exact Formula.

`validateFormulaProgram(program)` checks a program without evaluating it — expression or AST, rounding, bounds, unit,
provenance, in that order. It is local to Formula correctness; the cross-system Validation Engine is M4-WO8.

## Variable binding

Bindings are a plain object of finite numbers, read as exact own data properties of the referenced keys:

- a referenced variable with no binding → `FORMULA.MISSING_VARIABLE` (never 0, null, a default or a near match);
- a binding that is not a finite number → `FORMULA.INVALID_VARIABLE_VALUE` (no coercion of `"4"`, `true`, `null`);
- all binding problems are reported together, in first-reference order, before anything is evaluated;
- **extra bindings are accepted and ignored**, and never inspected — they cannot change the result, the trace or the
  variable list (even a malformed extra value). Callers may pass a broad numeric context;
- binding insertion order never matters.

## Numeric policy

IEEE-754 JavaScript numbers, finite only. No arbitrary-precision library. Results are never prettified
(`0.1 + 0.2` stays `0.30000000000000004`). Division is real division (`5 / 2 = 2.5`). Division by zero — including
`-0` and computed zeros — fails closed with `FORMULA.DIVISION_BY_ZERO`; any operation producing NaN or ±Infinity fails
with `FORMULA.NON_FINITE_RESULT`. After a fatal failure nothing further is applied. `-0` is normalized to `0` in every
result and trace value.

## Units

A unit is an opaque label (a letter, then letters / digits / `_ . -`, at most 64 characters) carried into the result and
the root trace step. There is no dimensional arithmetic, no conversion, no compatibility check — adding values labelled
differently is not detected, by design.

## Diagnostics

| Code | Meaning |
| --- | --- |
| `FORMULA.INVALID_SYNTAX` | malformed expression, trailing input, malformed number or identifier |
| `FORMULA.UNKNOWN_TOKEN` | a character outside the grammar |
| `FORMULA.UNKNOWN_FUNCTION` | a call to anything but floor / ceil / min / max |
| `FORMULA.INVALID_ARITY` | wrong argument count |
| `FORMULA.EXPRESSION_LIMIT_EXCEEDED` | a complexity limit |
| `FORMULA.INVALID_DEFINITION` | malformed program / AST / rounding / unit / provenance / dependency node |
| `FORMULA.INVALID_BOUNDS` | non-finite bound, or minimum > maximum |
| `FORMULA.MISSING_VARIABLE` | no binding for a referenced variable |
| `FORMULA.INVALID_VARIABLE_VALUE` | a binding that is not a finite number |
| `FORMULA.DIVISION_BY_ZERO` | zero divisor |
| `FORMULA.NON_FINITE_RESULT` | an operation overflowed to a non-finite value |
| `FORMULA.UNKNOWN_DEPENDENCY` | a dependency on a key not in the graph |
| `FORMULA.DEPENDENCY_CYCLE` | a dependency cycle |

Each diagnostic carries `code`, `message`, a JSON-Pointer `path` and, where it concerns the source, `startOffset` /
`endOffset`. In a response they are VALIDATION messages (category `FORMULA`, severity ERROR, status `INVALID`):
malformed authored input is a rule outcome, not an engine crash. `RULE_ENGINE.*` remains reserved for genuine engine
invariant failures. Clients rely on the code, not the prose.

## Complexity limits

| Limit | Value |
| --- | --- |
| source length | 8,192 UTF-16 code units |
| tokens | 2,048 |
| AST nodes | 2,048 |
| nesting (parentheses, calls, unary) | 64 |
| AST depth | 512 |

Nesting is bounded during parsing, so 4,000 parentheses fail cleanly rather than overflowing the stack; the separate
depth limit bounds long left-associative chains such as `a - a - … - a`. The parser and evaluator are linear in the
input. There is no parser cache and no mutable Formula class.

## Trace

Formula-local, machine-readable, built on the M4-WO1 trace contract. One root step `formula` (operation
`formula.evaluate`, output `finalValue`, the Formula's provenance, the unit as an input) whose children are the
expression step tree followed — when configured — by `rounding`, `minimum` and `maximum` steps. The expression tree
mirrors the AST in authored order (`left` / `right`, `operand`, `arg.0`, `arg.1`, …; `min` / `max` arguments are never
re-sorted). Variable steps record the key and the bound value. For `floor(total / divisor)` with 17 and 4:

```
1        formula      formula.evaluate   → 4
1.1      expression   formula.floor      → 4
1.1.1    arg.0        formula.divide     → 4.25
1.1.1.1  left         formula.variable   → 17   (key "total")
1.1.1.2  right        formula.variable   → 4    (key "divisor")
```

Provenance is attached once, at the root, not repeated on every arithmetic node. No prose explanation is produced —
explanation composition is M4-WO9.

## Dependency graph

```ts
orderFormulaDependencies([{ key, dependencies[] }, …])
  → { ok: true, order } | { ok: false, diagnostics, cycle }
```

A pure helper over caller-supplied nodes only — it never queries a RulesetContext, M2 or persistence, and nothing is
stored. Dependencies come before dependents; whenever several keys are ready at once the lexically smallest (UTF-16
code-unit order) goes first, so input order never matters.

```
Formula A ──► Formula B
   │
   └───────► Formula C
                 │
                 ▼
              Formula D

Topological order:
B / D / C / A
```

```
A → B → C → A

= FORMULA.DEPENDENCY_CYCLE, cycle ["A", "B", "C", "A"]
```

A dependency on a key not in the graph is `FORMULA.UNKNOWN_DEPENDENCY` — never treated as an external variable. A
cycle (including a self-dependency) is reported by walking from the smallest unresolved key along its smallest
unresolved dependency; it is never broken arbitrarily.

## Determinism, immutability, provenance

The same Formula, bindings and RulesetContext give a byte-identical response — result, messages and trace — with no
clock, randomness, locale or row order involved. The AST and every result are deep-frozen; no input (program, AST,
bindings, RulesetContext, provenance) is mutated. Supplied provenance is preserved on the root trace step and on every
Formula failure message.

## Generic examples

Representative Prowess-shaped mathematics the engine can compute, as plain arithmetic: `floor(17 / 4) = 4`,
`1 + floor(10 / 2) = 6`, `15 * 4 = 60`. A future rule such as "Spell AP = floor(final listed MP / PRO)" will use this
machinery; the rule itself, its minimum and its modifiers belong to M5. No runtime payment resource alters a Formula's
listed cost here — the M4-I14 cost / payment distinction is untouched.

## Limitations

M4-WO3 does not implement: persistent FormulaDefinitions; Formula authoring UI; source extraction materialization;
Formula selection from a RulesetContext; boolean expressions, comparisons, exponentiation or modulo; dice or
randomness; unit conversion; Requirement evaluation; Keyword behaviour; Modifier sequencing; Resource payment;
cross-system validation; the explanation engine; the Rules API; the Rules Inspector. No schema change, no migration.

## M4-WO4 handoff

Keyword Resolution builds on the same pure conventions: exact keys, no fuzzy matching, structured `RuleEngineResponse`
results, deterministic trace. Keywords remain metadata / rule hooks with no implicit mechanics; any keyword-driven
arithmetic will be expressed as explicit Formula programs evaluated here.
