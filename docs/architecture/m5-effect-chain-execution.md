# M5 Effect Chain Execution & Runtime Resolution Routing (M5-WO12)

Status: implemented locally by M5-WO12 on base `799996b` (the M5-WO11 merge, PR #52). Code:
`packages/prowess-game/src/ability/effect-execution.ts`; authored chain contract `definition/effect-chain-payload.ts`;
policy `content/core-playtest-v0.1/effect-execution.ts` (pinned in the versioned `ABILITY_CONSTRUCTION_RULE` as
`effectExecutionPolicy`). Gate: `M5-WO12 audit — Effect Chain Execution & Runtime Routing`.

## 1. Scope

WO12 executes CONTROL FLOW and RESOLUTION ROUTING: which Effect is considered next, whether its trigger holds, which
check resolves it, whether it succeeded, which authored outcome applies, and where each target's chain goes. It emits
structured RESOLVED OUTCOME records. It does not apply them.

## 2. Effect Chain vs Effect Outcome

Resolution ("did this Effect succeed?") and outcome selection ("which authored outcome applies?") are WO12's. State
application ("how does the encounter change?") is not: no HP, Armor, Resistance, position, Status Condition, AP / MP /
ME, inventory, summon, terrain or zone is changed.

## 3. Effect Chain vs Chain Targeting

The Effect Chain is Effect A → Effect B for one target. Chain Targeting is Target A → Target B. WO12 never fakes target
hopping with branches: targets are the caller's explicit Targeting result, in its order; a hop order without
target-selection authority is never invented.

## 4. Execution-Plan Architecture

`compileAbilityExecution(request)` compiles and evaluates the exact authored Ability (WO8; it must be VALID), reads the
Ruleset's execution policy and builds either Spell chain nodes (exact Effect Use, Definition, order, resolution, route,
Save flow, Chain Behavior and its source, branch destinations, trigger, successor, outcomes, Traits) or Maneuver
resolution groups (Attack / Powerful Blow / action, its ONE resolution, attached Effects). `executeAbilityResolution`
recompiles from the request — a caller-supplied plan is never trusted — and executes with `execution: { targets,
groupTargets?, inputs }`.

## 5. Runtime Input Requests

Each needed fact is a request with a stable key `wo12.<subject>.<target>.<scope>.<kind>` (scope `delivery`,
`effect.<effectKey>` or `group.<groupKey>`; kind `attack_roll`, `saving_throw`, `save_removal`, `save_selection`), the
asking party, legal options and provenance. Inputs carry the plan's `executionKey` (Ruleset, manifest, Ability version,
subject) and an exact request key. Rolls are `{ roller: CharacterCore, roll, targetDodge | difficultyClass }`; WO12 runs
the WO2 core resolution on M4 — a `success: true` claim is not an input. Missing input → `PENDING_INPUT`; supplying it
and re-executing gives the same result as a complete-input run. Inputs for another plan, target, Effect, group or kind
are refused; a valid input for an unreached request is reported unused. There is no RNG.

## 6. Trigger Evaluation

A trigger is an M4 REQUIREMENT (NUMERIC_COMPARE / SET_CONTAINS / ALL / ANY / NONE) over chain-local facts
(`chain.<earlierEffect>.success|failure`, `chain.previous.success|failure`, `delivery.hit|critical`) and explicit runtime
target facts (`target.<name>`, supplied with the target; absent → `PENDING_INPUT`). Prose never executes.

## 7. NOT_TRIGGERED Interpretation

A false trigger makes the node NOT_TRIGGERED: no outcome, not FAILURE; traversal continues to the next normally reachable
node (Trigger > Position).

## 8. Effect Success / Failure Normalization

ATTACK_ROLL: hit → SUCCESS, miss → FAILURE. SAVING_THROW: target fails → SUCCESS, target succeeds → FAILURE. AUTOMATIC:
SUCCESS (the authored Ability evaluated VALID, so its application requirements hold). Trait RESOLUTION modifications are
honoured; Trait TRIGGER modifications fail closed (M5-SC-049).

## 9. The Five Chain Behaviors

`effectChain: { failurePolicy, nodes? }` on the Spell branch. CONTINUE — next regardless; SUCCESS_ONLY — failure
terminates; FAILURE_ONLY — success terminates; STOP — terminates after the outcome; BRANCH — exactly one destination. An
unlisted Effect uses the authored failure policy (STOP → SUCCESS_ONLY, CONTINUE → CONTINUE); no `effectChain` uses the
ruled default (M5-SC-014: failure ends the chain).

## 10. Branches

Destinations are exact later Effect Uses of the same Spell, distinct, each owned by one branch. A branch destination is
skipped by ordinary sequential traversal, so taking one destination never runs the other.

## 11. Cycle Prevention

Forward-only destinations make the graph acyclic by construction; a visited-node guard reports `INVALID_RUNTIME_PATH`.

## 12. Multi-Target Isolation

Each target has its own cursor, chain-local facts, delivery and termination; no target's path affects another.

## 13. Projectile Delivery

Delivery (WO6 `RANGED_ATTACK_ROLL`) resolves first, per target. An ATTACK_ROLL Effect reuses the delivery roll (no second
request); a miss there is that Effect's FAILURE. Any other Effect after a miss is NOT_DELIVERED and the target terminates
`DELIVERY_FAILED` — no Save is requested, no Automatic Effect applies.

## 14. Outcome Emission

Ordered `outcomes`: target, Effect Use, group, Definition, result, outcome key, the exact authored operations (inert;
`NO_EFFECT` is valid), whether authored, critical flag, parameters, Formula values, resolving request, Ruleset. Order is
preserved for a downstream applier (later conflicting Effects override earlier ones there).

## 15. State-Mutation Boundary

No mutation of combat or persistent state; no resource payment; no summon creation; no Status Condition instances.

## 16. Maneuver Attack Resolution Groups

Each Attack Use is a group (one Attack Roll per target); a Powerful Blow is one group; a non-attack action is a group with
no roll. Groups take explicit `groupTargets`. Effects resolve from their group only; within a group they are independent
and ordered — no Spell chain behavior is imposed.

## 17. Powerful Blow

One Attack request per target; attached Effects execute once.

## 18. Inherited Maneuver Resolution

INHERIT_ABILITY and FOUNDATION_ATTACK Effects resolve from the group with no request of their own.

## 19. Martial Save Control

A Maneuver Effect with an OWN Martial Save Profile replaces the group's Attack Roll (no Attack request, no critical).
Policy: TRAINED — the defender chooses; EXPERT — the attacker removes one, then the defender chooses (or the last Save
stands); MASTER — the attacker chooses. One-Save profiles need no choice. Choices are validated inputs; the engine never
chooses for a person.

## 20. Critical Scoping

Critical context comes from the resolving Attack Roll (WO2 critical hit) and reaches only that Attack's / Powerful Blow's
Effects (or, for a Spell, the Effect whose roll it was). No structured Critical Upgrade exists yet; none is synthesized.

## 21. Historical Execution

Plans, policy and inputs are pinned to the exact materialized Ruleset; an R1 Spell keeps R1 routing after R2.

## 22. Rules Inspector Traces

Per target: delivery, node statuses (PENDING_INPUT / NOT_REACHED / NOT_TRIGGERED / NOT_DELIVERED / EXECUTED_SUCCESS /
EXECUTED_FAILURE), trigger evaluation, resolving request, transition and termination token (END_OF_CHAIN, STOP,
SUCCESS_ONLY_FAILURE, FAILURE_ONLY_SUCCESS, DELIVERY_FAILED, BRANCH_END, NO_REACHABLE_EFFECT, INVALID_RUNTIME_PATH); per
Maneuver group: resolution, critical and Effect statuses. `coreEvaluations` and `triggerEvaluations` carry every M4 plan
and its contexts, so each step replays through `POST /api/rules/evaluate`.

## 23. Unresolved Conflicts

M5-SC-042, M5-SC-046, M5-SC-047 and M5-SC-048 are unchanged. New: M5-SC-049 (Trait TRIGGER semantics), M5-SC-050
(Save selection without an executable runtime choice), M5-SC-051 (unrouted Maneuver resolution combinations) — each fails
closed.

## 24. WO13 Boundary

Sustain, Mana Lock lifecycle, Concentration and checks, Active Effect capacity, maintenance and expiration are WO13. An
ongoing outcome is recorded, never maintained. Ability activation triggers, dynamic Metamagic and cast-time chain rewriting
are out of scope.
