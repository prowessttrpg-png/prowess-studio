# M5 — Prowess Domain Model, Shared Ability Construction & Compilation Contract (M5-WO1)

Related documents: `m5-core-playtest-system-map.md` (source map) · `m5-core-playtest-source-conflicts.md` (conflicts)
· `m5-invariants.md` / `m5-invariants.json` (M5-I001–I040) · `m5-wo1-baseline.json` (frozen M4 / schema baseline).

## 1. Purpose

M5-WO1 sets up the Prowess-specific architecture that sits **above** the completed, generic M4 Rules Engine. It does
not implement Prowess calculations. It establishes:

- the source-driven Core Playtest map;
- a pure `@prowess/game` package;
- the shared Ability Construction grammar for Spells and Maneuvers, with separate catalogs;
- exact versioned Definitions, references and bundles;
- server-side exact materialization;
- the Prowess → M4 compilation contract and its source map;
- terminology normalization;
- the M5 invariant catalog, with automated guards and negative controls.

The target pipeline:

```
Core Playtest → Structured Definitions → Exact EntityVersions → Manifest / Release → Exact RulesetContext
  → ProwessDefinitionBundle → Ability Composition → Prowess Compiler → M4 EvaluationPlan → M4 Engine → Explanation
```

## 2. Source authority

- **Primary mechanical source:** Prowess Core Playtest Packet V0.1. The designer's local copy was verified byte-identical
  (SHA-256 prefix `21fa6771…`) to the source recorded by M3-WO9 and parsed with the approved
  M3 parser `prowess-docx-structure@1.0.0`. The system map was built from that parsed structure, not from memory
  (§4, M5-I001).
- **Precedence for WO1 (§6):** (1) explicit designer clarifications in M5-WO1, (2) approved CanonDecisions, (3) Core
  Playtest V0.1, (4) older supporting sources.
- **Source fidelity (§10):** no formula was changed, no balance repaired, no prerequisite inferred, no example
  generalized and no value invented. Every disagreement is recorded in the conflicts register, usually as
  `UNRESOLVED` (M5-I002).
- The DOCX, its extraction and any temporary parse output are **not** committed.

## 3. Designer clarifications

| Clarification | Applied as |
| --- | --- |
| A. Evocation is the canonical Affinity; "Emission" is legacy | `CANONICAL_AFFINITIES` contains `EVOCATION`. Emission is a `LEGACY` term with canonical Evocation. Payloads using Emission are rejected (`LEGACY_TERM_AS_CANONICAL`). Provenance may record `{ legacyTerm: "Emission", canonicalTerm: "Evocation" }`. Sources are never rewritten. M5-SC-001 is `RESOLVED_BY_DESIGNER` |
| B. Spell and Maneuver construction are two branches of one grammar | `AbilityCompositionBase` + `SpellBranchData` / `ManeuverBranchData` |
| C. Targeting decides where and how, never what happens | the Targeting payload rejects Effect, outcome, Save and resolution keys at any depth |
| D. AoE geometry is the same in both branches | one Targeting contract; semantic shapes are shared, and the attached Effects decide the outcome |
| E. Separate Targeting / Effect / Trait catalogs per branch | distinct Definition kinds `SPELL_*` / `MANEUVER_*` implementing shared contracts |
| F. Generic term ABILITY_CONDITION | contract `ABILITY_CONDITION`; families `SPELL_CASTING_CONDITION`, `MANEUVER_CONDITION`. A target state is `STATUS_CONDITION` |

## 4. M4 / M5 boundary

- **M4 is frozen (§73).** WO1 changes no file in `@prowess/rules` and no M4 invariant, contract version, schema or
  migration. All of these are pinned by `m5-wo1-baseline.json` (M5-I030).
- **M5 consumes M4:** `@prowess/game` imports only the public `@prowess/rules` entry point (`createRulesetContext`,
  `findResolvedRule`, the context constructors and types such as `EvaluationPlan`).
- **Prowess logic never enters M4 (M5-I003).** An AST audit of every `@prowess/rules` production file rejects
  Prowess vocabulary (Affinities, Spell, Maneuver, Summon, Mana Lock, Arcana, Martial …) in identifiers, string
  literals, comparisons and imports. Negative control §214 shows this.
- **M4 Foundation Change Requests:** none. Every WO1 requirement was expressible with existing M4 contracts:
  `RulesetContext`, `EvaluationPlan`, Resource payment and reservation, orchestration.

## 5. @prowess/game

`packages/prowess-game/` (`@prowess/game`) is the dedicated pure Prowess domain layer (§68–72, M5-I004).

- **Owns:**
  - Prowess Definition contracts (envelope, reference, payload contracts).
  - The family and kind vocabulary, plus the terminology inventory.
  - Ability Construction contracts and structural validation.
  - Definition bundles.
  - The compilation contract and source map, the assembly kernel, and the (empty) table of component compilers.
- **Does not own:** any M4 primitive (Formula, Requirement, Modifier, Resource, Validation, Explanation,
  Orchestration).
- **Dependencies:** `@prowess/model`, `@prowess/rules` only. These are enforced by `scripts/check-architecture.mjs`
  (forbidden: `@prowess/db`, `@prowess/import`, `@prowess/ui`, the studio, Prisma, `pg`, Next, React, Node
  built-ins, deep imports into `@prowess/rules`) and by the M5-WO1 static audit.
- **Purity:** deterministic, plain data, immutable, JSON-safe; no database, network, clock or randomness (§72).
  - Plain-data guards duplicate M4's internal contract, because M4's helpers are not part of its public surface.
  - They reject accessors, functions, symbols, class instances, cycles, `__proto__` / `constructor` / `prototype`
    keys and non-finite numbers, without invoking caller code.
  - Inputs are detached and never frozen in place. Outputs are deep-frozen (§145–147, M5-I028).

## 6. Ability Construction

Ability Construction is the Prowess-specific modular grammar for custom abilities (§20–22). It lives in
`@prowess/game` and never in `@prowess/rules` (§21).

```
                    PROWESS ABILITY
                    CONSTRUCTION
                         │
      ┌──────────────────┼──────────────────┐
      ▼                  ▼                  ▼
  Targeting           Effects            Traits
      │                  │                  │
 shared contract      shared contract     shared contract
      │                  │                  │
 ┌────┴────┐        ┌────┴────┐        ┌────┴────┐
 ▼         ▼        ▼         ▼        ▼         ▼
Spell   Maneuver   Spell   Maneuver   Spell   Maneuver
Defs      Defs     Defs      Defs     Defs      Defs


        + Duration
        + Conditions
        + Affinity
        + Resolution
        + Branch-specific Cost
```

The composition shape (`AbilityCompositionBase`, §110):

```
Ability Composition
├── compositionKey           exact label (identity of the authored ability)
├── abilityKind              SPELL | MANEUVER — explicit, never inferred (§23)
├── affinity?                AFFINITY Definition use — either branch (§54)
├── authority?               branch-specific access data (Arcana / Affinity Authority, Martial Rank …)
├── keywords                 exact Keyword canonical keys
├── targeting                one Targeting use
├── effects[]                explicitly ordered Effect uses (unique `order`)
├── traits[]                 ordered Trait uses, each with appliesTo { scope, componentKey }
├── duration?                Duration use
├── conditions[]             ordered Ability Condition uses
└── branch                   SpellBranchData | ManeuverBranchData (kind must equal abilityKind)
```

The shape is a contract, not a frozen monolith. Branch data and every payload carry opaque `rules` / `data` objects
that later Work Orders specialise (§22). Effects and Traits are many (multi-Effect Spells and Maneuvers, §38–40,
M5-I021). Order is an explicit field, so array order never carries meaning (§41).

## 7. Spell / Maneuver relationship

```
                 Shared Ability Construction
                          │
               ┌──────────┴──────────┐
               ▼                     ▼
             SPELL                MANEUVER
               │                     │
       Spell Targeting      Maneuver Targeting
       Spell Effects        Maneuver Effects
       Spell Traits         Maneuver Traits
       Casting Conditions   Maneuver Conditions
       Spell costs          Maneuver costs
```

| | Spell | Maneuver |
| --- | --- | --- |
| Access | Arcana / Affinity Authority, Effect capacity by rank | Martial Rank (Rank Value), weapon, Skill, Affinity |
| Cost identity | MP-centered; AP derived from final listed MP | AP-centered (Foundation + Effects − Conditions); MP only when an Effect needs mana |
| Default Save success | half damage (Damage Effects) | no damage, no effect |
| Effect chains | source-defined Spell rule | not assumed (§42) |
| Branch data | effectChain, sustain, concentration | foundation, martialAccess, resolutionProfile |

The two branches never share a cost formula (§58–61). An Affinity-assisted Maneuver stays a Maneuver (§55, M5-I039).

## 8. Shared component contracts

Payload contract version 1 (`definition/payload.ts`) — **structural only**. Every component carries `keywords`,
`parameters`, `compatibility` (relation + allowed tokens, §115), `costContributions` (currency + authored data, never
an amount) and opaque `rules`.

| Contract | Specific fields | Hard rule |
| --- | --- | --- |
| `TARGETING` | `semanticShape` (classifier), `geometry` (origin, range, area, count, delivery, placement — authored) | may not contain effect / outcome / save / resolution / damage / healing / condition / movement keys at any depth (M5-I022) |
| `EFFECT` | `effectFamily` (source-defined token), `resolution` { mode: ATTACK_ROLL \| SAVING_THROW \| AUTOMATIC, data }, `outcomes[]` | resolution is the Effect's own (§57) |
| `TRAIT` | `traitFamily`, `scope` (EFFECT_SPECIFIC, ABILITY_WIDE, TARGETING, DURATION, CONDITION) | never assumed ability-wide (§45) |
| `DURATION` | `durationConcept` (INSTANT, UNTIL_NEXT_TURN, ROUNDS, COMBAT, SCENE, MISSION, SUSTAINED, MANA_LOCK, PERMANENT_BY_SPECIAL_RULE) | no costs or maintenance in WO1 |
| `ABILITY_CONDITION` | `restriction` { restrictionKey, data }, `tradeoff` | may not apply a status (M5-I040) |
| `FOUNDATION` | reserved (Maneuver) | payload contract belongs to a later WO |

Targeting semantic shapes (`TARGETING_SEMANTIC_SHAPES`, §117): SELF, TOUCH, SINGLE_TARGET, MULTI_TARGET, LINE, CONE,
RADIUS, ZONE, AURA, CHAIN, TRIGGERED, ANCHOR. A shape is a **classifier** and never identity (§118). No code branches
on a shape: the AST audit rejects comparisons and `case` labels using shape literals.

```
TARGETING            "Where/how?"     Radius · Cone · Line · Single Target · …
        +
EFFECT               "What happens?"  Damage · Movement · Control · …
        =
constructed ability behavior

Targeting alone does not create an effect.
```

```
Radius Geometry
      │
      ├───────────── Spell Radius Definition
      │                    +
      │              Spell Effects
      │                    ↓
      │              Spell outcome
      │
      └───────────── Maneuver Radius Definition
                           +
                     Maneuver Effects
                           ↓
                     Maneuver outcome
```

## 9. Separate content catalogs

`PROWESS_DEFINITION_KINDS` lists every kind with its family, branch, shared contract, allowed storage EntityTypes
and supported payload versions. `ABILITY_SLOT_KINDS` decides legality per branch:

| Slot | SPELL | MANEUVER | Shared contract |
| --- | --- | --- | --- |
| targeting | `SPELL_TARGETING` | `MANEUVER_TARGETING` | TARGETING |
| effects | `SPELL_EFFECT` | `MANEUVER_EFFECT` | EFFECT |
| traits | `SPELL_TRAIT` | `MANEUVER_TRAIT` | TRAIT |
| duration | `SPELL_DURATION` | `MANEUVER_DURATION` | DURATION |
| conditions | `SPELL_CASTING_CONDITION` | `MANEUVER_CONDITION` | ABILITY_CONDITION |
| foundation | — | `MANEUVER_FOUNDATION` | FOUNDATION |

Implementing the same shared contract **never** makes a Definition legal in the other branch (M5-I038).
`validateAbilityComposition` reports `CROSS_BRANCH_DEFINITION` (§133, §136–137). `isSameExactDefinition` compares
all five identity fields and never shape, contract or key suffix (§116). `shareTargetingSemanticShape` answers only
"same geometry meaning?" (§134).

## 10. Definition layer

"What is Radius Targeting? What is Direct Damage? What is a Verbal Condition?" A Definition is canonical, versioned
content held in an exact EntityVersion. WO1 defines the payload contracts. Real catalog content arrives in M5-WO6–WO9
through review → structured EntityVersion → Manifest (M5-I019). Game content values (costs, ranks, radii, discounts)
are Definition data, never TypeScript constants (§108, §143). The audit rejects authored Formula `expression`
strings, `effectFamily` literals and arithmetic in `@prowess/game` code.

## 11. Composition layer

"This character's Spell uses Radius + Direct Damage + Fire Conversion + Timed Duration." A Composition references
exact Definitions through `ProwessDefinitionRef`. It adds authored `parameters` per use and never alters the
Definition (§138, M5-I015).

## 12. Runtime layer

Actor, targets, current HP / MP / ME / AP, positions, statuses, reserved capacity and round state. Runtime is supplied
to M4 as the M4 Actor / Build / Runtime contexts (validated by M4's own constructors in the compilation request). A
Composition contains none of it, and runtime spending never mutates a saved Composition (§139, M5-I016).

## 13. Presentation layer

Spell Cards, Maneuver Cards, Character Sheet, Rules Inspector and future builders render exact structured or computed
results. They never own or duplicate mechanics (§66–67, M5-I017). WO1 adds no UI. The audit confirms that no Studio
code imports `@prowess/game`.

```
DEFINITION
Maneuver Radius v2

       ↓ configured in

COMPOSITION
"Groundbreaker"

       ↓ instantiated in

RUNTIME
actor / targets / AP / MP / battlefield

       ↓ shown in

PRESENTATION
Maneuver Card / Inspector
```

## 14. Definition envelope

```ts
ProwessDefinitionEnvelope<P> {
  schemaVersion       // payload contract version — not EntityVersion, not Release, not compiler contract
  systemFamily        // CORE | CHARACTER | ANCESTRY | SKILL | RESOURCE | ACTION_ECONOMY | AFFINITY | ABILITY | SPELL |
                      // MANEUVER | MAGE_ART | EQUIPMENT | SUMMON | CONDITION | MISSION
  definitionKind      // must belong to systemFamily
  entityId; entityVersionId; canonicalKey   // exact identity — mandatory (M5-I005)
  payload             // validated against the kind's contract at schemaVersion
  provenance { rulesetId, manifestId, releaseId, sourceRulesetId, sourceManifestId, legacyTerms[] }
}
```

`createProwessDefinitionEnvelope` validates and normalizes the envelope. It has no display name: display text is
never identity (§79).

## 15. Definition reference

`ProwessDefinitionRef { entityId, entityVersionId, canonicalKey, definitionKind, systemFamily }` (§78). A reference
resolves only by exact match of every field (`findBundleDefinition`). There is no name, alias, canonical-key-only or
latest fallback. The canonical key is semantic identity carried alongside the reference. The EntityVersion is the
historical rule identity, and the canonical key never replaces it (§80).

## 16. Schema version

`schemaVersion` versions the payload contract (§77, M5-I006). Each kind lists the versions it supports.

- Ability component kinds and `AFFINITY` support version 1.
- Every other kind is known but reserved (`schemaVersions: []`), so an envelope of that kind fails with
  `UNSUPPORTED_SCHEMA_VERSION` instead of being accepted with a guessed shape.
- Reserved kinds: `CORE_RESOLUTION`, `STAT`, `DERIVED_STAT`, `ANCESTRY`, `SKILL`, `SKILL_RANK`, `RESOURCE`, `ACTION`,
  `MANEUVER_FOUNDATION`, `MAGE_ART`, `WEAPON`, `ARMOR`, `EQUIPMENT_TRAIT`, `SUMMON_TYPE`, `SUMMON_TRAIT`,
  `SUMMON_ACTION_MODEL`, `STATUS_CONDITION`, `MISSION_RULE`.

The compilation contract version (§97) is separate: `PROWESS_COMPILATION_CONTRACT_VERSION = 1`.

**Storage in the existing model (§232 — no schema change).** A Prowess Definition lives in an EntityVersion's
`structuredData.prowessDefinition = { schemaVersion, systemFamily, definitionKind, payload, legacyTerms? }`.

- Exact identity is never read from that JSON. It comes from the exact pinned rule of the RulesetContext
  (`readStoredProwessDefinition`). A stored blob claiming `entityVersionId` is rejected.
- The M1 `EntityType` enum predates M5 and is a coarse storage classification. Kinds with a matching M1 type must use
  it (`SPELL_EFFECT`, `SPELL_TRAIT`, `*_TARGETING` → `TARGETING`, `RESOURCE`). All other kinds use `GENERIC_RULE`.
  DefinitionKind is the semantic identity, so `SPELL_TARGETING` and `MANEUVER_TARGETING` share an EntityType and stay
  different kinds.
- **No data-model blocker:** no migration was needed. A later Work Order may propose finer EntityTypes through an
  approved migration.

## 17. Definition bundle

`ProwessDefinitionBundle { rulesetProvenance, definitions[] }` (§84). `createProwessDefinitionBundle({ ruleset,
definitions })` validates the RulesetContext with M4's own constructor, then every envelope. It rejects:

- duplicate exact versions;
- canonical-key disagreement with the pinned rule;
- an EntityType the kind may not use;
- **unpinned or injected versions** (`NOT_PINNED`, §132);
- **provenance naming another Ruleset / Manifest / Release or another pin source** (`RULESET_MISMATCH`, §86, §131);
- unknown family / kind, unsupported schema version, malformed provenance and unsafe data (§87).

Definitions are ordered by Entity id (M5-I007–I009).

## 18. Materialization

```
Exact RulesetContext → pinned EntityVersion ids → exact structured EntityVersions → ProwessDefinitionBundle
```

Server data code lives in `packages/prowess-db/src/prowess-definition/` (§89):

- `materializeProwessDefinitionBundle(ruleset)` loads exactly the pinned ids in one query, ordered by id. Nothing is
  written.
- `materializeProwessDefinitionsFromManifest(manifestId)` and `materializeProwessDefinitionsFromRelease(releaseId)`
  first call the M4-WO2 exact resolver. Release integrity is verified there, so a tampered Release fails.

**The materializer is not a resolver** (§90). It has no latest / current / newest / active selection, no `findFirst`,
and no `orderBy` on createdAt or revisionNumber (§91). **It does not compile** (§92).

- A pinned version that cannot be loaded exactly → `PROWESS_MATERIALIZATION.PINNED_VERSION_MISSING`.
- A malformed stored Definition (including Emission as canonical, or a wrong EntityType) →
  `PROWESS_MATERIALIZATION.INVALID_STORED_DEFINITION`.
- A pinned version without a stored Definition is generic content and is not in the bundle.
- Integration tests use the real resolver (§209). They cover Manifest, Release, historical Manifest and Release,
  inheritance, isolation, tamper, read-only fingerprints, query count, and an end-to-end compile.

## 19. Compiler contract

```
ProwessCompilationRequest {
  contractVersion   // explicit; must be a supported Prowess compilation contract version
  subject           // { kind: SPELL | MANEUVER, composition } — kind must equal composition.abilityKind
  definitions       // the ProwessDefinitionBundle — RE-VALIDATED against `ruleset`, never trusted by shape
  ruleset           // exact M4 RulesetContext
  actor?, build?, runtime?   // validated by M4's constructors
}
→ ProwessCompiledPlan { contractVersion, subject, rulesetProvenance, evaluationPlan (M4), sourceMap }
```

`compileProwessAbility` is pure (§96). It never touches a database, SourceDocument, import system, Canon Manager,
HTTP, filesystem or a latest lookup.

- **Executable output is an M4 `EvaluationPlan`.** There is no second engine (§95, M5-I011).
- **WO1 compiles no mechanics.** `COMPONENT_COMPILERS` is a closed, frozen, static table with every entry `null`, so
  a valid Composition compiles to a plan with zero steps that M4 orchestration accepts. Later WOs fill entries in
  their own Work Orders (§211, §231). There is no registration API.
- **The assembly kernel (`assembleCompiledPlan`)** is what component compilers will use. It turns fragments into M4
  steps:
  1. copies authored input templates;
  2. turns fragment references into deterministic step keys;
  3. orders by explicit `order`, then stepKey (as M4 executes);
  4. requires every step to trace to this Composition's components and their exact Definitions.

```
SOURCE DEFINITION
        │
        ▼
COMPILER
builds operation/binding
        │
        ▼
M4 ENGINE
calculates result


Never:

COMPILER
calculates game result itself
```

```
Exact Prowess Definitions
        +
Ability Composition
        +
Actor / Build / Runtime
        │
        ▼
@prowess/game Compiler
        │
        ▼
M4 EvaluationPlan
        │
        ▼
M4 Orchestration
        │
        ▼
RuleEngineResponse
```

**No hidden math (§104–107, M5-I012).** The AST audit rejects the following in `@prowess/game` production code:

- every arithmetic operator, `++`, `--` and `Math.*`;
- cost-like identifiers (`finalAp`, `apCost`, `listedMp` …);
- authored Formula expressions.

A test shows a compiled FORMULA fragment returning `7 + 2 = 9` from **M4**, while the plan itself contains no `9`.

**FUTURE MAPPING** (documentation only — not WO1 mechanics, §212):

| Prowess rule | Future M4 operation |
| --- | --- |
| Affinity cost modifier | Modifier (explicit percentage phase, explicit rounding) |
| Rank prerequisite | Requirement (RANK_AT_LEAST over a caller-defined ladder) |
| Spell AP = floor(Final Listed MP ÷ PRO), minimum 1 | Formula (FLOOR rounding declared, minimum 1) |
| ME payment | Resource Payment (sources ME then MP; listed cost unchanged) |
| Mana Lock | Resource Reserve / Release Capacity |
| Keyword Strength / Weakness matching | Keyword resolution |
| Affordability | Validation (insufficiency is a result, never an auto-block) |

## 20. Source map

`ProwessCompilationSourceMap.entries[]`: one entry per compiled step, in execution order. Each entry has
`{ stepKey, order, operation, role, componentKeys, definitions }` (§99–101, M5-I014). It answers "Which Targeting
Definition caused this Requirement?" and "Which Maneuver Effect contributed this AP?". It describes Prowess → plan
provenance. M4 rule provenance and traces still describe evaluation, and both coexist.

**Deterministic identity (§102–103, M5-I013).** `compiledStepKey(abilityKind, compositionKey, fragmentKey)` =
`prowess:<kind>:<composition>:<fragment>`. It never uses `randomUUID`, a clock or object identity (control §217).
Order is always the explicit `order`.

## 21. Historical exactness

```
Release R1
  └── Spell Effect A v1

Release R2
  └── Spell Effect A v2


compile under R1 → v1

compile under R2 → v2

R2 never changes R1.
```

- Materialization reads only the versions an exact Manifest or Release pins. Re-materializing R1 after v2 content and
  Release R2 exist returns the identical original bundle (the §130 golden test, M5-I027).
- A request names its compilation contract version. Changing compilation semantics later requires a new version, so
  preserved content is never silently reinterpreted (§98, §129).

## 22. Source conflicts

`m5-core-playtest-source-conflicts.md` records 31 entries (M5-SC-001–031):

- `M5-SC-001` Evocation / Emission and `M5-SC-012` the meanings of "Condition" are **RESOLVED_BY_DESIGNER**.
- `M5-SC-004` Mana Efficiency as payment is **RESOLVED_BY_DESIGNER** (§140, carrying M4-I14).
- All others are **UNRESOLVED**, including Player Dice vs Character Die (M5-SC-002, audited and not normalized),
  HP / MP formulas, Dodge vs Evasion, Character DC, Advantage, Effect-chain defaults, Maneuver AoE save profiles,
  Trait pricing and percentage rounding.

The terminology inventory (`TERMINOLOGY_INVENTORY`) is the machine-readable twin. Each term is `CANONICAL`, `LEGACY`,
`UNRESOLVED` or `SYSTEM_SPECIFIC`, with its authority and conflict key.

```
Historical Source
"Emission"
      │
      ├── preserved verbatim in SourceDocument
      │
      ▼
Canonical structured identity
EVOCATION


New canonical content uses:

Evocation
```

## 23. Limitations

WO1 does **not** implement:

- Character, Skill or Affinity calculation;
- Affinity discounts or weaknesses;
- actual Spell or Maneuver Targeting values;
- execution of the Spell or Maneuver Effect catalogs;
- Spell or Maneuver Trait execution;
- Duration calculation;
- Casting or Maneuver Condition discounts;
- Spell MP / AP or Maneuver AP / MP;
- Effect-chain runtime;
- Sustain, Mana Lock policy or Concentration;
- Metamagic;
- weapon damage;
- Summon or Mage Art calculations;
- any Builder UI (§231).

Other limits:

- No CanonDecision rows were written for the designer clarifications (see the conflicts register's governance note).
- The structural compatibility contract is not a compatibility catalog (§115).
- Payload contracts are deliberately minimal; their opaque `rules` / `data` objects are owned by later Work Orders.
- Local verification could not run Prisma's schema engine, because the sandbox network blocked
  `binaries.prisma.sh`. Migrations were applied with `psql`, and the CI drift check is the authority on drift.

## 24. Future M5 dependencies

Recommended from the source audit (details and blocking rulings in the system map):

| WO | Scope |
| --- | --- |
| M5-WO2 | Core Resolution, Stats, Dice & Rank Primitives — needs rulings on M5-SC-002 / 003 / 005 / 008 / 009 / 010 first |
| M5-WO3 | Shared Resources & Action Economy |
| M5-WO4 | Affinity Structured Rules |
| M5-WO5 | Shared Modular Ability Construction Framework (capacities, access, Signature slots) |
| M5-WO6 | Targeting Framework + Spell / Maneuver catalogs |
| M5-WO7 | Effect Framework + Spell / Maneuver Definition contracts |
| M5-WO8 | Trait Framework + Spell / Maneuver Definition contracts |
| M5-WO9 | Duration & Ability Conditions |
| M5-WO10 | Spell Cost / MP / AP Compilation |
| M5-WO11 | Maneuver Cost / AP / MP Compilation (needs the weapon-AP ruling M5-SC-026) |
| M5-WO12 | Resolution / Ordered Effects / Effect Chains |
| M5-WO13 | Sustain / Mana Lock / Concentration |
| M5-WO14+ | Summoning, Mage Arts, Equipment integration, content authoring, Builders |
