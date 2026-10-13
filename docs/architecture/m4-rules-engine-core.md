# M4 Rules Engine Core — `@prowess/rules` (M4-WO1)

**Status:** M4-WO1 — Rules Engine Core & Evaluation Contracts. This document holds the permanent M4 invariant
catalog; later M4 Work Orders append to it (M4-WO2: M4-I16 – M4-I25; M4-WO3: M4-I26 – M4-I39; M4-WO4: M4-I40 – M4-I50; M4-WO5: M4-I51 – M4-I64; M4-WO6: M4-I65 – M4-I79; M4-WO7: M4-I80 – M4-I98; M4-WO8: M4-I99 – M4-I115).

## Purpose

M4-WO1 creates the `@prowess/rules` package and the stable evaluation contracts every later M4 subsystem uses —
Formula (WO3), Keyword resolution (WO4), Requirement (WO5), Modifier (WO6), Resource (WO7), Validation (WO8) and Trace /
Explanation (WO9) — so none of them invents its own context, response, message or trace format.

**M4-WO1 implements no Prowess mechanics.** There is no formula, requirement, modifier, keyword behaviour, resource
payment, rounding rule or Ruleset resolution here. The engine knows no stat, rank, resource, keyword or unit by name.

## Architecture

```
M1 ENTITY/VERSION
       │
       ▼
M2 RULESET/MANIFEST
       │
       ▼
Application Resolution
       │
       ▼
┌─────────────────────────┐
│     @prowess/rules      │
│                         │
│ RulesetContext          │
│ ActorContext            │
│ BuildContext            │
│ RuntimeContext          │
│                         │
│ Result                  │
│ Validation Messages     │
│ Trace                   │
└─────────────────────────┘
       │
       ▼
Future:
Formula / Requirement /
Modifier / Resource /
Validation / Trace Engines
```

### Dependency boundary

```
@prowess/model  ←  @prowess/rules  ←  @prowess/db (exact Ruleset resolver, M4-WO2)  ←  (future) HTTP API (M4-WO10) / Studio (M4-WO11)
```

`@prowess/rules` depends on `@prowess/model` only. It must never import `@prowess/db`, `@prowess/import`,
`@prowess/ui`, the Studio app, Prisma, `pg`, Next.js, React, any Node built-in (filesystem, network, `crypto`, `vm`,
child processes) or any AI / web service. Enforced three ways:

- `scripts/check-architecture.mjs` — the `@prowess/rules` import-boundary rule, plus the workspace cycle check;
- `apps/studio/tests/unit/m1-audit-static.test.ts` — the layering audit pins `@prowess/rules` → `@prowess/model`;
- `apps/studio/tests/unit/m4-wo1-static.test.ts` — the M4-WO1 static audit (imports and purity patterns).

As a compile-time backstop, the package's `tsconfig.json` loads **no** Node or DOM type definitions (`types: []`,
`lib: ["ES2022"]`): engine code that names `fetch`, `process`, `setTimeout` or a Node module does not typecheck.

No lower package depends on `@prowess/rules`. Its first consumer is `@prowess/db`'s exact Ruleset resolver (M4-WO2);
nothing in `apps/studio` imports it yet (M4-WO10).

## Pure evaluation model

The engine is **pure, deterministic, ruleset-aware, explainable, non-mutating and historically reproducible**. It
evaluates exactly what it is given:

```
Application service → resolve exact data → construct evaluation context → @prowess/rules
```

It never queries a database, never asks for "the latest" or "the current" anything, and never decides what is Canon,
which Ruleset or Release is newest, which EntityVersion is current, which import Candidate is correct, or what should
be published. Those decisions belong to M1 / M2 / M3. M4-WO2 connects M2's exact Ruleset / Manifest resolution to
`RulesetContext`.

All engine operations are plain synchronous functions. There is no `RulesEngine` class, no rule registry and no
module-level mutable state.

### `evaluate(definition, input)`

The generic boundary every later subsystem plugs into:

1. reads and normalizes the request (structure only); a malformed request is an `ERROR` response and the evaluator
   never runs;
2. checks the request's `kind` against the definition and the context families it `requires` (`MISSING_CONTEXT`);
3. deep-freezes the normalized request and calls the evaluator with it — the evaluator works on a detached, immutable
   copy, so neither the caller's input nor the rules can be changed;
4. checks the evaluator's output (plain data, well-formed messages and trace), numbers the messages and derives the
   status.

A `RulesEngineError` thrown by an evaluator becomes an `ERROR` response. Any other exception is a defect and is
re-thrown unchanged — never disguised as an engine error or a rule outcome.

## The four evaluation contexts

Each family is independently constructible (`createRulesetContext`, `createActorContext`, `createBuildContext`,
`createRuntimeContext`, `createEvaluationRequest`). Construction returns `{ ok: true, value }` with a normalized,
deep-frozen copy, or `{ ok: false, errors }` listing every structural problem — it never throws on bad input.

Validation is **structural only**: types, finite numbers, UUID / canonical-key / context-key grammar, unknown fields,
duplicate set members, one version per Entity. No Requirement or game validation happens here.

**Context keys** (stat, rank, resource, property, keyword, tag, component, effect, evaluation kind, step and unit keys)
are lowercase dotted segments — `power`, `stat.power`, `resource.primary`, `keyword.fire`. `__proto__`,
`constructor` and `prototype` are always rejected.

**Normalization (order independence):** keyed collections are rebuilt with sorted keys and set-like lists are
sorted, so object insertion order and set order never change a context. Explicitly ordered lists — build
`components` and runtime `activeEffects` — keep the caller's order, because order there may carry meaning. UUIDs are
lowercased (UUIDs are case-insensitive; PostgreSQL emits lowercase); every other value is kept verbatim.

### RulesetContext

The exact rules environment, always supplied by the caller:

| Field | Meaning |
| --- | --- |
| `rulesetId`, `manifestId` | exact, required identities |
| `manifestHash` | M2's lowercase hex SHA-256, preserved **verbatim**, never recomputed; `null` when the manifest is unpublished |
| `rulesetVersionLabel` | the Ruleset's human label, or `null` |
| `release` | `{ releaseId, releaseNumber, versionLabel }` when evaluating a published release, else `null` |
| `rules` | `ResolvedRuleReference[]`, sorted by `entityId`, at most one version per Entity |

`ResolvedRuleReference` = `{ entityId, entityVersionId, canonicalKey, entityType, sourceRulesetId, sourceManifestId }`.
Identity is always the immutable ids; `canonicalKey` is explanatory, never relational identity. `sourceRulesetId` /
`sourceManifestId` record where an (inherited) pin came from when the caller knows it, and are `null` otherwise.

The context deliberately has **no** Canon, authority, status, "latest" or "current" field — supplying one is rejected
as an unknown field.

*M4-WO2 refinement:* a context also rejects two rules sharing one canonical key, so exact canonical-key lookup is
never ambiguous. Pure lookups inside an already-resolved context: `findResolvedRule(context, entityId)` and
`findResolvedRuleByCanonicalKey(context, canonicalKey)` — exact comparison only (no alias, display-name, case-folding
or fuzzy matching); `null` means "not part of this Ruleset", never a fallback. Exact contexts are produced from M2 data
by `@prowess/db`'s resolver (`m4-exact-ruleset-resolver.md`).

### ActorContext

The evaluating character / creature / object: `actorRef` (opaque, explanatory), `stats` (keyed numbers), `ranks`
(keyed scalars — a rank may be a number or a named tier), `keywords` (set), `resources` (keyed actor resource values,
e.g. a capacity), `ownedEntities` (set of exact references), `properties` (keyed scalars), `tags` (set).

### BuildContext

The object being constructed — a future Spell, Maneuver, Equipment or Summon build: `buildKind` (required context
key), `components` (ordered, unique keys, each with an optional exact reference and parameters), `parameters`,
`keywords`, `properties`, `references`.

### RuntimeContext

Transient play-time state, as a **container only**: `resourceValues` (current values), `reservedCapacity`,
`activeEffects` (ordered, unique keys), `conditions` (set), `state` (keyed scalars). No turns, casting, damage,
conditions or resource changes are implemented, and evaluation never mutates runtime state.

### Empty and absent contexts

`RulesetContext` is required only by evaluations that declare it. Actor / Build / Runtime are optional unless an
evaluator requires them. An empty Actor or Runtime context is valid; a Build context needs only its `buildKind`. In a
normalized request an absent family is explicitly `null`.

### EvaluationRequest

`{ contractVersion, kind, ruleset, actor, build, runtime, metadata }`. `kind` is a generic context key; no
subsystem-specific union exists yet. `metadata` is caller-supplied **deterministic** plain JSON — it is part of the
evaluation input, so it must never contain a wall-clock time, a random id or anything else that varies between
identical evaluations.

## Response contract

```
RuleEngineResponse<T> {
  contractVersion    1
  evaluationKind     the request's kind, or null if the request was unreadable
  success            boolean
  status             SUCCESS | VALID_WITH_WARNINGS | INVALID | ERROR
  data               T | null
  errors             RuleMessage[]        (engine errors AND validation errors, distinguished by kind)
  warnings           ValidationMessage[]
  info               ValidationMessage[]
  trace              CalculationTrace
  ruleset            RulesetProvenance | null   (verbatim from the request's RulesetContext)
}
```

The same envelope serves every later result type — `RuleEngineResponse<FormulaResult>`,
`RuleEngineResponse<RequirementResult>`, `RuleEngineResponse<ResourcePreview>` and so on.

**Status** is derived from the messages alone (`deriveResponseStatus`):

| Status | Condition | `success` | `data` |
| --- | --- | --- | --- |
| `ERROR` | at least one ENGINE error | false | null |
| `INVALID` | no engine error; at least one VALIDATION error | false | null |
| `VALID_WITH_WARNINGS` | no errors; at least one warning | true | result |
| `SUCCESS` | no errors, no warnings (INFO never changes status) | true | result |

`success` means evaluation completed and produced a valid result, even with advisory warnings or info. An unsatisfied
condition reported **as data** (for example a future `RequirementResult { satisfied: false }`) is still a successful
evaluation; it is `INVALID` only when promoted to a blocking validation message.

The earlier api-contract draft's `OK` / `WARNING` / `CONFLICT` statuses are superseded by this vocabulary. In
particular there is no `CONFLICT`: the engine never resolves or reports Canon conflicts (M2 decided them before
evaluation); a future ruleset-integrity finding is a `RULESET`-category message.

## Engine errors vs validation messages

These never collapse into one opaque string.

**Engine error** (`kind: "ENGINE"`) — the engine could not evaluate. Codes (only those M4-WO1 raises; later Work
Orders append their own, e.g. an unsupported formula operation in WO3):

| Code | Meaning |
| --- | --- |
| `RULE_ENGINE.INVALID_INPUT` | malformed input: shape, unknown field, bad id or key, duplicate set member, wrong kind |
| `RULE_ENGINE.NON_FINITE_NUMBER` | NaN or ±Infinity at the public boundary |
| `RULE_ENGINE.MISSING_CONTEXT` | a required context family is absent |
| `RULE_ENGINE.INVARIANT_VIOLATION` | an engine defect — e.g. an evaluator produced malformed or non-serializable output |

`RulesEngineError` (the thrown form, used inside evaluators) extends the shared `DomainError`. The vocabulary lives in
`@prowess/rules` rather than `@prowess/model` because it is engine-specific. M4-WO1 adds no HTTP route, and the central
HTTP status map is keyed by `@prowess/model`'s vocabularies only, so no status mapping is required yet; **M4-WO10 owns
mapping the `RULE_ENGINE.*` codes** when the Rules HTTP API exists. The codes collide with no model code (tested).

**Validation message** (`kind: "VALIDATION"`) — a statement about the rules or build being evaluated:

```
{ kind, ordinal, severity, category, code, message, path, provenance, details }
```

- severity: `ERROR` | `WARNING` | `INFO`
- category: `STRUCTURE` | `COMPATIBILITY` | `REQUIREMENT` | `PARAMETER` | `CAPACITY` | `RESOURCE` | `FORMULA` | `RULESET` | `RUNTIME` (no validators exist yet — M4-WO8)
- code: namespaced upper case (`REQUIREMENT.NOT_MET`); the `RULE_ENGINE.` namespace is reserved for engine errors
- path: RFC 6901 JSON Pointer into the evaluated input (e.g. `/build/components/1`), or `null`

The **machine contract** is `code`, `category`, `severity` and structured `details`. The human `message` is useful but
clients and tests must not depend on its wording. A malformed message is an engine defect (`INVARIANT_VIOLATION`).

**Ordering:** every message carries an `ordinal` — its position in emission order (input walk order for engine
errors, evaluator emission order for validation messages). Ordinals are unique across `errors`, `warnings` and `info`,
and each list is in ordinal order.

**Serialization:** messages and errors are plain data — no stack trace, cause chain, function or circular reference.
Non-serializable error `details` are dropped rather than leaked.

## Trace contract

```
CalculationTrace { steps: TraceStep[], stepCount }
TraceStep {
  ordinal, path, key, operation, phase,
  inputs: { name, value }[],   (ordered — operand order can matter)
  output, provenance, modifierSource, explanation,
  children: TraceStep[]
}
```

Deterministic identity, with no random UUID and no timestamp: steps stay in the order the evaluator produced them;
`key` is unique among siblings; `path` is hierarchical and 1-based (`"1"`, `"1.2"`, `"1.2.1"`); `ordinal` is the 0-based
pre-order position. Identical inputs produce a byte-identical trace. The trace is structured data only — no HTML, no
React element, no display formatting; Studio renders it later (M4-WO11), and M4-WO9 builds explanations on it.

Trace inputs and outputs are `EvaluationValue`s — a minimal typed value: `NUMBER` (finite, with an optional semantic
`unit` context key and no built-in units), `BOOLEAN`, `STRING`, `IDENTIFIER`, `LIST`. M4-WO3 owns value semantics.

## Provenance contract

`RuleProvenance { entityId, entityVersionId, canonicalKey, rulesetId, manifestId }` (each nullable) can be attached
to any trace step (`provenance`, and `modifierSource` for the rule that modified a value) and to any validation
message. `provenanceOf(rule, context)` builds it from a `ResolvedRuleReference`, preferring the pin's source
Ruleset / Manifest when known. Provenance is optional — a SourceReference is not required on every step — and the
engine never queries M3 source data to fill it in.

`RulesetProvenance` on the response is copied verbatim from the request's `RulesetContext`: identity, manifest hash,
version label and release — never re-resolved or recomputed.

## Determinism and immutability

- Identical input → deep-equal, byte-identical serialized response.
- Inputs are never mutated: normalization builds detached copies, and the evaluator receives a deep-frozen request
  (attempts to mutate rules, actor, runtime or metadata throw `TypeError`).
- Results are deep-frozen; repeated reads never change them; returned `data` is a detached copy.
- Performance: one structural read and copy at the boundary per evaluation; no repeated deep cloning inside helpers.

`src/testing/determinism.ts` (`assertDeterministic`) is the reusable helper for later M4 Work Orders: it snapshots and
deep-freezes inputs, runs the evaluation repeatedly, and requires byte-identical plain-data output, an unchanged output
after re-reading, and unchanged inputs. It is test support and is not exported from the package.

## Clock, randomness and network policy

- **Clock — option A:** the pure response contains no `evaluatedAt`. A wall-clock time would make two identical
  evaluations unequal; an application or HTTP layer that needs one stamps it outside the pure result.
- **Randomness:** none. No `Math.random`, `crypto.randomUUID`, random bytes. Future dice resolution is a separate
  concern outside the M4 core.
- **Network:** none. No network calls, AI calls, external APIs or dynamic fetching; evaluation runs offline.
- **No authored code is ever executed:** no `eval`, `new Function`, `vm`, or dynamic import.

Enforced by the static audit (source patterns) and by a runtime test that makes `Date.now`, `new Date()`,
`Math.random`, `fetch`, `crypto` and `performance.now` throw during an evaluation.

## Numeric and serialization policy

- Numbers are JavaScript **finite** numbers. NaN / ±Infinity are rejected at every public boundary with
  `RULE_ENGINE.NON_FINITE_NUMBER`. `-0` is normalized to `0` so in-memory and serialized values agree. No
  arbitrary-precision library is introduced.
- **Rounding is always explicit.** The engine never silently floors, ceils or rounds; M4-WO3 implemented explicit
  rounding (`floor()` / `ceil()` and the FLOOR / CEIL result modes — see `m4-formula-engine.md`).
- **Units:** no units engine; a `NUMBER` may carry an optional semantic unit label. No unit is hard-coded.
- Every public input and result is plain JSON data: no `Map`, `Set`, `Date`, class instance, function, symbol,
  bigint, `undefined`, sparse array, accessor or cycle.
- **Null policy:** absence is explicit `null` in every normalized context, message, trace step and response. On input,
  an omitted field and `null` both mean absent where a field is optional.

## Cost vs payment boundary

A **listed / computed cost** is not the same thing as a **runtime payment**. The contracts keep them apart:
`ActorContext.resources` holds an actor's resource values, `RuntimeContext.resourceValues` holds current play-time
values, and nothing merges them. There is no `effectiveCost` field anywhere (and supplying one is rejected as an
unknown field). M4-WO7 and M5 build on this distinction.

## Preview vs commit boundary

*M4-WO7 note:* the pure resource transitions `spendResource`, `previewResourcePayment`, `applyResourcePayment` and
`setResourceCurrent` are an explicit allowlist in the WO1 guards. They return new immutable snapshots and persist
nothing — "apply" means compute resulting state. Any other spend / pay / apply / commit-style name still fails.

Pure evaluation is **preview / read-only**. `@prowess/rules` computes results; it never commits, pays, spends or
otherwise mutates actor or runtime state. Any future runtime command that changes state belongs in an
application / service layer, outside pure evaluation.

## Keywords

Keywords are metadata / rule hooks with **no implicit mechanics**. The context `keywords` lists are generic key sets,
not Keyword identity: exact Keyword identity and provenance come from M4-WO4's `resolveKeywords`
(`m4-keyword-resolution.md`), which never scans contexts to infer Keywords.

## Example (generic)

```
Input:
  RulesetContext R1 (exact ruleset + manifest ids, hash verbatim)
  ActorContext   stats: { "stat.power": 4 }

Evaluation:
  a test evaluator that reads stat.power and records one trace step

Output:
  status SUCCESS, data { power: 4 }
  trace  [ { ordinal 0, path "1", key "step.read", operation "op.read", output NUMBER 4 } ]
  ruleset { rulesetId R1, manifestId …, manifestHash … }
```

No game arithmetic is implemented: the evaluator in the tests only reads a slot.

## Contract evolution

`RULES_ENGINE_CONTRACT_VERSION` (currently `1`) versions the shape of the public contracts — contexts, request,
response, messages and trace. It is not a Prowess Ruleset version and not the package version. Additive,
backward-compatible changes keep it; any breaking contract change must increment it deliberately, in the Work Order
that makes the change. A request carrying a different `contractVersion` is rejected. M4-WO1 implements no
contract-migration machinery.

## Explicit M4-WO1 limitations

Not implemented: Ruleset resolution (WO2); formula parsing, AST, calculation or rounding (WO3); keyword resolution
(WO4); requirement evaluation (WO5); modifier application (WO6); resource preview or payment (WO7); validation
orchestration (WO8); explanation generation (WO9); the Rules HTTP API and `RULE_ENGINE.*` HTTP mapping (WO10); the
Rules Inspector UI (WO11); any Spell, Character, Weapon, Maneuver or Summoning rule. No evaluation fingerprint exists —
nothing consumes one yet; when one is introduced it must use deterministic canonical serialization, exclude timestamps
and random ids, include the exact Ruleset and input contexts, and be versioned. No schema change, migration, HTTP
route or UI was added.

## M4 roadmap

| Work Order | Scope |
| --- | --- |
| M4-WO1 | Rules Engine Core & Evaluation Contracts (this document) |
| M4-WO2 | Exact Ruleset Resolver (`m4-exact-ruleset-resolver.md`) |
| M4-WO3 | Formula Engine (`m4-formula-engine.md`) |
| M4-WO4 | Keyword Resolution Foundation (`m4-keyword-resolution.md`) |
| M4-WO5 | Requirement Engine (`m4-requirement-engine.md`) |
| M4-WO6 | Modifier Engine (`m4-modifier-engine.md`) |
| M4-WO7 | Resource Engine Foundation (`m4-resource-engine.md`) |
| M4-WO8 | Validation Engine (`m4-validation-engine.md`) |
| M4-WO9 | Calculation Trace & Explanation Engine |
| M4-WO10 | Rules Evaluation Orchestration & HTTP API |
| M4-WO11 | Rules Inspector & Calculation Lab UI |
| M4-WO12 | Final M4 Integration & Reproducibility Audit |

## M4 invariant catalog

- **M4-I01** Exact Ruleset Context — evaluation uses only the exact, caller-supplied Ruleset / Manifest / rule
  versions; the engine never resolves them.
- **M4-I02** No Hidden Latest — no engine operation selects a "latest", "newest" or "current" rule, version, manifest
  or release.
- **M4-I03** Pure Deterministic Evaluation — identical input yields an identical result; no module-level mutable state.
- **M4-I04** No Arbitrary Code Execution — authored text is never executed (`eval`, `Function`, `vm`, dynamic import).
- **M4-I05** No Wall-Clock Dependency — pure evaluation never reads the clock; results carry no `evaluatedAt`.
- **M4-I06** No Randomness — no random numbers or random ids inside the engine.
- **M4-I07** No Network Dependency — no network, AI or external API; evaluation runs offline.
- **M4-I08** Inputs Are Not Mutated — no caller input or context is changed by evaluation.
- **M4-I09** Structured Validation Messages — messages are structured (severity, category, code, details), distinct
  from engine errors, and the code — not the prose — is the contract.
- **M4-I10** Deterministic Trace Ordering — trace step order, paths and ordinals are deterministic.
- **M4-I11** Rule Provenance Preserved — rule / version / ruleset / manifest provenance survives into contexts, trace
  and response verbatim.
- **M4-I12** Engine Does Not Choose Canon — the engine has no Canon, authority or release-selection concept.
- **M4-I13** Engine Does Not Mutate Rules — resolved rule material is immutable during evaluation.
- **M4-I14** Listed Cost and Payment Remain Distinct Concepts — no merged "effective cost"; actor and runtime resource
  values are separate slots.
- **M4-I15** Runtime Mutation Is Outside Pure Evaluation — evaluation is preview only; it never commits runtime state.

Appended by M4-WO2 (Exact Ruleset Resolver — see `m4-exact-ruleset-resolver.md`):

- **M4-I16** Exact Manifest Resolution — an exact Manifest id resolves to exactly one RulesetContext identifying that
  Manifest.
- **M4-I17** Exact Release Resolution — an exact Release id resolves to exactly one RulesetContext carrying that
  Release's identity and verbatim manifest hash.
- **M4-I18** Effective Manifest Reuses M2 Inheritance — Manifest mode uses M2's effective-manifest resolver; M4 has no
  inheritance algorithm of its own.
- **M4-I19** Release Context Uses Frozen Composition — Release mode uses the Release's own frozen composition, never
  what any Manifest resolves to now.
- **M4-I20** Release Integrity Verified Before Evaluation — M2's hash verifier runs first; a failure yields no context.
- **M4-I21** One Entity → One Resolved EntityVersion — a context holds at most one version per Entity, owned by that
  Entity, and no canonical key twice; ambiguity fails closed.
- **M4-I22** Resolver Never Uses Implicit Latest — no latest / newest / current selection and no descending ordering
  anywhere in resolution; a Ruleset id alone resolves nothing.
- **M4-I23** Historical Manifest Resolution Is Reproducible — later versions and parent manifests never change an
  existing Manifest's context.
- **M4-I24** Historical Release Resolution Is Reproducible — later versions, manifests and releases never change an
  existing Release's context.
- **M4-I25** Ruleset Resolution Is Read-Only — resolution writes nothing; every table is byte-identical afterwards.

Appended by M4-WO3 (Formula Engine — see `m4-formula-engine.md`):

- **M4-I26** Restricted Formula Grammar — only numbers, exact variables, unary `+ -`, binary `+ - * /`, parentheses and
  floor / ceil / min / max, parsed by a purpose-built lexer and parser with complexity limits.
- **M4-I27** Authored Formula Text Is Never Executed — no eval, Function, VM, dynamic import or global function lookup;
  unknown constructs are rejected structurally.
- **M4-I28** Variable Binding Is Exact — exact, case-sensitive own-property keys; missing or non-numeric bindings fail
  closed; no defaults, coercion, aliases or fuzzy matching.
- **M4-I29** Rounding Is Explicit — no rounding unless the Formula says so (floor() / ceil() or FLOOR / CEIL); NONE is the
  default; floating-point results are never prettified.
- **M4-I30** Formula Precedence Is Deterministic — unary, then `* /`, then `+ -`, left-associative.
- **M4-I31** Division By Zero Fails Closed — a zero divisor is a structured failure, never Infinity or NaN.
- **M4-I32** Non-Finite Values Never Escape Evaluation — every operation is checked; `-0` is normalized to `0`.
- **M4-I33** Formula AST Is Serializable And Immutable — plain JSON, deep-frozen, reproducible; supplied ASTs are
  re-validated.
- **M4-I34** Formula Evaluation Is Deterministic — same Formula, bindings and RulesetContext give byte-identical results,
  messages and trace.
- **M4-I35** Formula Dependency Cycles Are Rejected — ordering is deterministic; unknown dependencies and cycles fail
  explicitly, never broken arbitrarily.
- **M4-I36** Formula Provenance Is Preserved — supplied provenance reaches the root trace step and failure messages.
- **M4-I37** Formula Evaluation Is Read-Only — no input (program, AST, bindings, context, provenance) is mutated.
- **M4-I38** Formula Trace Ordering Is Deterministic — the trace mirrors the AST in authored order, then rounding,
  minimum, maximum.
- **M4-I39** Units Have No Implicit Mechanics — a unit is an opaque label: no arithmetic, conversion or compatibility.

Appended by M4-WO4 (Keyword Resolution — see `m4-keyword-resolution.md`):

- **M4-I40** Keywords Are Metadata / Rule Hooks Only — resolution answers presence and provenance, nothing else.
- **M4-I41** Keyword Identity Is Exact — identity is the M1 KeywordDefinition id; one id with different metadata, or one
  canonical key on different ids, fails closed.
- **M4-I42** Keyword Aggregation Is Deterministic — Keywords ordered by canonical key then id, contributors by explicit
  ordinal then source identity; input and property order never matter.
- **M4-I43** Duplicate Contributions Preserve Provenance — one Keyword from many sources is one entry listing every
  source; identical contributions collapse, contradictory ones fail closed.
- **M4-I44** Keywords Have No Implicit Mechanics — no number, cost, stack count, priority, removal or effect.
- **M4-I45** Keyword Lookup Uses No Alias / Fuzzy Matching — exact id or exact canonical key only.
- **M4-I46** Keyword Categories Grant No Mechanics — a category is metadata; it implies no Keyword and is never repaired.
- **M4-I47** Keyword Resolution Is Read-Only — no input or persisted Keyword data changes.
- **M4-I48** Keyword Inputs / Results Are Immutable — results are deep-frozen, detached, serializable.
- **M4-I49** Keyword Provenance Is Preserved — every contributor's source id and RuleProvenance are kept and traced.
- **M4-I50** Keyword Resolution Is Locale-Independent — code-unit ordering; no case conversion or locale API.

Appended by M4-WO5 (Requirement Engine — see `m4-requirement-engine.md`):

- **M4-I51** Unmet Requirement Is A Valid Evaluation Result — a false prerequisite is SUCCESS with `satisfied: false`
  and no error, warning or info.
- **M4-I52** Invalid Requirement Is Distinct From Unsatisfied — malformed definitions or unusable facts are INVALID
  with REQUIREMENT.* diagnostics, never false.
- **M4-I53** Requirement Predicates Consume Explicit Facts Only — no stat, level, rank, ownership or resource is
  computed or looked up.
- **M4-I54** Requirement Facts Use Exact Identity — exact keys, labels, members and ids; conflicting duplicates fail
  closed; fact order never matters.
- **M4-I55** Requirement Groups Support ALL / ANY / NONE — nested, non-empty, authored order preserved.
- **M4-I56** Requirement Groups Evaluate Every Child — no short-circuit; a decided sibling never hides an invalid child.
- **M4-I57** Rank Ordering Is Data, Not Hard-Coded Mechanics — supplied integer orders decide; labels are metadata.
- **M4-I58** Keyword Requirements Reuse Exact WO4 Membership — presence via WO4's lookups; a supplied KeywordSet must be
  exactly what WO4 produces.
- **M4-I59** Requirements Have No Side Effects — no fact, KeywordSet, context or resource changes.
- **M4-I60** Requirement Evaluation Is Deterministic — same inputs give byte-identical result, outcome, diagnostics and
  trace.
- **M4-I61** Requirement Inputs / Outputs Are Immutable — inputs untouched; outputs deep-frozen and detached.
- **M4-I62** Missing Required Context Fails Closed — absent fact, ownership collection or KeywordSet is INVALID; an
  absent member of a supplied collection is a valid false.
- **M4-I63** Requirement Provenance Is Preserved — Requirement-node and fact provenance are kept distinct.
- **M4-I64** Requirement Trees Are Complexity-Bounded — 2,048 nodes, depth 64, 512 children per group; cycles rejected;
  no stack overflow.

Appended by M4-WO6 (Modifier Engine — see `m4-modifier-engine.md`):

- **M4-I65** Modifiers Transform Explicit Targets Only — every target is supplied; none is created; family mismatches
  fail closed.
- **M4-I66** Modifier Ordering Is Explicit And Deterministic — phaseOrder, priority, order, modifierKey; input order
  never controls application.
- **M4-I67** Modifier Phases Are Data — caller-defined `{phaseKey, phaseOrder}`; no phase name carries behaviour; one
  key never has two orders.
- **M4-I68** Modifier Conditions Reuse Requirement Engine — M4-WO5 validates and evaluates every condition.
- **M4-I69** False Conditions Skip Without Error — SKIPPED_CONDITION outcome; no error, warning or info.
- **M4-I70** Numeric Modifiers Never Round Implicitly — each operation is exactly its formula; non-finite fails closed.
- **M4-I71** Percentage Modifiers Apply Sequentially — each to the running value; never pre-combined.
- **M4-I72** Modifier Stacking Has No Hidden Winner — STACK applies all; UNIQUE collapses identical duplicates and
  fails closed on different ones.
- **M4-I73** Ordered Steps Use Explicit Ladders — caller-supplied steps and an explicit CLAMP / INVALID boundary.
- **M4-I74** Advantage / Disadvantage Are Signals, Not Roll Semantics — collected and counted; never cancelled,
  resolved or rolled.
- **M4-I75** Modifier Evaluation Has No Side Effects — nothing paid, spent, reserved or changed.
- **M4-I76** Modifier Inputs / Outputs Are Immutable — inputs untouched (caller facts never frozen); outputs
  deep-frozen and detached.
- **M4-I77** Modifier Provenance Is Preserved — every outcome keeps source and provenance; condition provenance stays
  distinct.
- **M4-I78** Modifier Evaluation Is Deterministic — same request in any array order gives a byte-identical response.
- **M4-I79** Listed Cost And Runtime Payment Remain Distinct — modifiers compute listed values only; payment is never
  modelled or applied.

Appended by M4-WO7 (Resource Engine Foundation — see `m4-resource-engine.md`):

- **M4-I80** Resource State Is Explicit Runtime Data — supplied by the caller, validated strictly, returned as new
  immutable snapshots; never persisted.
- **M4-I81** Resource Identity Is Exact — exact case-sensitive resourceKeys; conflicting duplicates fail closed.
- **M4-I82** Listed Cost Is Immutable During Payment — `listedAmount` is copied through; there is no effective-cost field.
- **M4-I83** Payment Source Order Is Explicit — `order` then `resourceKey`; input order never decides.
- **M4-I84** Temporary Pools Have No Automatic Priority — resource kind is metadata; it never orders, refreshes or
  expires anything.
- **M4-I85** Insufficient Resources Are A Valid Runtime Outcome — `applied: false` / `canPay: false` with a shortfall,
  status SUCCESS; never a diagnostic.
- **M4-I86** Failed Payment Is Atomic — when the total is not covered, the original state is returned unchanged.
- **M4-I87** Capacity Reservation Does Not Spend — reserve changes reservedCapacity only.
- **M4-I88** Capacity Release Does Not Restore Current Value — release changes reservedCapacity only.
- **M4-I89** Reserved Capacity Produces A Distinct Available Maximum — derived, never stored.
- **M4-I90** Current May Remain Above Available Maximum — preserved exactly; no operation silently lowers it.
- **M4-I91** Resource Refresh Is Explicit — caller-invoked, to an explicit ceiling, never lowering current.
- **M4-I92** Resource Operations Never Round Implicitly — finite IEEE-754 values; non-finite fails closed; -0 → 0.
- **M4-I93** Resource Evaluation Has No External Side Effects — "apply" computes state; nothing is persisted.
- **M4-I94** Resource Inputs / Outputs Are Immutable — inputs never mutated or frozen; outputs deep-frozen, detached.
- **M4-I95** Resource Evaluation Is Deterministic — same inputs (any row / source order) give byte-identical results.
- **M4-I96** Resource Provenance Is Preserved — state, transition, payment and source provenance are kept.
- **M4-I97** Payment Preview And Apply Share One Allocation Semantics — one algorithm; only the mode differs.
- **M4-I98** Runtime Payment Never Rewrites Prior Formula / Modifier Results — payment never re-runs or alters them.

Appended by M4-WO8 (Validation Engine — see `m4-validation-engine.md`):

- **M4-I99** Validation Consumes Exact Results; It Does Not Recalculate Mechanics — sources are never re-run; no
  Formula, Requirement, Modifier, Resource, Keyword or Ruleset logic exists in validation.
- **M4-I100** Validation Errors Are Distinct From Engine Errors — failed checks are VALIDATION findings (INVALID); a
  source's ENGINE errors make the combination an engine failure (ERROR), never a finding.
- **M4-I101** Explicit Validation Checks Are Plain Data — outcomes are declared; no callbacks, scripts or expressions.
- **M4-I102** Check Failure Severity Is Explicit — the check's declared severity, never derived from category.
- **M4-I103** PASS Emits No Finding.
- **M4-I104** NOT_APPLICABLE Is Non-Blocking — it emits nothing.
- **M4-I105** Validation Collects All Discoverable Findings — no first-error short-circuit; a malformed item never
  hides another.
- **M4-I106** Validation Source Identity Is Exact — exact sourceKey; conflicting duplicates fail closed.
- **M4-I107** Validation Check Identity Is Exact — exact checkKey; conflicting duplicates fail closed.
- **M4-I108** Validation Ordering Is Explicit And Deterministic — order then key across sources and checks; message
  ordinals re-assigned once, globally unique.
- **M4-I109** False Requirement Does Not Automatically Become A Validation Error.
- **M4-I110** Resource Insufficiency Does Not Automatically Become A Validation Error.
- **M4-I111** Skipped Modifier Does Not Automatically Become A Validation Error.
- **M4-I112** Existing Subsystem Diagnostics Preserve Their Meaning — code, severity, category, path, provenance and
  details unchanged; original ordinals kept in the trace.
- **M4-I113** Validation Inputs / Outputs Are Immutable — inputs never mutated or frozen; outputs deep-frozen, detached.
- **M4-I114** Validation Evaluation Is Deterministic — same request in any array order gives a byte-identical response.
- **M4-I115** Validation Provenance Is Preserved — check provenance and each source diagnostic's own provenance.

## Test coverage map (M4-WO1)

Every invariant has at least one automated guard; the guard files cite the invariant id. The static audit verifies
this table.

| Invariant | Name | Guards |
| --- | --- | --- |
| M4-I01 | Exact Ruleset Context | `context.test.ts` |
| M4-I02 | No Hidden Latest | `m4-wo1-static.test.ts` |
| M4-I03 | Pure Deterministic Evaluation | `evaluate.test.ts`, `m4-wo1-static.test.ts` |
| M4-I04 | No Arbitrary Code Execution | `m4-wo1-static.test.ts` |
| M4-I05 | No Wall-Clock Dependency | `evaluate.test.ts`, `m4-wo1-static.test.ts` |
| M4-I06 | No Randomness | `evaluate.test.ts`, `m4-wo1-static.test.ts` |
| M4-I07 | No Network Dependency | `evaluate.test.ts`, `m4-wo1-static.test.ts` |
| M4-I08 | Inputs Are Not Mutated | `evaluate.test.ts`, `context.test.ts` |
| M4-I09 | Structured Validation Messages | `response.test.ts` |
| M4-I10 | Deterministic Trace Ordering | `trace.test.ts` |
| M4-I11 | Rule Provenance Preserved | `context.test.ts`, `trace.test.ts` |
| M4-I12 | Engine Does Not Choose Canon | `context.test.ts`, `m4-wo1-static.test.ts` |
| M4-I13 | Engine Does Not Mutate Rules | `evaluate.test.ts` |
| M4-I14 | Listed Cost and Payment Remain Distinct Concepts | `context.test.ts`, `m4-wo1-static.test.ts` |
| M4-I15 | Runtime Mutation Is Outside Pure Evaluation | `evaluate.test.ts`, `m4-wo1-static.test.ts` |
| M4-I16 | Exact Manifest Resolution | `ruleset-context.test.ts`, `m4-wo2-static.test.ts` |
| M4-I17 | Exact Release Resolution | `ruleset-context.test.ts`, `m4-wo2-static.test.ts` |
| M4-I18 | Effective Manifest Reuses M2 Inheritance | `ruleset-context.test.ts`, `m4-wo2-static.test.ts` |
| M4-I19 | Release Context Uses Frozen Composition | `ruleset-context.test.ts`, `m4-wo2-static.test.ts` |
| M4-I20 | Release Integrity Verified Before Evaluation | `ruleset-context.test.ts`, `m4-wo2-static.test.ts` |
| M4-I21 | One Entity → One Resolved EntityVersion | `ruleset-context-composition.test.ts`, `lookup.test.ts`, `ruleset-context.test.ts` |
| M4-I22 | Resolver Never Uses Implicit Latest | `m4-wo2-static.test.ts` |
| M4-I23 | Historical Manifest Resolution Is Reproducible | `ruleset-context.test.ts` |
| M4-I24 | Historical Release Resolution Is Reproducible | `ruleset-context.test.ts` |
| M4-I25 | Ruleset Resolution Is Read-Only | `ruleset-context.test.ts`, `m4-wo2-static.test.ts` |
| M4-I26 | Restricted Formula Grammar | `formula-parser.test.ts`, `m4-wo3-static.test.ts` |
| M4-I27 | Authored Formula Text Is Never Executed | `formula-dependency-security.test.ts`, `m4-wo3-static.test.ts` |
| M4-I28 | Variable Binding Is Exact | `formula-evaluate.test.ts` |
| M4-I29 | Rounding Is Explicit | `formula-evaluate.test.ts`, `m4-wo3-static.test.ts` |
| M4-I30 | Formula Precedence Is Deterministic | `formula-parser.test.ts` |
| M4-I31 | Division By Zero Fails Closed | `formula-evaluate.test.ts` |
| M4-I32 | Non-Finite Values Never Escape Evaluation | `formula-evaluate.test.ts` |
| M4-I33 | Formula AST Is Serializable And Immutable | `formula-parser.test.ts` |
| M4-I34 | Formula Evaluation Is Deterministic | `formula-evaluate.test.ts` |
| M4-I35 | Formula Dependency Cycles Are Rejected | `formula-dependency-security.test.ts` |
| M4-I36 | Formula Provenance Is Preserved | `formula-evaluate.test.ts` |
| M4-I37 | Formula Evaluation Is Read-Only | `formula-evaluate.test.ts`, `m4-wo3-static.test.ts` |
| M4-I38 | Formula Trace Ordering Is Deterministic | `formula-evaluate.test.ts` |
| M4-I39 | Units Have No Implicit Mechanics | `formula-evaluate.test.ts`, `m4-wo3-static.test.ts` |
| M4-I40 | Keywords Are Metadata / Rule Hooks Only | `keyword-resolution.test.ts`, `m4-wo4-static.test.ts` |
| M4-I41 | Keyword Identity Is Exact | `keyword-resolution.test.ts` |
| M4-I42 | Keyword Aggregation Is Deterministic | `keyword-resolution.test.ts` |
| M4-I43 | Duplicate Contributions Preserve Provenance | `keyword-resolution.test.ts` |
| M4-I44 | Keywords Have No Implicit Mechanics | `keyword-resolution.test.ts`, `m4-wo4-static.test.ts` |
| M4-I45 | Keyword Lookup Uses No Alias / Fuzzy Matching | `keyword-resolution.test.ts`, `m4-wo4-static.test.ts` |
| M4-I46 | Keyword Categories Grant No Mechanics | `keyword-resolution.test.ts`, `m4-wo4-static.test.ts` |
| M4-I47 | Keyword Resolution Is Read-Only | `keyword-resolution.test.ts`, `m4-wo4-static.test.ts` |
| M4-I48 | Keyword Inputs / Results Are Immutable | `keyword-resolution.test.ts` |
| M4-I49 | Keyword Provenance Is Preserved | `keyword-resolution.test.ts` |
| M4-I50 | Keyword Resolution Is Locale-Independent | `keyword-resolution.test.ts`, `m4-wo4-static.test.ts` |
| M4-I51 | Unmet Requirement Is A Valid Evaluation Result | `requirement-evaluate.test.ts` |
| M4-I52 | Invalid Requirement Is Distinct From Unsatisfied | `requirement-evaluate.test.ts`, `requirement-definition-facts.test.ts` |
| M4-I53 | Requirement Predicates Consume Explicit Facts Only | `requirement-evaluate.test.ts`, `m4-wo5-static.test.ts` |
| M4-I54 | Requirement Facts Use Exact Identity | `requirement-definition-facts.test.ts`, `requirement-evaluate.test.ts` |
| M4-I55 | Requirement Groups Support ALL / ANY / NONE | `requirement-evaluate.test.ts` |
| M4-I56 | Requirement Groups Evaluate Every Child | `requirement-evaluate.test.ts`, `m4-wo5-static.test.ts` |
| M4-I57 | Rank Ordering Is Data, Not Hard-Coded Mechanics | `requirement-evaluate.test.ts`, `m4-wo5-static.test.ts` |
| M4-I58 | Keyword Requirements Reuse Exact WO4 Membership | `requirement-evaluate.test.ts`, `m4-wo5-static.test.ts` |
| M4-I59 | Requirements Have No Side Effects | `requirement-evaluate.test.ts`, `m4-wo5-static.test.ts` |
| M4-I60 | Requirement Evaluation Is Deterministic | `requirement-evaluate.test.ts` |
| M4-I61 | Requirement Inputs / Outputs Are Immutable | `requirement-evaluate.test.ts`, `requirement-definition-facts.test.ts` |
| M4-I62 | Missing Required Context Fails Closed | `requirement-evaluate.test.ts` |
| M4-I63 | Requirement Provenance Is Preserved | `requirement-evaluate.test.ts` |
| M4-I64 | Requirement Trees Are Complexity-Bounded | `requirement-definition-facts.test.ts` |
| M4-I65 | Modifiers Transform Explicit Targets Only | `modifier-evaluate.test.ts`, `m4-wo6-static.test.ts` |
| M4-I66 | Modifier Ordering Is Explicit And Deterministic | `modifier-evaluate.test.ts`, `m4-wo6-static.test.ts` |
| M4-I67 | Modifier Phases Are Data | `modifier-evaluate.test.ts`, `m4-wo6-static.test.ts` |
| M4-I68 | Modifier Conditions Reuse Requirement Engine | `modifier-evaluate.test.ts`, `m4-wo6-static.test.ts` |
| M4-I69 | False Conditions Skip Without Error | `modifier-evaluate.test.ts` |
| M4-I70 | Numeric Modifiers Never Round Implicitly | `modifier-evaluate.test.ts`, `m4-wo6-static.test.ts` |
| M4-I71 | Percentage Modifiers Apply Sequentially | `modifier-evaluate.test.ts`, `m4-wo6-static.test.ts` |
| M4-I72 | Modifier Stacking Has No Hidden Winner | `modifier-evaluate.test.ts` |
| M4-I73 | Ordered Steps Use Explicit Ladders | `modifier-evaluate.test.ts` |
| M4-I74 | Advantage / Disadvantage Are Signals, Not Roll Semantics | `modifier-evaluate.test.ts`, `m4-wo6-static.test.ts` |
| M4-I75 | Modifier Evaluation Has No Side Effects | `modifier-evaluate.test.ts`, `m4-wo6-static.test.ts` |
| M4-I76 | Modifier Inputs / Outputs Are Immutable | `modifier-evaluate.test.ts` |
| M4-I77 | Modifier Provenance Is Preserved | `modifier-evaluate.test.ts` |
| M4-I78 | Modifier Evaluation Is Deterministic | `modifier-evaluate.test.ts` |
| M4-I79 | Listed Cost And Runtime Payment Remain Distinct | `modifier-evaluate.test.ts`, `m4-wo6-static.test.ts` |
| M4-I80 | Resource State Is Explicit Runtime Data | `resource-engine.test.ts` |
| M4-I81 | Resource Identity Is Exact | `resource-engine.test.ts` |
| M4-I82 | Listed Cost Is Immutable During Payment | `resource-engine.test.ts`, `m4-wo7-static.test.ts` |
| M4-I83 | Payment Source Order Is Explicit | `resource-engine.test.ts` |
| M4-I84 | Temporary Pools Have No Automatic Priority | `resource-engine.test.ts`, `m4-wo7-static.test.ts` |
| M4-I85 | Insufficient Resources Are A Valid Runtime Outcome | `resource-engine.test.ts`, `m4-wo7-static.test.ts` |
| M4-I86 | Failed Payment Is Atomic | `resource-engine.test.ts`, `m4-wo7-static.test.ts` |
| M4-I87 | Capacity Reservation Does Not Spend | `resource-engine.test.ts`, `m4-wo7-static.test.ts` |
| M4-I88 | Capacity Release Does Not Restore Current Value | `resource-engine.test.ts`, `m4-wo7-static.test.ts` |
| M4-I89 | Reserved Capacity Produces A Distinct Available Maximum | `resource-engine.test.ts` |
| M4-I90 | Current May Remain Above Available Maximum | `resource-engine.test.ts` |
| M4-I91 | Resource Refresh Is Explicit | `resource-engine.test.ts`, `m4-wo7-static.test.ts` |
| M4-I92 | Resource Operations Never Round Implicitly | `resource-engine.test.ts`, `m4-wo7-static.test.ts` |
| M4-I93 | Resource Evaluation Has No External Side Effects | `resource-engine.test.ts`, `m4-wo7-static.test.ts` |
| M4-I94 | Resource Inputs / Outputs Are Immutable | `resource-engine.test.ts` |
| M4-I95 | Resource Evaluation Is Deterministic | `resource-engine.test.ts` |
| M4-I96 | Resource Provenance Is Preserved | `resource-engine.test.ts` |
| M4-I97 | Payment Preview And Apply Share One Allocation Semantics | `resource-engine.test.ts`, `m4-wo7-static.test.ts` |
| M4-I98 | Runtime Payment Never Rewrites Prior Formula / Modifier Results | `resource-engine.test.ts`, `m4-wo7-static.test.ts` |
| M4-I99 | Validation Consumes Exact Results; It Does Not Recalculate Mechanics | `validation-engine.test.ts`, `m4-wo8-static.test.ts` |
| M4-I100 | Validation Errors Are Distinct From Engine Errors | `validation-engine.test.ts` |
| M4-I101 | Explicit Validation Checks Are Plain Data | `validation-engine.test.ts`, `m4-wo8-static.test.ts` |
| M4-I102 | Check Failure Severity Is Explicit | `validation-engine.test.ts`, `m4-wo8-static.test.ts` |
| M4-I103 | PASS Emits No Finding | `validation-engine.test.ts`, `m4-wo8-static.test.ts` |
| M4-I104 | NOT_APPLICABLE Is Non-Blocking | `validation-engine.test.ts` |
| M4-I105 | Validation Collects All Discoverable Findings | `validation-engine.test.ts`, `m4-wo8-static.test.ts` |
| M4-I106 | Validation Source Identity Is Exact | `validation-engine.test.ts` |
| M4-I107 | Validation Check Identity Is Exact | `validation-engine.test.ts` |
| M4-I108 | Validation Ordering Is Explicit And Deterministic | `validation-engine.test.ts` |
| M4-I109 | False Requirement Does Not Automatically Become A Validation Error | `validation-engine.test.ts`, `m4-wo8-static.test.ts` |
| M4-I110 | Resource Insufficiency Does Not Automatically Become A Validation Error | `validation-engine.test.ts`, `m4-wo8-static.test.ts` |
| M4-I111 | Skipped Modifier Does Not Automatically Become A Validation Error | `validation-engine.test.ts`, `m4-wo8-static.test.ts` |
| M4-I112 | Existing Subsystem Diagnostics Preserve Their Meaning | `validation-engine.test.ts`, `m4-wo8-static.test.ts` |
| M4-I113 | Validation Inputs / Outputs Are Immutable | `validation-engine.test.ts` |
| M4-I114 | Validation Evaluation Is Deterministic | `validation-engine.test.ts` |
| M4-I115 | Validation Provenance Is Preserved | `validation-engine.test.ts` |

Test files: `packages/prowess-rules/src/{context,response,trace,evaluate,public-surface,lookup}.test.ts`,
`packages/prowess-rules/src/formula-{parser,evaluate,dependency-security}.test.ts`,
`packages/prowess-rules/src/keyword-resolution.test.ts`, `packages/prowess-db/tests/integration/m1-keyword-resolution.test.ts`,
`packages/prowess-rules/src/requirement-{evaluate,definition-facts}.test.ts`, `packages/prowess-rules/src/modifier-evaluate.test.ts`,
`packages/prowess-rules/src/resource-engine.test.ts`, `packages/prowess-rules/src/validation-engine.test.ts`,
`packages/prowess-db/tests/unit/ruleset-context-composition.test.ts`,
`packages/prowess-db/tests/integration/ruleset-context.test.ts`, and
`apps/studio/tests/unit/m4-wo{1,2,3,4,5,6,7,8}-static.test.ts`.
