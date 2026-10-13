# M4 Calculation Trace & Explanation Engine (M4-WO9)

**Status:** M4-WO9 — Calculation Trace & Explanation Engine. Invariants M4-I116 – M4-I134 are catalogued, with their
automated guards, in `m4-rules-engine-core.md`.

## Purpose

WO9 answers: **"What happened during an exact evaluation — in what order, why, with which values, from which rule
provenance?"**

**Explanation describes calculation. It never performs it.** WO9 calls no Formula, Requirement, Modifier, Resource,
Validation, Keyword or Ruleset evaluator; the static audit forbids every one by name. It produces a deterministic,
machine-readable view over results that already exist.

Code: `packages/prowess-rules/src/explanation/` (`model.ts`, `build.ts`, `project.ts`). It is pure, inside
`@prowess/rules`, which still depends only on `@prowess/model`. There is no database, persistence, cache, route, UI,
network or AI.

```
Formula Trace ───────┐
Requirement Trace ───┤
Modifier Trace ──────┤
Resource Trace ──────┤
Validation Trace ────┤
                     ▼
              WO9 EXPLANATION
                     │
              ┌──────┴──────┐
              ▼             ▼
           SUMMARY       DETAILED
```

```
Formula Result ─────────┐
Modifier Result ────────┤
Resource Result ────────┤
Validation Result ──────┤
                        ▼
                    EXPLAIN

No arrows return to: Formula, Modifier, Resource, Validation
```

## API

```ts
buildExplanation({ explanationKey, title?, contributions[], ruleset?, provenance? }, { ruleset? })
  → RuleEngineResponse<ExplanationDocument>              // the canonical DETAILED document
projectExplanation(detailedDocument, "SUMMARY" | "DETAILED")
  → RuleEngineResponse<ExplanationDocument>              // a filter over it
```

Both use the M4-WO1 envelope. Malformed input gives INVALID with `EXPLANATION.*` diagnostics. There is no engine or
builder class and no template language.

## Contributions

```
ExplanationContribution {
  contributionKey, order, kind, response, label?, description?, unit?, groupKey?, provenance?
}
```

- **One exact completed response per contribution, never re-run.** The response is verified as a genuine WO1 response
  by M4-WO8's reader: exact fields, status / success / data consistency, messages re-validated, unique ordinals.
- **Kind is explicit and never guessed:** `FORMULA`, `KEYWORD`, `REQUIREMENT`, `MODIFIER`, `RESOURCE`, `VALIDATION` or
  `GENERIC`. It must match the response's own `evaluationKind` (FORMULA ↔ `formula.evaluate`, RESOURCE ↔
  `resource.*`, …). A mislabelled response is rejected, not reinterpreted.
- **Identity is exact.** An identical duplicate collapses; a conflicting one is `DUPLICATE_CONTRIBUTION`.
- **Order is explicit:** `order` then `contributionKey` in UTF-16 code units. Input array order never matters.
- **Presentation metadata only:** label, description, unit and groupKey never change mechanics or structure.
  Relabelling "Primary Pool" as "Mana" changes only the label. Units are never inferred from values, and grouping is
  never inferred from key names.

## ExplanationDocument

```
ExplanationDocument { explanationKey, title, level, ruleset, provenance, summary, sections[] }
summary             { contributionCount, errorCount, warningCount, infoCount, nodeCount }

ExplanationSection {
  sectionKey, kind, order, label, description, unit, groupKey, evaluationKind,
  responseStatus, status, statusLabel, facts[], nodes[], diagnostics[], provenance, ruleset
}

ExplanationFact { factKey, label, value }

ExplanationNode {
  nodeId, explanationPath, sourceContributionKey, sourceTracePath, sourceTraceOrdinal,
  key, operation, phase, status, label, inputs, output, provenance, modifierSource,
  relatedDiagnosticOrdinals, omittedChildCount, children[]
}
```

There is one section per contribution, in contribution order. No universal "final value" is chosen when several
calculations are explained.

### Nodes: the WO1 trace is the authority

Every node is a WO1 `TraceStep` projected one-to-one:
- operation, phase, inputs, output and provenance are unchanged;
- `sourceTracePath` and `sourceTraceOrdinal` are verbatim. Ordinals are contribution-local, so ordinal 2 of a Formula
  is not ordinal 2 of a Modifier.

Each node also gets its own identity, distinct from the source path:
- `nodeId` = `contributionKey#sourceTracePath`, content-derived with no randomness, clock or counter;
- `explanationPath` = `sectionPosition/sourceTracePath`.

Source traces are never renumbered, re-ordered or mutated, so WO11 can navigate node → source trace step → rule
provenance.

Traversal is iterative, bounded at depth 512. Every step's path must equal the path its position implies, ordinals must
be unique, and `stepCount` must match the steps. Otherwise the input fails closed with `INVALID_TRACE_REFERENCE`, so a
reference can never silently point at the wrong step.

### Facts: copied, never computed

Section facts are read from the result's own typed fields. A missing or mistyped field is `INVALID_CONTRIBUTION`.

| Kind | Facts |
| --- | --- |
| FORMULA | `expressionValue` (raw result), `rounding` {mode, value}, `minimum`, `maximum`, `finalValue`, `unit`, `variables` |
| KEYWORD | `keywordCount` (identities and contributors are in the nodes; no implied effect) |
| REQUIREMENT | `satisfied` |
| MODIFIER | `initial:<target>` and `final:<target>` |
| RESOURCE (payment) | `listedAmount`, `canPay`, `totalPaid`, `shortfall`, `paid:<source>`, `resultingCurrent:<source>`, `resourceStateChanged` |
| RESOURCE (transition) | operation, applied, requested, actual, shortfall, overflow, current before / after, reserved before / after, maximum, available maximum before / after |
| VALIDATION | error / warning / info counts |
| GENERIC | none (trace only) |

Values are never rounded, formatted, truncated or unit-converted. A response without data (INVALID or ERROR) gets
**no facts**: no result is invented. Its partial trace and diagnostics are still shown, and a node WO5 marked as
unevaluable (null output) is shown as INVALID.

### Statuses: from explicit fields only

Presentation statuses come only from explicit source fields, never from value shape:

| Source | Status |
| --- | --- |
| response `ERROR` / `INVALID` | `ENGINE_FAILURE` / `INVALID` |
| Requirement step BOOLEAN output | `SATISFIED` / `NOT_SATISFIED` (null output → `INVALID`) |
| Modifier step `status` input | `APPLIED` / `SKIPPED` / `DEDUPLICATED` |
| payment `canPay`, settlement step output | `PAYABLE` / `PAYMENT_UNAVAILABLE` |
| transition `applied` | `APPLIED` / `NOT_APPLIED` |
| Validation check `outcome` input | `PASS` / `FAIL` / `NOT_APPLICABLE` |
| Validation response status | `VALID` / `VALID_WITH_WARNINGS` |

Each status has a short canonical label, such as "Requirement not satisfied", "Skipped: condition not satisfied",
"Payment unavailable" or "Valid with warnings". These are deterministic phrases, not narrative, and localization is
left to the UI.

A valid false Requirement is **NOT_SATISFIED**, never "invalid". A skipped modifier is **SKIPPED**, never "failed". A
deduplicated one never appears as applied. An unaffordable payment is **PAYMENT_UNAVAILABLE**, never an engine
failure.

```
Requirement
    │
    ▼
satisfied = false
valid evaluation
    │
    ▼
Explanation:
"Requirement not satisfied"

Separate ValidationCheck:
mandatory prerequisite
    │
    ▼
ERROR

Explanation:
"Validation failed"

Two different facts.
```

### Diagnostics and links

Each section carries its response's own messages exactly: category, code, path, details and provenance. Validation
check and finding nodes link to them through `relatedDiagnosticOrdinals`, taken from the WO8 trace's `final_ordinal`.
A reference to a diagnostic that does not exist fails closed. This is how WO11 will show "this node caused Warning
#2". A validation ERROR is its own section and never alters another section's explanation.

## Listed cost vs payment (M4-I14, M4-I128)

```
Final Listed Cost = 17
        │
        ├──────────► Derived Formula uses 17
        │                 │
        │                 ▼
        │                 4
        │
        ▼
Payment

Source A = 6
Source B = 11

After payment:

Listed Cost = 17
Derived Result = 4

Payment did not rewrite either.
```

A payment explanation always shows the **listed amount** as one fact and each **allocation** as its own fact,
following source payment order. No effective cost, reduced cost or net cost exists in the model, code or output; the
static audit forbids the vocabulary and any arithmetic on result fields.

A cross-system test runs real WO6, WO3, WO7 and WO8 evaluations and asserts each of the following:
- listed 17, derived 4, payment 6 + 11;
- every input unchanged;
- no explanation text describing the cost as 11.

When payment is unavailable (cost 10 against sources of 6 + 2), the explanation shows the shortfall of 2,
`resourceStateChanged: false`, and A still at 6 and B still at 2. No partial payment is implied.

```
Maximum 20
Current 18
Reserve 6
      │
      ▼
Reserved 6
Available Maximum 14
Current 18

Explanation:
"Capacity reserved"

NOT:
"4 resource spent"
```

Reservation and release are explained as capacity changes (reserved before / after, available maximum), with current
before and after equal. Neither is ever described as spending or restoration.

## Summary vs Detailed

`buildExplanation` produces the one canonical **DETAILED** document. `projectExplanation(doc, "SUMMARY")` only
**filters** it. It keeps:
- every section, with its status, facts and diagnostics, so failures and warnings stay visible and the counts are
  unchanged;
- the top two trace levels;
- any deeper node that is INVALID, NOT_SATISFIED, NOT_APPLIED, PAYMENT_UNAVAILABLE or FAIL, or that produced a
  diagnostic, together with its ancestors.

Kept nodes keep their ids, fields and relative order, and report `omittedChildCount`. Projection copies node fields;
it never creates a value, status or fact, so a summary is always a subset of its detailed source. Projection is
idempotent, never mutates its input, and DETAILED projects to an identical copy.

## Provenance

- Rule provenance is kept per node (`provenance`, `modifierSource`) and per contribution. Two records are never merged,
  even when they point at the same Entity.
- The document's `ruleset` is the caller's exact RulesetProvenance, validated and preserved verbatim, and each section
  keeps its response's own `ruleset`.
- No source text, Entity name, Ruleset name or Keyword name is ever looked up. Display metadata comes from the caller.
- No Canon, authority, import or "latest" logic exists.

## Determinism, immutability, safety, limits

- The same input, in any contribution order, gives byte-identical DETAILED and SUMMARY documents, node ids and
  references. Later Entity, Ruleset, Canon or import changes cannot affect them, because nothing is looked up.
- Inputs are never mutated or frozen. Outputs are deep-frozen, detached and JSON-serializable, with no Map, Set,
  class, function or Date.
- Getters are never invoked. Prototype-shaped, cyclic and pathologically nested input fails safely. Traces are walked
  iteratively.
- Limits: 4,096 contributions, 50,000 trace nodes per contribution, 100,000 nodes in total, and trace depth 512.
  Exceeding any of them is `EXPLANATION.LIMIT_EXCEEDED`; nothing is silently omitted.
- WO9's own trace is small: one step per section, never a copy of every source trace.

| Diagnostic | Meaning |
| --- | --- |
| `EXPLANATION.INVALID_INPUT` | malformed request, ruleset, provenance, or a non-DETAILED document given to projection |
| `EXPLANATION.INVALID_CONTRIBUTION` | malformed contribution, not a genuine WO1 response, kind / evaluationKind mismatch, or result fields missing |
| `EXPLANATION.UNSUPPORTED_CONTRIBUTION` | an unknown contribution kind |
| `EXPLANATION.DUPLICATE_CONTRIBUTION` | conflicting contributions share a key |
| `EXPLANATION.INVALID_TRACE_REFERENCE` | a malformed trace, a path inconsistent with its position, or a dangling diagnostic reference |
| `EXPLANATION.LIMIT_EXCEEDED` | a limit above |

There are no business codes; those belong to the subsystems and to validation.

## Future Prowess explanations (documentation only, not implemented)

```
SPELL COST
Targeting 5 · Effect 9 · Trait 3      → Base Cost 17
Affinity: no adjustment · Conditions: no adjustment
Final Listed MP 17
AP Formula: floor(17 / 4) = 4
Payment: Temporary 6 · Primary 11
Listed MP remains 17 · Listed AP remains 4
```

- **A modified cost:** 20 → REDUCE_PERCENT 10% → 18 → REDUCE_PERCENT 10% → 16.2. Any later rounding is a subsystem
  rule; WO9 explains only the exact supplied results.
- **A prerequisite:** Affinity rank ≥ Expert against an actual rank of Trained is "Requirement not satisfied". A
  validation ERROR that the prerequisite is required is a separate fact.
- **Mana Lock:** with nominal maximum 20, 6 reserved, available maximum 14 and current 18, current is shown as 18. It
  never "became 14".

The implementation knows nothing about Spells, Affinity, MP, AP, Weapons or Characters; the static audit enforces
this.

## Handoff

- **WO10:** calls the primitive engines, then WO9, to build a unified response. WO9 orchestrates nothing.
- **WO11:** can render all of the following from WO9's structured data, without any UI concerns inside WO9:
  - Summary and Detailed trees;
  - before / after values, Formula steps, Requirement outcomes, Modifier phases and Resource payment;
  - validation findings and diagnostic links;
  - provenance and the exact Ruleset context.
- **WO12:** the same exact results always produce the same ExplanationDocument.

## Limitations

M4-WO9 does not implement: Formula, Requirement, Modifier, Resource or Validation evaluation; Ruleset or Canon
resolution; import review; persistent traces or explanations; Spell-, Character- or Weapon-specific explanation rules;
game-rule inference; AI prose; localization; presentation formatting; HTTP APIs; the Rules Inspector or Calculation
Lab UI. No schema change, no migration.
