# M4 Requirement Engine (M4-WO5)

**Status:** M4-WO5 — Requirement Engine. Invariants M4-I51 – M4-I64 are catalogued, with their automated guards, in
`m4-rules-engine-core.md`.

## Purpose

A Requirement answers one question: **"Given explicit facts, is this prerequisite satisfied?"**

Requirements are data: a tree of known predicate kinds combined by ALL / ANY / NONE. They are never prose, never
expression strings and never callbacks. The engine reads facts exactly as supplied. It computes no stat, level, rank,
ownership or resource, and it knows no game vocabulary.

Code: `packages/prowess-rules/src/requirement/` (`model.ts`, `validate.ts`, `facts.ts`, `evaluate.ts`). It is pure,
inside `@prowess/rules`, which still depends only on `@prowess/model`. There is no database access, persistence,
route, UI or new dependency.

```
Explicit Requirement Definition
             │
             ▼
       Requirement Tree
             │
             ├───────────────┐
             ▼               ▼
     Requirement Facts   KeywordSet (M4-WO4)
             │               │
             └───────┬───────┘
                     ▼
            Requirement Engine
                     │
                     ▼
       SATISFIED / UNSATISFIED + outcome + trace
```

## Satisfied vs unsatisfied vs invalid

These are three different states, and the engine never conflates them:

| State | Response |
| --- | --- |
| satisfied | `SUCCESS`, `data.satisfied: true` |
| evaluated, **not** satisfied | `SUCCESS`, `data.satisfied: false`, with no error, warning or info |
| cannot be evaluated | `INVALID`, `REQUIREMENT.*` diagnostics, `data: null` |

```
CASE A

Requirement:
Level >= 5

Facts:
Level = 3

Result:
VALID EVALUATION
SATISFIED = false


CASE B

Requirement:
Level >= 5

Facts:
Level missing

Result:
INVALID EVALUATION
MISSING_FACT
```

An unmet prerequisite is data. There is deliberately no `NOT_MET` code, and no warning or info message is invented for
it. `RULE_ENGINE.*` stays reserved for genuine engine failures.

## Requirement primitives

| Kind | Fields | Satisfied when |
| --- | --- | --- |
| `NUMERIC_COMPARE` | `factKey`, `operator` (`==` `!=` `<` `<=` `>` `>=`), `expected` (finite) | the numeric fact compares true |
| `RANK_AT_LEAST` | `factKey`, `requiredRankKey` (label), `requiredOrder` (integer) | rank fact `order >= requiredOrder` |
| `KEYWORD_PRESENT` | exactly one of `keywordId` / `canonicalKey` | the exact Keyword is in the supplied KeywordSet |
| `SET_CONTAINS` | `factKey`, `member` | `member` is in the set fact |
| `ENTITY_OWNED` | `entityId` | the id is in the supplied owned-Entity collection |

Every node may carry an optional `provenance` (the M4-WO1 `RuleProvenance`).

`CUSTOM`, and any other unknown kind, is a controlled `REQUIREMENT.UNSUPPORTED_PREDICATE`. Nothing is executed:
there are no callback predicates, and a function or accessor anywhere in a node is rejected without being invoked.

### Numeric comparison

Comparison is standard, on finite numbers: `5 >= 5` is true, `4 >= 5` is false. There is no epsilon (`0.1 + 0.2 == 0.3`
is false) and no rounding: fractional, negative and zero values compare exactly, and `-0` equals `0`. If content needs
rounding, it happens explicitly before evaluation, typically through the M4-WO3 Formula Engine.

### Rank: order is data

```
Requirement:
Rank >= Expert
        │
        ▼
Requirement Facts:
Actual Rank = Master
        │
        ▼
Requirement Engine
        │
        ▼
Master(order 3) >= Expert(order 2)
        │
        ▼
SATISFIED = true
```

The engine contains **no rank ladder**. Content supplies an integer order with every rank fact and every rank
requirement, and only those orders decide. Rank keys are exact labels carried as metadata and never compared:
`expert`, `Expert` and `EXPERT` are different labels and are never normalized. Any scale works, including bronze /
gold or negative orders. Rank orders must be finite integers.

### Keyword presence

Presence is M4-WO4's exact membership, through `hasKeywordById` / `hasKeywordByCanonicalKey`. There is no second
matching algorithm. Keyword id is the stronger identity. A canonical-key requirement must be a valid M1 canonical key
and is never case-folded. "KeywordPresent(Fire)" means only "is the exact Fire Keyword present?". It never deals
damage, applies anything or grants anything (M4-I44 stands).

A supplied KeywordSet is accepted only if WO4 would produce exactly it. The engine rebuilds it through WO4's own
aggregation and compares the result, because WO4's lookup depends on the set's ordering. A hand-built, reordered or
inconsistent set is `INVALID_FACTS`.

### Set membership and Entity ownership

Members and Entity ids are exact: no fuzzy matching, alias, case folding or substring matching. Duplicate members
collapse, and member order is irrelevant. Ownership uses exact Entity ids, never a canonical key or a name, and
nothing is queried: "does this character own X?" is answered only from the supplied collection.

## ALL / ANY / NONE

| Group | Satisfied when |
| --- | --- |
| `ALL` | every child is satisfied |
| `ANY` | at least one child is satisfied |
| `NONE` | no child is satisfied |

Groups nest to any depth within the limits. **Empty groups are rejected** as authoring mistakes and are never treated
as vacuously true. Children keep their **authored order**, which is never sorted. That order drives the outcome, the
trace and the diagnostics.

```
ALL
├── Level >= 5                 ✓
├── Keyword "Fire" present     ✓
└── ANY
    ├── Entity A owned         ✗
    └── Entity B owned         ✓

ANY = true
ALL = true
```

**Every child is evaluated.** A group first evaluates its whole child list, then counts the satisfied results.
Nothing short-circuits, so a valid `true` child of ANY, or a `false` child of ALL, can never hide an invalid sibling.
Any child that cannot be evaluated makes the whole evaluation INVALID, never silently false. A child that is simply
false takes part normally. The static audit pins this: the evaluator may not use `some` / `every` / `find`, `break` /
`continue` or `&&` / `||` around evaluation.

## RequirementFacts

`createRequirementFacts(input)` validates and normalizes; `evaluateRequirement` does the same internally.

```
RequirementFacts {
  numeric:        { key, value, provenance? }[]
  ranks:          { key, rankKey, order, provenance? }[]
  sets:           { key, members[], provenance? }[]
  ownedEntityIds: EntityId[] | null      (null = not supplied)
  keywords:       ResolvedKeywordSet | null
}
```

- **Fact keys** use the M4-WO3 Formula identifier grammar: exact, case-sensitive, dotted, locale-free, and never
  `__proto__`, `constructor` or `prototype`. A Formula result can therefore be supplied as a numeric fact under its
  own variable key. Fact keys such as `actor.level` or `stat.STR` are content's choice; the engine hard-codes none.
- **No coercion.** `"5"`, `true`, `null`, `NaN` and `±Infinity` are invalid facts.
- **Duplicates.** The same key with identical content collapses. The same key with different content (value, rank,
  members or provenance) is `FACT_CONFLICT`. There is never "last one wins": `actor.level = 4` together with
  `actor.level = 7` is invalid in either order.
- **One key belongs to one fact kind.** A predicate reading a key held as another kind gets `TYPE_MISMATCH`.
- **Order-independent.** Collections are normalized into code-unit key order, and conflicts are reported in key order.
- Facts are shape-checked at fixed depth (own data properties only, getters never invoked). A deeply nested junk
  object cannot overflow the stack. Normalized facts are valid input again (idempotent), detached and deep-frozen.

### Missing context (fails closed)

| Situation | Result |
| --- | --- |
| numeric / rank / set fact for the key not supplied | INVALID `MISSING_FACT` |
| `ownedEntityIds` not supplied | INVALID `MISSING_FACT` |
| `ownedEntityIds` supplied, Entity absent | valid **false** |
| KeywordSet not supplied | INVALID `MISSING_FACT` |
| KeywordSet supplied, Keyword absent | valid **false** |
| set fact supplied, member absent | valid **false** |

## Outcome, trace and provenance

```
RequirementEvaluation { satisfied, outcome }
leaf  { nodePath, kind, satisfied, expected, actual, provenance, factProvenance }
group { nodePath, kind, satisfied, children[], provenance }
```

`nodePath` is the authored position: `root`, `root.0`, `root.1.0`. Leaves record actual against expected as data:

- numeric: `{operator, value}` vs `{value}`
- rank: `{rankKey, order}` vs `{rankKey, order}`
- Keyword / set: expected identity vs `{present}`
- ownership: `{entityId}` vs `{owned}`

The outcome is proportional to the tree and never copies the facts.

The trace mirrors the tree in authored order. Step keys are `requirement`, `child.0`, `child.1`, …; operations are
`requirement.all`, `requirement.numeric_compare`, and so on; leaf inputs record fact key, actual and expected values;
each step outputs a BOOLEAN. A false Requirement has an ordinary trace. An invalid evaluation keeps the trace of what
was inspected, with a null output at each node that could not be evaluated.

Provenance is kept where supplied, and its two sources stay distinct. A node's own `provenance` says where the
**Requirement** came from: it is on the outcome and on that node's trace step. `factProvenance` says where the **fact**
it read came from. Nothing is duplicated onto unrelated nodes. No prose explanation is generated; that is M4-WO9.

## Diagnostics

| Code | Meaning |
| --- | --- |
| `REQUIREMENT.INVALID_DEFINITION` | malformed node: unknown field, bad key, non-finite threshold, empty group, cycle, non-plain data |
| `REQUIREMENT.UNSUPPORTED_PREDICATE` | an unknown kind, including CUSTOM |
| `REQUIREMENT.LIMIT_EXCEEDED` | node, depth or children-per-group limit |
| `REQUIREMENT.INVALID_FACTS` | malformed facts, or a KeywordSet WO4 would not produce |
| `REQUIREMENT.FACT_CONFLICT` | one key with conflicting content, or as two fact kinds |
| `REQUIREMENT.MISSING_FACT` | a needed fact, ownership collection or KeywordSet is absent |
| `REQUIREMENT.TYPE_MISMATCH` | the key exists as another fact kind |

Each diagnostic is a VALIDATION message (category REQUIREMENT, severity ERROR) with a JSON-Pointer path and the
node path. Ordering is deterministic: definition problems first (authored pre-order), then fact problems (input order,
with conflicts in key order), then nodes that could not be evaluated (authored order).

## Complexity limits

Trees are limited to **2,048 nodes**, **depth 64** and **512 children per group**. Validation walks the tree
iteratively with an explicit stack and ancestor tracking before anything recursive runs. A 100,000-deep tree fails
cleanly with `LIMIT_EXCEEDED`, and a cyclic object graph is rejected. A shared, non-cyclic child is fine. Fact lookup
uses internal indexes built once per evaluation; no Map or Set ever appears in public data.

## PAS-02 RequirementDefinition categories → WO5 primitives

The approved PAS-02 categories remain the conceptual vocabulary. Each is represented by a generic primitive. The
mapping lives here as documentation; the engine contains no game branching.

| PAS-02 category | WO5 primitive |
| --- | --- |
| `SKILL_RANK` | `RANK_AT_LEAST` |
| `AFFINITY_RANK` | `RANK_AT_LEAST` |
| `ARCANE_RANK` | `RANK_AT_LEAST` |
| `MARTIAL_RANK` | `RANK_AT_LEAST` |
| `STAT_SCORE` | `NUMERIC_COMPARE` |
| `LEVEL` | `NUMERIC_COMPARE` |
| `RESOURCE_MINIMUM` | `NUMERIC_COMPARE` |
| `KEYWORD_PRESENT` | `KEYWORD_PRESENT` |
| `TARGETING_PRESENT` | `SET_CONTAINS` |
| `DURATION_PRESENT` | `SET_CONTAINS` |
| `EFFECT_PRESENT` | `SET_CONTAINS` |
| `TRAIT_PRESENT` | `SET_CONTAINS` |
| `WEAPON_PROPERTY` | `SET_CONTAINS` |
| `WEAPON_CATEGORY` | `SET_CONTAINS` |
| `DAMAGE_TYPE` | `SET_CONTAINS` |
| `ENTITY_OWNED` | `ENTITY_OWNED` |
| `CUSTOM` | not executable in WO5 (`UNSUPPORTED_PREDICATE`) |

Future flow:

```
Persistent RequirementDefinition
          │
          ▼
materialization / compiler layer
          │
          ▼
WO5 Requirement primitives
          │
          ▼
Requirement Engine
```

These compositions are expressible today, as data only:

- a Spell Trait requiring "Affinity rank ≥ Expert AND Keyword Damage";
- a Maneuver Effect requiring "Martial rank ≥ Expert AND Weapon property Reach";
- a Character option requiring "ALL(Level ≥ 5, Skill rank ≥ Expert, Entity X owned)".

WO5 knows nothing about Spell Traits, Affinity, Maneuvers or Characters.

## Boundaries and handoff

```
Formula Engine ───────► Numeric Facts ─┐
                                      │
Keyword Resolver ─────► KeywordSet ────┤
                                      │
Actor / Build Data ───► Rank/Set Facts ┤
                                      │
                                      ▼
                              Requirement Engine
                                      │
                                      ▼
                                true / false
                                      │
                 ┌────────────────────┼────────────────────┐
                 ▼                    ▼                    ▼
           Modifier Engine      Validation Engine     Explanation
```

- **M1 / M3:** extracted Requirement candidates ("Requires Expert Emission") are source evidence and are never read or
  interpreted. Materialization will turn approved material into explicit primitives.
- **M2 / WO2:** a supplied RulesetContext is recorded as response provenance and never searched for "the current
  Requirement". The caller supplies the exact Requirement.
- **WO3:** no Formula runs inside a Requirement. A Formula result reaches a Requirement as an explicit numeric fact.
  The only shared code is the identifier grammar.
- **WO4:** Requirements read Keyword membership and never add or remove Keywords.
- **WO6:** a Modifier may use a Requirement tree as its condition. WO5 answers true / false; WO6 decides what the
  Modifier does.
- **WO7:** resource facts (`current_mp`, `current_ap`, …) are compared as numbers and never spent, reserved, locked or
  restored.
- **WO8:** composes Requirement outcomes into wider validation. WO5 implements no Spell, build or equipment validity.
- **WO9:** turns the structured outcomes and provenance into explanations.

## Read-only, deterministic, immutable

Evaluation never changes the Requirement, the facts, the KeywordSet, any context or the RulesetContext. The same
inputs give a byte-identical result, outcome, diagnostics and trace. Outputs are deep-frozen, detached and
JSON-serializable: changing caller objects afterwards cannot change a returned result. Nothing reads a clock,
randomness, the network or persistence. There is no engine class and no cache.

## Limitations

M4-WO5 does not implement: persistent RequirementDefinitions; Requirement authoring UI; natural-language parsing or
Requirement extraction; Formula execution inside Requirements; hard-coded Prowess ranks; Skill, Affinity, Weapon or
Spell mechanics; Spell prerequisites as special cases; Modifier effects; Resource spending; cross-system validation;
the explanation engine; HTTP APIs; Studio UI. No schema change, no migration.
