# M5-WO9 — Duration & Ability Condition Framework

WO9 extends `packages/prowess-game/src/ability/compile.ts`, the permanent authored Ability entry point from WO8. Its
narrow `ability/duration-conditions.ts` helper accepts already compiled construction, Targeting, Effects and Traits.
It emits M4 FORMULA and REQUIREMENT operations into the same ordered EvaluationPlan and the same source map. There
is no independent Ability compiler, predicate evaluator, formula interpreter, persistence service or endpoint.

## Exact components and history

`SPELL_DURATION` and `MANEUVER_DURATION` implement the existing shared DURATION contract; `SPELL_CASTING_CONDITION`
and `MANEUVER_CONDITION` implement ABILITY_CONDITION. Definition references retain all five exact identity fields.
The parent compiler recreates the bundle against the supplied exact RulesetContext and checks its provenance. Every
component, including each selected dependency, must resolve there. Bundle presence alone does not satisfy a dependency.
Existing EntityVersion structured JSON and exact Release materialization provide storage; schema and migrations are
unchanged. Explicitly revised dependent Ability versions select new Duration/Condition versions; old Releases keep old
pins, contributions and requirements.

## Duration

The additive `rules.duration` contract identifies branch, executable/deferred availability, an M4 construction
requirement, listed-cost status and inert future-runtime metadata. Spell modes are INSTANT, ROUNDS, COMBAT, SCENE,
MISSION, SUSTAINED, MANA_LOCK and PERMANENT_BY_SPECIAL_RULE (the repository's existing Permanent token). ROUNDS requires
an explicit positive safe integer; no other Duration accepts arbitrary parameters. Maneuver Duration remains a
separate family, with source-supported Instant, Until Next Turn and Rounds reference Definitions.

WO7's exact Effect `duration.allowed` policy still decides compatibility. Sustained and Mana Lock additionally require
the corresponding Effect eligibility. WO8's closed Trait modifications cannot invent a Duration conversion; a Trait
scoped to Duration must author explicit DURATION compatibility, and every Trait DURATION compatibility is checked.

Duration costs reuse the existing listed component-cost grammar. Current canonical Duration prices are UNLISTED:
an empty contribution list means that no price was authored, not a permission to treat Duration as free. Separately
authored exact contributions can be exposed for later WO10/WO11 consumption. Permanent is deferred until a special
access rule exists (SC045); even an executable Permanent Definition must carry a structured construction prerequisite.
The source's indefinite *Sustain* condition is not Permanent permission.

## Ability Conditions

Ability Conditions are construction restrictions, never target Status Conditions (SC012). Existing forbidden status
keys remain rejected. The additive `rules.condition` contract includes declared parameters, an M4 applicability
requirement, inert runtime Requirement contracts, exact selected dependencies, slot behavior, incompatible restriction
tokens and an ALL/CHOOSE_ONE contribution policy. Opaque supplemental restriction/tradeoff data cannot become rules.

Applicability reads compiled mechanical facts: actual Effect resolution (including typed resolution Traits), projectile
delivery, inherited Maneuver attacks, area cardinality/conversion, selected Duration, valid targets, Effect families
and foundations. Attack/Save/area/Sustain restriction kinds retain mandatory intrinsic relevance checks. Target-state
restrictions require creature targeting. Encounter facts, such as vocalization, movement or the target being unaware,
are reported as REQUIREMENT_CONTRACT_ONLY; WO9 does not evaluate encounter state. Each runtime contract retains the
selected parameters it depends on, including Charge's `extraAp` and Limited Use's `period`.

The WO5 ABILITY_CONSTRUCTION_RULE remains the only slot-capacity authority. Normal Verbal and Somatic selections each
consume a slot. A false `consumesSlot` requires an explicit authored exemption rule. Existing construction prerequisites
and stacking limits are reused; duplicate restrictions cannot generate duplicate discounts, and incompatible movement
restrictions are rejected. No second rank-to-capacity table exists.

## Listed contributions and caps

SC021 caps Spell Casting Condition MP reductions at a flat **30% per Spell**, independently of slot capacity. The
additive `conditionPolicy` on the exact construction Definition authors cap, sum, scaling and parameter-step formulas.
M4 evaluates them. The result reports listed, effective, maximum and excess percentage points. Verbal lists 10%;
Somatic lists 1 AP reduction; Charge lists 10% per explicit additional AP and preserves the AP commitment separately;
Limited Use explicitly selects Scene 10%, Combat 20% or Mission 30%.

SC025 limits total Maneuver Condition reduction to **3 AP**. An attempted larger total is invalid and the exposed
effective contribution never exceeds three. No Counter Action and Cannot Crit require an explicit AP-or-MP TOKEN
selection with no default. Only the selected contribution is exposed. No minimum final AP or attack-count floor is
calculated. Percent amounts use percentage points; AP/MP amounts use points; reduction direction is explicit in the
modifier kind. No signed amount is silently reinterpreted.

Material has no default discount. Generic Material, Delayed, Environmental, Weapon Lock and similar templates remain
deferred until their required subject is authored precisely. Risk, Focus and Environmental Lock remain deferred where
the benefit is a range or GM-set. Cannot Move This Turn has conflicting source values (SC043). The old Once per Mission
5 AP entry cannot override SC025; no replacement value is guessed (SC044).

## Inspector, security and compatibility

Every new executable step cites the exact authored Ability, component and/or construction policy and selected use.
Its deterministic role names identify requirement, parameter, contribution, capacity and cap checks. The stable
`m5-wo9-ability-plans.json` fixture includes real evaluated results and source maps for both branches. The existing
`POST /api/rules/evaluate` and Inspector execute/display M4 plans; Studio owns no WO9 mechanics.

Plain-data validation rejects functions, getters, cycles, prototypes, unsafe keys and nonfinite numbers before
reading them. Closed contracts reject arbitrary expressions in prose. Output is detached, deeply frozen and JSON-safe.
The run reader validates exact step identity, order, operation, Ruleset, successful execution and complete numeric
WO9 results. Bundles normalize order deterministically. No global mutable registry exists.

Historical WO8 components remain readable. If an Ability uses only those components and no Conditions, its WO8 plan
remains byte-identical; existing golden Inspector fixtures enforce this. Typed WO9 components require the new exact
construction policy. Legacy Permanent still fails closed. SC041's ordinary Trait exchange and SC042's unresolved
additional Affinity Trait capacity remain unchanged.

## Future ownership and verification

WO10 owns final Spell MP/AP, percentage netting and rounding (SC028). WO11 owns final Maneuver AP. WO12 owns Effect
Chain execution. WO13 owns Sustain payment/AP, Mana Lock, Concentration and Active Effects. WO9 executes none of these,
and pays no resource, applies no damage/healing/movement/Status Condition and changes no combat state.

The dedicated WO9 workflow and full CI retain all prior gates. The local report records actual available verification;
DB/API/drift/Playwright require supported infrastructure. Local success and PR success are not FINAL PASS. Publication
and merge each require separate approval; completion requires green merged-main permanent CI.
