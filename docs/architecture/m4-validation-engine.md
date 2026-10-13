# M4 Validation Engine (M4-WO8)

**Status:** M4-WO8 — Validation Engine. Invariants M4-I99 – M4-I115 are catalogued, with their automated guards, in
`m4-rules-engine-core.md`.

## Purpose

The Validation Engine answers: **"Given explicit checks and the diagnostics of exact rule evaluations, what is the
combined validation state?"**

**Validation consumes results. It never recalculates them.** It contains no Formula, Requirement, Modifier, Resource,
Keyword, Ruleset, Canon or import logic. If a subsystem owns a rule, validation reuses that subsystem's result or
diagnostic and never repeats the algorithm.

Code: `packages/prowess-rules/src/validation-engine/` (`model.ts`, `source.ts`, `evaluate.ts`). It is pure, inside
`@prowess/rules`, which still depends only on `@prowess/model`. There is no database access, persistence, route, UI
or new dependency.

```
Formula ────────┐
Requirement ────┤
Modifier ───────┤
Resource ───────┤
Compatibility ──┤
Parameters ─────┤
                ▼
        VALIDATION ENGINE
                │
       ┌────────┼────────┐
       ▼        ▼        ▼
     Errors   Warnings   Info
```

```
Formula Result ───────────┐
Requirement Result ───────┤
Modifier Result ──────────┤
Resource Result ──────────┤
                         ▼
                   Validation Engine
                         │
                         ▼
                   Diagnostics Only

NO arrows return from Validation into Formula, Requirement, Modifier or Resource.
```

## API and the M4-WO1 contract

```ts
evaluateValidation({ sources?, checks? }, { ruleset? }): RuleEngineResponse<ValidationSummary>
```

There is no competing envelope, status system, severity scale or category list. WO8 reuses all of the following from
M4-WO1, unchanged:

- `RuleEngineResponse`, `ValidationMessage`, `CalculationTrace`, `RuleProvenance` and `RulesetProvenance`;
- the status derivation;
- the ordinal conventions;
- the severities ERROR / WARNING / INFO.

**Categories.** WO1's `VALIDATION_CATEGORIES` is exactly the approved nine: `STRUCTURE`, `COMPATIBILITY`,
`REQUIREMENT`, `PARAMETER`, `CAPACITY`, `RESOURCE`, `FORMULA`, `RULESET`, `RUNTIME`. They are reused directly, with no
mapping layer. Categories **classify** findings. They carry no mechanics, never choose a severity and never choose an
order.

| Outcome of the combination | WO1 status | `data` |
| --- | --- | --- |
| no findings, or info only | `SUCCESS` | `ValidationSummary` |
| warnings, no errors | `VALID_WITH_WARNINGS` | `ValidationSummary` |
| any validation ERROR | `INVALID` | `null` (WO1 rule) |
| a source carried ENGINE errors | `ERROR` | `null` |

**Engine errors vs validation errors.** A failed check or a malformed input is a validation finding, which makes the
response INVALID. When a supplied source response is itself an engine failure (it carries `RULE_ENGINE.*` errors), the
combination becomes an engine failure (ERROR). It carries the source's own engine-error code and lists every source
engine error, with its `sourceKey`, in the details. Engine errors are never converted into validation findings; WO1's
message constructor forbids that anyway.

## Explicit checks

```
ValidationCheck {
  checkKey, order, category, outcome (PASS | FAIL | NOT_APPLICABLE),
  failureSeverity (ERROR | WARNING | INFO), code, path?, message?, provenance?, details?
}
```

The caller determines the outcome; a check is data, never a callback, script or expression.

- **PASS** emits nothing.
- **NOT_APPLICABLE** emits nothing and is never a warning.
- **FAIL** emits exactly the declared finding, with the declared `failureSeverity`, `category`, `code`, `path`,
  `provenance` and `details`.

Codes are caller-owned (`BUILD.MISSING_PARAMETER`, `ACTION.CANNOT_PAY`, …) and follow the WO1 code syntax:
upper-case segments joined by dots. Two namespaces are reserved: `RULE_ENGINE.*` for the engine and `VALIDATION.*` for
WO8's own input failures.

Paths are WO1 JSON Pointers: `/spell/effects/2`, not `spell.effects[2]`. They are opaque and never interpreted.
Details are plain JSON, copied so the caller's later changes cannot reach the result.

## Sources

```
ValidationSource { sourceKey, order, response }
```

A source is one **exact, already-computed** `RuleEngineResponse`. WO8 never re-runs it, never replaces it with a
"newer" result, and never rewrites it. Before use, `response` is checked to be a genuine WO1 response:

- plain data, with a guard so pathological nesting cannot crash the engine;
- exactly the WO1 fields and contract version;
- a valid status, `success` consistent with it, and `data: null` when unsuccessful;
- every message re-validated by WO1's own `validationMessage`, and every engine error well-formed;
- messages in the right arrays, with unique non-negative ordinals;
- a status that matches its messages.

Anything else is a controlled `VALIDATION.INVALID_SOURCE`, never a crash.

A source's **diagnostics are preserved exactly**: code, severity, category, message, path, provenance and details are
unchanged. Only the final ordinal is new, because several responses are being combined. The original ordinal is kept
in the trace. The source objects themselves are never modified.

A source's **business data is ignored**. WO8 never reads a Requirement outcome, a Modifier result, a Resource snapshot
or a Formula value; the static audit pins that the only `.data` access is WO1's null check. Therefore:

```
WO5 Requirement

Rank >= Expert
Actual = Trained
        │
        ▼
satisfied = false
valid evaluation
        │
        ▼
NOT automatically a Validation error

Caller explicitly declares:
"This prerequisite is mandatory"
        │
        ▼
ValidationCheck FAIL / ERROR
        │
        ▼
Validation INVALID
```

```
WO7 Payment

Cost = 10
Available = 8
canPay = false
shortfall = 2
        │
        ▼
Valid Resource result
        │
        ▼
NOT automatically invalid

Runtime orchestration may explicitly create:

RUNTIME / ERROR
"Action cannot currently be paid"

        │
        ▼
WO8 combines it
```

Likewise:
- a WO6 `SKIPPED_CONDITION` is normal modifier behaviour and creates no finding;
- a WO3 Formula diagnostic (a parse failure, a division by zero) is a real validation diagnostic and passes through
  unchanged;
- a WO2 Ruleset-resolution failure, which the resolver raises as a DomainError, enters as an explicit `RULESET` check
  carrying the resolver's own code.

Validation never changes a listed cost (M4-I14): a payment's `listedAmount` is never even read.

## Ordering

Sources and checks are ordered **together** by `order` ascending, then key in UTF-16 code-unit order. On a full tie, a
source comes before a check. Input array order never matters. Findings are emitted in that contribution order: a
source's own messages in their original ordinal order, then a failed check's finding. WO1 assigns the final ordinals
`0, 1, 2, …` in that emission order, so they are globally unique across `errors`, `warnings` and `info`, and each array
is itself in ordinal order. Nothing is sorted alphabetically by code.

```
Source order 10
 ├─ Finding 0
 └─ Finding 1

Check order 20
 └─ Warning

Source order 30
 └─ Info

Final message ordinals:
0, 1, 2, 3

Stable independent of input array order.
```

WO8's own input diagnostics (`VALIDATION.*`) come first, in input order. Conflicting duplicate keys are reported in
sorted key order.

## Full collection, identity, duplicates

- **No short-circuit.** An ERROR never hides later warnings or errors: every check and every well-formed source is
  inspected. A malformed source is reported, and a valid source beside it still contributes its findings.
- **Identity is exact.** An identical duplicate `checkKey` or `sourceKey` collapses. Conflicting duplicates fail closed
  with `DUPLICATE_CHECK` / `DUPLICATE_SOURCE`, and the later row is never chosen.
- **Findings are never collapsed** just because they share a code, path and severity. Each finding keeps its
  contribution identity, so three contributions reporting `BUILD.NEAR_LIMIT` at `/build` give three findings.
- No source is preferred for being newer, current, higher-versioned, more authoritative or Canon.

## Summary, provenance, trace

When the response is successful, `data` is a concise `ValidationSummary`:

- `valid`;
- error, warning and info counts;
- `checkCounts` (PASS / FAIL / NOT_APPLICABLE);
- `categoryCounts`, derived from the emitted findings;
- per-check results `{checkKey, order, outcome, category, severity}`;
- per-source results `{sourceKey, order, status, error / warning / info counts}`.

Findings themselves are not duplicated in `data`: they live in WO1's message arrays. When INVALID, `data` is null per
WO1, but counts remain derivable from the arrays and attribution from the trace.

Provenance is kept exactly: a check's own provenance on its finding, and each source diagnostic's own provenance.
Authority is never interpreted.

The trace mirrors contribution processing:

```
validation
├── source formula-A          (source key, order, source status)
│   └── finding               (final ordinal, original ordinal, code, severity, category)
├── check targeting-compatible (key, order, FAIL, category, severity, code, path, final ordinal)
└── check parameter-size       (key, order, PASS, category)
```

The trace is the attribution map: it tells WO9 which contribution produced each final ordinal, even when the response
is INVALID. Nested subsystem traces are not copied, which avoids duplicating them; the caller keeps the source
responses.

## Diagnostics

| Code | Meaning |
| --- | --- |
| `VALIDATION.INVALID_REQUEST` | the request is not a plain `{ sources?, checks? }` with arrays |
| `VALIDATION.INVALID_CHECK` | malformed check (key, order, category, outcome, severity, message, provenance, details; extra fields such as callbacks) |
| `VALIDATION.DUPLICATE_CHECK` | conflicting checks share a checkKey |
| `VALIDATION.INVALID_SOURCE` | malformed source or not a genuine WO1 response |
| `VALIDATION.DUPLICATE_SOURCE` | conflicting sources share a sourceKey |
| `VALIDATION.INVALID_CODE` | a check code outside the WO1 syntax or inside a reserved namespace |
| `VALIDATION.INVALID_PATH` | a check path that is not a JSON Pointer |
| `VALIDATION.LIMIT_EXCEEDED` | over 4,096 sources, 10,000 checks or 20,000 findings |

The limits fail closed: findings are never silently dropped or truncated.

## Determinism and immutability

The same request, in any source or check order, gives a byte-identical response: messages, check results, source
results and trace. Nothing reads a clock, randomness, the network or persistence. Later Entity versions, Rulesets,
Canon decisions or import activity cannot change a repeated evaluation, because only the exact supplied input is used
and nothing is looked up. Inputs are never mutated or frozen. Outputs are deep-frozen, detached and JSON-serializable.
Getters are never invoked, and prototype-shaped and cyclic input is rejected. There is no engine class, no validator
registry and no cache.

## Future compositions (illustrative, not implemented)

```
Spell Build
   │
   ├── Formula source
   ├── Requirement source
   ├── Modifier source
   ├── Resource source
   ├── Targeting compatibility check
   └── Effect parameter check
            │
            ▼
      Validation Engine
            │
            ▼
Errors / Warnings / Info
```

- **Character build:** prerequisites, capacity limits, resource state and equipment compatibility, each fed in as
  explicit checks.
- **Runtime action:** orchestration turns "Requirement satisfied?", "Resource affordable?" and "Target valid?" into
  explicit RUNTIME checks, and WO8 combines them.

WO8 knows nothing about Spells, Characters, Weapons, Maneuvers or Summons. It never auto-corrects (no auto-selected
target, removed Trait, lowered cost, clamped parameter or promoted rank) and never judges balance. Source authority and
import confidence never set severity.

## Handoff

- **WO9 Explanation:** has everything it needs to explain a finding: which check or source produced it, its category,
  code, path, severity and provenance, and its related contribution (via the trace). WO8 writes no explanatory prose.
- **WO10:** may expose unified evaluation and validation through HTTP. WO8 has no routes.
- **WO11 Rules Inspector:** gets stable structured data — errors, warnings, info, paths, provenance, source
  contributions and trace.

## Limitations

M4-WO8 does not implement: persistent ValidationRules; validation authoring UI; Spell, Character, Weapon, Maneuver or
Summon validation rules; Formula evaluation; Requirement evaluation; Modifier application; Resource payment; Keyword
matching; Ruleset resolution; Canon authority; import review; automatic corrections; balancing judgements; full
explanation prose; a Requirement-to-check adapter (deferred — orchestration supplies explicit checks); HTTP APIs;
Studio UI. No schema change, no migration.
