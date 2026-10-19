# M5 — Affinity Identity, Rank, Authority, Keyword Alignment & Cost Modifier Foundation (M5-WO4)

M5-WO4 makes Affinity executable structured content. Affinity identity, ownership, Rank, standard advancement, Strength
and Weakness Keyword alignment, the reusable Spell MP Affinity modifier fragment, Affinity Authority and Affinity access
prerequisites all compile into existing M4 operations. `@prowess/game` assembles conditions, Keyword references,
modifier definitions, bindings and ordering; M4 performs every percentage, every max selection and every comparison.
Nothing is persisted, and nothing in the compiler branches on an Affinity name.

- Content: `packages/prowess-game/src/content/core-playtest-v0.1/affinity.json` — six `AFFINITY` (payload v2), one
  `AFFINITY_RANK_RULE`, one `AFFINITY_WEAKNESS_SEVERITY`, one `AFFINITY_PROGRESSION` Definition, plus the exact Keyword
  canonical keys the rules match (for the M1 Keyword catalog).
- Code: `packages/prowess-game/src/affinity/` (`compile.ts`, `definitions.ts`, `profile.ts`, `results.ts`),
  `definition/affinity-payload.ts`, `vocabulary/affinity.ts`.
- Invariants: M5-I111–M5-I150 (`m5-invariants.md`). M5-I075 is SUPERSEDED by M5-I111.
- Permanent gate: **M5-WO4 audit — Affinity identity, rank, authority & keyword alignment** (`docs/architecture/ci.md`).

## 1. Scope

In scope: canonical Affinity identity; ownership (Primary / Secondary); Affinity Rank (NONE / TRAINED / EXPERT /
MASTER) and its versioned meaning; standard advancement validation; exact Strength and Weakness Keyword rules; exact
Weakness percentages and the severity reference scale; component Keyword contributions with provenance; alignment
classification; the Spell MP Affinity fragment (Strength discount → highest Weakness penalty on the listed MP);
Affinity Authority rank floor, Effect capacity, base Trait capacity and specialization; reusable Affinity access
Requirements; the post-WO3 Movement / Sprint amendment.

Out of scope: the full Spell cost pipeline (constructed component cost, Casting Conditions, final rounding, Spell AP),
the Maneuver cost pipeline, Summon cost, Arcana Rank and Arcane Authority capacity, Trait exchange, the Spell Effect /
Targeting / Trait catalogs, any authoring UI and any persistence.

## 2. Source Authority

Precedence is unchanged: (1) explicit designer rulings — here the M5-WO4 work order §5–§75; (2) approved
CanonDecisions; (3) Core Playtest Packet V0.1; (4) older material. Locators were re-read from the verified Core Playtest
bytes (SHA-256 prefix `21fa6771`, `prowess-docx-structure@1.0.0`, 2,487 sections):

- s118–s120 STEP 5 — CHOOSE AN AFFINITY (Level 1 Primary, Trained at Level 3)
- s161 Affinity Advancement (Levels 1 / 3 / 6 / 9)
- s624 Effect Capacity, s626 Trait Capacity, s627 Trait access through Affinity Rank (not free)
- s678–s687 AFFINITY, ARCANE AUTHORITY AND AFFINITY AUTHORITY, AFFINITY COST MODIFIERS, QUICK REFERENCE
- s716–s733 the per-Affinity chapters (Strengths, Weaknesses, exact penalties)

The quick reference (s687) and the chapters (s716–s733) list Strengths at slightly different granularity (for example
Enhancement's chapter groups "Resistances / Persistent Reinforcement"; Manipulation's groups "AoE Manipulation / Mind
Effects"). The work order's explicit tables (§70–§75) are designer content at precedence 1 and are what is structured;
the source text is unchanged.

## 3. Designer Clarifications

- Affinity is a shared Ability Construction concept for SPELL and MANEUVER; it never turns a Maneuver into a Spell (§5).
- Shared semantics: identity, ownership, Rank, Strength / Weakness Keywords, alignment, access, prerequisites (§6).
- Spell MP Affinity economics are reusable fragments; the full Spell cost pipeline is later (§7).
- Maneuver Affinity cost application is the later Maneuver cost Work Order — never inferred from Spell MP (§8).
- Summoning reuses the same Affinity Definitions later (§9).
- Affinity-relevant Keywords may come from Targeting, Effects, Traits and other components — explicitly (§61–§66).

## 4. Movement/Sprint Carry-Forward Amendment

After WO3 the designer clarified Movement terminology. This is a post-WO3 canon amendment applied in WO4; the WO3
completion report and WO3 records are not rewritten (an amendment note was added to the WO3 architecture document).

| Concept | WO3 (historical) | WO4 canonical |
| --- | --- | --- |
| Base Movement | `5 * agi` (5 ft × AGI) | authored creature value `5` (ft) |
| Movement | `final_movement` = `base_movement + bonuses` | `movement` = `base_movement * agi + bonuses` |
| Sprint | `final_movement * 4` (M5-SC-034 UNRESOLVED) | `movement * 4` (M5-SC-034 RESOLVED_BY_DESIGNER) |
| Size | `movementAdjustment: null` | `baseMovement: null` (M5-SC-033 UNRESOLVED) |

Golden: Base Movement 5 ft, AGI 4 → Movement 20 ft → Sprint 80 ft. Each Sprint execution independently grants Movement
× 4; two Sprints are 80 + 80, never 20 × 4 × 4. No TOTAL_MOVEMENT / FINAL_MOVEMENT statistic exists ("Final Movement"
and "Total Movement" are LEGACY terms → Movement). Occupied space never implies Base Movement (Large 10 × 10 ft ≠ 10 ft
Base Movement). M5-I075 → SUPERSEDED by M5-I111; M5-I112 and M5-I113 are new.

**Post-WO4 canon rulings (M5-SC-033).** The designer later ruled that Base Movement depends on Creature Size: Small 5 ft,
Medium 5 ft, Large 10 ft, Huge 15 ft (each × AGI); Massive is TBD (new M5-SC-036, `baseMovement: null`, fails closed with
`PROWESS_CORE.SIZE_BASE_MOVEMENT_PENDING_CANON`). `core.derived.base_movement` now reads the character's exact
CREATURE_SIZE Definition (`size_base_movement`, source `CREATURE_SIZE_BASE_MOVEMENT`); a character with no Size named is
MEDIUM, so the golden above (5 ft, AGI 4 → 20 ft → Sprint 80 ft) is unchanged. A Large character with AGI 4 has Movement
40 ft. Occupied space is still never read; the values are authored (M5-I152).

```
Creature Base Movement
        │
        ▼
      × AGI
        │
        ▼
     Movement
        │
        ▼
Sprint = Movement × 4


No separate Total Movement statistic.
```

## 5. Six Canonical Affinities

`EVOCATION`, `CONJURATION`, `TRANSMUTATION`, `DIVINATION`, `ENHANCEMENT`, `MANIPULATION` (`CANONICAL_AFFINITIES`).
Each is one exact version-2 `AFFINITY` Definition keyed `affinity.<name>`. A bundle holding two executable
Definitions of one Affinity fails closed (`PROWESS_AFFINITY.AMBIGUOUS_AFFINITY_DEFINITION`).

## 6. Evocation / Emission

Evocation is canonical; Emission is legacy (M5-SC-001, M5-I115). "Emission" anywhere in a canonical payload is refused
(`PROWESS_DEFINITION.LEGACY_TERM_AS_CANONICAL`); provenance may record `{ legacyTerm: "Emission", canonicalTerm:
"Evocation" }`. Historical SourceDocument text keeps "Emission" verbatim. There is no `affinity.emission`.

## 7. Affinity Definition Contract

`AFFINITY` payload version 1 (WO1) stays `{ affinity }` — identity only, readable, never executable. Version 2:

```
AffinityDefinitionV2Payload {
  affinity:   CanonicalAffinity
  identity:   { text, themes[] }                          // descriptive prose — never a Keyword (§147)
  strengths:  [{ strengthKey, matchAny: keyCanon[] }]     // ANY exact Keyword (§53, §148)
  weaknesses: [{ weaknessKey, matchAny, activationPenaltyPercent, severity | null }]
  source:     { locators[], conflicts[] }
}
```

```
Affinity Definition
      │
      ├── Identity
      ├── Strength Keyword Rules
      ├── Weakness Rules
      │      └── Exact %
      └── Provenance
             │
             ▼
       Ability Keywords
             │
             ▼
      Alignment Evaluation
```

Identity is exact: Entity id + EntityVersion id + canonical key through the WO1 envelope. Evocation v1 and v2 are
different historical rule versions; a Release pinned to v1 never uses v2 (§26–§27).

## 8. Affinity Ownership

`CharacterAffinityProfile { primaryAffinity, affinities[] }`; each owned entry records the exact Definition ref, its
rank, its role (PRIMARY / SECONDARY) and optional acquisition metadata `{ level, optionKey }`. Ownership and rank are
separate (M5-I116). Every ref must be an exact executable Definition of the same bundle; two versions of one Entity are
never mixed (§138); an identical duplicate collapses deterministically; a conflicting duplicate fails closed
(`DUPLICATE_AFFINITY_OWNERSHIP`). The validated profile is detached and deep-frozen (§161).

## 9. Primary Affinity

A standard character chooses one Primary at Level 1. It is owned at rank NONE: its Strength / Weakness identity exists
(Weaknesses still apply), but the Strength discount is 0% and it grants no Authority capacity (§41–§42, §188–§189).

## 10. Secondary Affinity

A Secondary Affinity is a real, whole owned Affinity with its own exact Definition, Strengths, Weaknesses, rank and
access — never a half-Affinity (§45–§46). Its rank alone determines rank-based benefits.

## 11. Affinity Rank

`AFFINITY_RANKS = NONE, TRAINED, EXPERT, MASTER` names the states. Their order and meaning are the exact
`affinity.rank_rule` content: order 0 / 1 / 2 / 3, compared by M4 `RANK_AT_LEAST`, never by string. NONE is not the
Skill rank UNTRAINED (§30, M5-I120). Rank order is generic; rank meaning is Affinity-specific (Affinity Trained ≠
Skill Trained).

## 12. Affinity Advancement

`affinity.standard_progression` (s161): Level 1 REQUIRED `CHOOSE_PRIMARY` at NONE; Level 3 REQUIRED Primary NONE →
TRAINED; Level 6 CHOOSE_ONE Primary TRAINED → EXPERT or `GAIN_SECONDARY_TRAINED`; Level 9 CHOOSE_ONE
`UPGRADE_AFFINITY_RANK` (TRAINED → EXPERT), `PROMOTE_EXPERT_TO_MASTER`, `GAIN_NEW_AFFINITY` (start rank TRAINED since
the post-WO4 canon rulings; WO4 shipped it unresolved).
`validateAffinityProgression` applies the authored Levels in order, branching on every option, and reports VALID when
some path reaches exactly the profile's (role, rank) slots. Progression is never inferred from Level (§52): the result
only says whether the explicit profile is reachable, and exposes the next Level's options structurally. Explicit,
provenance-backed overrides (`{ overrideKey, affinity, rank, sourceKey }`) remove named entries from the standard check
(§159). No hidden maximum number of Affinities exists (§51).

## 13. M5-SC-035

The Level 9 "Gain a new Affinity" option states no starting rank. It is recorded `UNRESOLVED`; the option has
`startingRank: null` and `conflictKey: "M5-SC-035"`; any profile reaching it validates as `REQUIRES_CANON` (never
VALID) whatever rank it claims; it is never auto-executed (M5-I119).

**Post-WO4 canon rulings (M5-SC-035 RESOLVED_BY_DESIGNER).** "If you gain a new Affinity at 9, it is Trained." Every
Affinity ranks independently. `GAIN_NEW_AFFINITY` now has `startingRank: "TRAINED"` and `conflictKey: null`. The three
standard Level 9 outcomes validate VALID: Primary Trained → Expert → Master; Primary Expert plus one Secondary Trained;
three Affinities all Trained. A new Level 9 Affinity at NONE, EXPERT or MASTER is INVALID. The interpreter keeps its
fail-closed contract: an option whose authored starting rank is null still yields `REQUIRES_CANON`. M5-I119 is
SUPERSEDED by M5-I151.

## 14. Strength Keywords

A Strength rule matches when ANY of its exact Keyword canonical keys is present in the Ability's resolved Keyword set.
Group rules (`SUSTAINED_OR_CHANNELED_OUTPUT` → sustained_output, channeled_output) are structural grouping, never a new
Effect category (§148–§149). Strengths are never text searches (§54).

## 15. Weakness Keywords

Each Weakness rule is checked independently against the Ability's exact Keywords (§90). Keyword identity alone creates
no mechanic: `FIRE` causes nothing, `AREA_EFFECT` deals nothing (§69).

## 16. Standard Weakness Severity

`affinity.weakness_severity`: MINOR 10 · MODERATE 20 · MAJOR 30 (s686). Reference content only.

## 17. Exact Weakness Percentages

`activationPenaltyPercent` is authoritative (M5-I124). `severity` is an optional reference label, set only where the
exact percentage is on the standard scale. Percentages are finite and non-negative; 0 is a legal value; no maximum of
100 is imposed (§162–§164).

## 18. Divination +15%

Divination Persistent Effects is exactly +15% with `severity: null` — never rounded to 10, 20 or 30 (§59–§60, §187).
M4 percentage arithmetic is IEEE-754 binary floating point, so 100 × (1 + 15/100) is 114.99999999999999; WO4 asserts
the value M4 produced and rounds nothing (rounding belongs to the later cost pipeline, M5-SC-028).

## 19. Governing Affinity

Executable cost / Authority evaluation needs ONE explicit governing Affinity: the composition's `affinity` component.
It must be the character's exact owned Version under the same Ruleset; its rank always comes from the profile
(§80–§85, §135–§139). Nothing auto-selects Primary, highest rank, first match or newest (§81). One governing Affinity
drives one evaluation; no multi-Affinity stacking (§82–§83).

## 20. Alignment Classification

`STRENGTH`, `WEAKNESS`, `STRENGTH_AND_WEAKNESS`, `NEUTRAL` (§151). The result keeps every rule with its matched flag,
matched Keywords and contributors even when the classification summarizes them (§152). Neutral content gets no
discount and no penalty (§103–§104).

## 21. Strength Discount

One `REDUCE_PERCENT` modifier (UNIQUE `affinity.strength_discount`) whose condition is ANY Strength rule and whose
operand is the governing rank's authored discount (0 / 10 / 20 / 30). Multiple matched Strengths apply it once
(§87–§88, golden 20 → 16, never 12.8). At NONE the operand is 0 and the cost is unchanged (§89).

**Post-WO4 rulings batch (M5-SC-028, M5-I155).** The discount is now a `SUBTRACT` on the net cost percentage (start 100),
still UNIQUE, still once, still the authored rank value.

## 22. Highest Weakness Rule

One M4 `MAX` modifier per Weakness rule, each conditioned on its own exact Keywords, raises a 0 start value to the
highest matched percentage. One `INCREASE_PERCENT` (UNIQUE `affinity.weakness_penalty`) applies it, its operand BOUND
to the MAX step's `/data/finalTargets/0/value` (§91, §126, §130). No foundation change was required.

**Post-WO4 rulings batch (M5-SC-028, M5-I155).** The selected highest Weakness is now an `ADD` on the net cost percentage,
its operand still BOUND to the MAX step. Selection itself is unchanged.

```
Ability Keywords
      │
      ├── Strength match ─────► Rank Discount
      │
      └── Weakness matches ───► Highest Applicable %
                                  │
                                  ▼
                               Apply Once
```

## 23. Strength + Weakness Ordering

Strength (phase `affinity.strength`, order 1) then Weakness (phase `affinity.weakness`, order 2) in one M4 MODIFIER
step: 100 → 80 → 104, never netted to 110 (§94–§97).

```
Constructed Cost
       │
       ▼
Strength Discount
       │
       ▼
Weakness Penalty
       │
       ▼
Affinity-Adjusted Cost
       │
       ▼
Later:
Casting Conditions
       │
       ▼
Final Rounding
```

**Post-WO4 rulings batch — superseded (M5-SC-028; M5-I128 → M5-I155).** The designer ruled that every percentage cost
modifier combines into ONE net percentage, applied once, with rounding once at the end of Spell creation (normal, 0.5
up). The fragment is now two M4 MODIFIER steps: `net-percent` (100 − Strength discount + selected Weakness penalty) and
`cost` (listed cost × net ÷ 100, the multiplier BOUND to the net step). 100 MP at Expert with Healing → 100 − 20 + 30 =
110% → 110 (no longer 104). Designer example (Master −30%, Weakness +20%): 90% → 20 MP → 18 (never 16.8). Casting
Conditions join the same net sum in the Spell cost Work Order, which also rounds.

```
Constructed Cost              100%
       │                        │
       │            − Strength Discount
       │            + Highest Weakness %
       │                        │
       │                        ▼
       │                 Net Percentage
       │                        │
       └──────── × Net ÷ 100 ◄──┘
                    │
                    ▼
          Affinity-Adjusted Cost (unrounded)
                    │
                    ▼
       Later: Casting Conditions join the net sum
                    │
                    ▼
       Final Rounding (normal, once, at the end)
```

## 24. No Rounding

The Affinity layer never floors, ceils, rounds or uses toFixed; 17 at Trained is 15.3 (§99–§100, M5-I129).

## 25. Affinity Authority

Spell construction names ONE explicit Authority in the composition (`authority: { authority: "AFFINITY_AUTHORITY" |
"ARCANE_AUTHORITY" }`). Affinity Authority requires at least TRAINED (`authorityMinimumRank`, M4 `RANK_AT_LEAST`).
Specialization: each Effect must satisfy ANY Strength rule, ANY Weakness rule (a Weakness is accepted with its penalty,
§111), or an explicit access grant (`accessGrants: [{ componentKey, sourceKey }]`, §110, §112) — evaluated per Effect
against that Effect's own Keywords plus the Traits that apply to it. A failure is a valid not-satisfied result.

```
Spell Composition
        │
        ├──────────────┐
        ▼              ▼
Arcane Authority   Affinity Authority
flexibility        specialization
Arcana Rank        Affinity Rank
        │              │
        └──────┬───────┘
               ▼
       ONE selected authority

Capacities do not add.
```

## 26. Effect Capacity

TRAINED 1 · EXPERT 2 · MASTER 3 (rank-rule content), compared by M4 `NUMERIC_COMPARE <=` against the composition's
Effect count. Three Effects at Expert are "not satisfied" — never truncated (§193). NONE has no capacity (§38).

## 27. Trait Capacity

Base Trait capacity TRAINED 1 · EXPERT 2 · MASTER 3, compared the same way. Trait exchange (unused Effect slot → Trait
slot) remains later Spell Construction work.

## 28. Arcane Authority Boundary

Arcane Authority remains the broad path; Arcana Rank and its capacity belong to the later Spell Creation Work Order
(§113): an ARCANE_AUTHORITY composition is refused as `PROWESS_AFFINITY.ARCANE_AUTHORITY_NOT_IN_SCOPE`. Arcane and
Affinity capacities never add: Arcana Expert + Affinity Expert under Affinity Authority is 2 Effects, never 4 (§114,
§194). Authority and the Affinity cost modifier are separate subjects and separate outputs (§116–§117).

## 29. Spell Cost Mapping

`SPELL_AFFINITY_COST` targets the explicit `LISTED_MP_COST` (`spell.listed_mp_cost`) over the constructed cost the later
pipeline supplies. Affinity changes LISTED MP; ME later pays that listed cost and never modifies it (§133–§134).
Affinity never modifies Spell AP directly; its AP effect is indirect through the later MP-based AP derivation
(§135–§136). Trait access through Affinity Rank never makes a Trait free (§118).

```
Base Spell Components
       │
       ▼
Affinity Cost Modifier
       │
       ▼
Listed MP
       │
       ▼
Runtime Payment
  ├── ME
  └── MP


Affinity changes listed cost.

ME pays listed cost.
```

## 30. Maneuver Boundary

`SPELL_AFFINITY_COST` refuses a MANEUVER composition (`SPELL_AFFINITY_COST_SPELL_ONLY`, M5-I144). Maneuvers use
`AFFINITY_ALIGNMENT` and `AFFINITY_ACCESS` (identity, rank, Keyword alignment, Requirements) without any Spell Effect
identity; a Maneuver using an Affinity stays a Maneuver (M5-I039).

## 31. Summon Reuse Boundary

The Affinity Definitions, rank rule, profile and alignment / access subjects are subject-neutral and reusable by the
later Summon construction; WO4 implements no Summon cost.

## 32. M4 Keyword Mapping

Each component Definition's authored `keywords` become M4 `KEYWORD` contributions:
`{ keyword: { keywordId, canonicalKey, categoryId }, source: { sourceType: "prowess.<contract>", sourceKey: componentKey,
sourceId: entityVersionId, provenance }, ordinal: component position }`. The exact M1 Keyword references come from the
caller's catalog (`keywords`); a key without a reference fails closed (`UNKNOWN_KEYWORD`). There is no second resolver:
M4 deduplicates, orders and keeps contributors; the reader uses M4's `findResolvedKeywordById`. Geometry and names
never contribute (a RADIUS Targeting is aligned only if its Definition lists `keyword.area_effect`).

## 33. M4 Requirement Mapping

Strength / Weakness rules → `ANY(KEYWORD_PRESENT keywordId…)`; Authority → `RANK_AT_LEAST` (rank-rule orders) and
`NUMERIC_COMPARE <=`; specialization → `ANY(rules…, SET_CONTAINS affinity.access_grants)`; access prerequisites →
`ALL(ENTITY_OWNED, RANK_AT_LEAST, KEYWORD_PRESENT…)`. An unowned Affinity has no rank fact, so its prerequisite asks M4
the ownership question alone — M4 answers "not satisfied", never an engine error (§196).

## 34. M4 Modifier Mapping

Weakness selection: NUMERIC target `affinity.weakness_percent` = 0, one `MAX` per Weakness (STACK, condition = rule).
Cost: NUMERIC target `spell.listed_mp_cost` = base cost; `REDUCE_PERCENT` (phase 1) then `INCREASE_PERCENT` (phase 2,
operand bound to the selection). Both read the Ability's resolved Keyword set through a binding into `facts.keywords`.

## 35. Provenance

Every compiled step has a source-map entry naming its role, component keys and exact Definitions (governing Affinity,
`affinity.rank_rule`, contributing component Definitions) — M5 source mapping is Prowess component → M4 step; M4
RuleProvenance stays authoritative during execution (§154–§155). The alignment reading names, for each matched Keyword,
every contributing component and its exact Definition (§131, §156). Explanation runs through M4 `buildExplanation`
over the step responses — there is no Affinity explanation engine (§280).

## 36. Historical Reproducibility

R1 pins Evocation v1 (DIRECT_DAMAGE Strength, Expert 20%). After R2 pins a new Evocation EntityVersion with different
Strength content, R1 evaluates deep-equal, with identical provenance; R1 and R2 interleaved each use their own exact
Definition and rank rule. There is no latest / current lookup, registry or cache (§140–§141, §166–§168).

## 37. Remaining Conflicts

- **M5-SC-033** Base Movement values by Creature Size — UNRESOLVED in WO4 (reframed); RESOLVED_BY_DESIGNER by the
  post-WO4 canon rulings (Small 5 · Medium 5 · Large 10 · Huge 15 ft).
- **M5-SC-035** Starting rank of a new Level 9 Affinity — UNRESOLVED in WO4; RESOLVED_BY_DESIGNER by the post-WO4 canon
  rulings (TRAINED).
- **M5-SC-036** Base Movement of Massive creatures — UNRESOLVED (new in the post-WO4 canon rulings).
- **M5-SC-028** Rounding of percentage cost modifiers — UNRESOLVED in WO4; RESOLVED_BY_DESIGNER in the post-WO4 rulings
  batch: percentages net into one, applied once; rounding is normal, once, at the end (M5-I155).
- **M5-SC-011** Arcane Rank vs Arcana Rank terminology — UNRESOLVED in WO4; RESOLVED_BY_DESIGNER after WO4 (one rank:
  the Arcana Skill's, named Arcane Rank — M5-I153). Arcane Authority capacity is still out of WO4 scope.
- Keyword granularity (authoring note, not a conflict): matching is exact with no Keyword implication, so a component
  that is both "direct damage" and "damage" must list both `keyword.direct_damage` and `keyword.damage`. Which Keywords
  each catalog Effect lists belongs to the later Effect catalog Work Orders.
- M5-SC-034 is RESOLVED_BY_DESIGNER (Sprint Allowance = Movement × 4).

**Post-WO4 rulings batch.** Every conflict that was still open after M5-WO4 now has a designer ruling (see the register).
Huge Base Movement is 20 ft and Massive 40 ft (M5-I154). The two follow-ups were resolved as well: M5-SC-037 (Spell
Interference is a Utility Counter Spelling mechanic, not a branch) and M5-SC-038 (Active Effects 1 per 2 CON;
Concentration 1 + 1 per 3 RES). No conflict is open.
