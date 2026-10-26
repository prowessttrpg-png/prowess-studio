# M5 Active Magic Runtime — Sustain, Mana Lock, Concentration, Channeling & Active Effects (M5-WO13)

Status: implemented locally by M5-WO13 on base `feed5df` (the M5-WO12 merge, PR #53). Code:
`packages/prowess-game/src/ability/active-magic.ts`; policy content `content/core-playtest-v0.1/active-magic.ts`
(pinned in the versioned `ABILITY_CONSTRUCTION_RULE` as `activeMagicPolicy`); reader
`definition/active-magic-policy.ts`. Gate: `M5-WO13 audit — Active Magic Runtime`.

## 1. Scope and Ownership

WO12 answered "what resolves?". WO13 answers "how does a resolved magical effect remain active, consume resources, require
focus, expire or end?". It owns ACTIVE MAGIC STATE TRANSITIONS only. Permanent ownership is reused, never duplicated:

| Concern | Owner | WO13 use |
| --- | --- | --- |
| What resolved, per target | WO12 `executeAbilityResolution` | called once at ACTIVATE; outcomes pinned |
| Final Spell MP / AP | WO10 `evaluateSpellCost` | called at ACTIVATE / CHANNEL_START; values pinned |
| Duration concept and runtime metadata | WO9 Duration Definitions (`futureRuntime`) | read; no second vocabulary |
| AP / ME / MP, ME-first payment, Max-MP reservation | WO3 `compileRuntime` + M4 Resource engine | every change |
| Concentration Save | WO2 `compileCoreResolution` (SAVING_THROW, PRO) | every test |
| Sustain MP, Concentration slots, DC | M4 FORMULA | every number |

No combat state is applied (no HP, Armor, position, Status Condition, terrain, summon AI).

## 2. Transition Architecture

`transitionActiveMagic(request)` is pure: `{ contractVersion, definitions, ruleset, caster (WO2 CharacterCore), casterKey,
resources (WO3 runtime Resources), state (or null), event }` → `{ status, event, state, resources, lifecycle,
resourceChanges, pending, concentration, ticks, channelResult, noActiveEffectReason, formulaEvaluations,
runtimeEvaluations, inspector }`. No RNG, no clock, no global registry; inputs are never mutated; the output is detached,
deep-frozen and JSON-safe. Events: ACTIVATE, MAINTENANCE, ROUND_END, BOUNDARY, DISMISS, EXTERNAL_END,
CONCENTRATION_TEST, CHANNEL_START, CHANNEL_INVEST, CHANNEL_STOP, TIMING.

## 3. Active Effect Contract

Each Active Effect keeps: unique `activeEffectKey`; `casterKey`; exact Spell (`ability`) and policy Definition refs; Ruleset
provenance; the WO12 `executionKey`; the pinned persistent outcomes (target, Effect Use, outcome key, Definition); the exact
Duration Definition, concept, remaining rounds and dismissal rule; Sustain (Final Spell MP, PRO, Sustain MP, Sustain AP, ME
eligibility, last payment); Concentration requirement; Mana Lock reservation; structured ticks; activation round; status;
end reason; ended-by event / source; and its source map (the M4 Sustain Formula evaluation).

## 4. Lifecycle States and End Reasons

Statuses: ACTIVE, PENDING_MAINTENANCE, PENDING_CONCENTRATION, ENDING (transient inside one transition, never held), ENDED.
End reasons: EXPIRED, DISMISSED, SUSTAIN_UNPAID, CONCENTRATION_FAILED, DISPELLED, INTERRUPTED, SOURCE_DESTROYED,
COMBAT_ENDED, SCENE_ENDED, MISSION_ENDED, RULE_TERMINATED. Ended Effects stay in the state (provenance is never deleted).
While a decision is pending only the resolving event is accepted (`PENDING_DECISION`).

## 5. Activation and Duration Handling

ACTIVATE takes the authored-Ability request (the transition supplies `definitions` / `ruleset`) with its WO12 `execution`.
WO10 must find the Spell VALID and the caster's PRO must equal the PRO its cost used; WO12 must be COMPLETE. INSTANT (or
`futureRuntime.persists: false`) → `NO_ACTIVE_EFFECT / INSTANT`, no state. Only emitted outcomes with authored operations
other than `NO_EFFECT` persist; none → `NO_ACTIVE_EFFECT / NOTHING_PERSISTS` (a Duration Keyword alone never creates state).
PERMANENT_BY_SPECIAL_RULE stays deferred (M5-SC-045). Maneuvers are refused (`SPELL_ONLY`).

## 6. Timed Durations

ROUNDS keeps `remainingRounds` = the authored `rounds` parameter and decrements at each explicit ROUND_END; at 0 it ends
EXPIRED. COMBAT / SCENE / MISSION end only at the explicit BOUNDARY event COMBAT_END / SCENE_END / MISSION_END
(COMBAT_ENDED / SCENE_ENDED / MISSION_ENDED); one boundary never ends another concept. Timed Effects pay no Sustain, need no
Concentration (WO9 `futureRuntime.concentration: NONE`) and are NOT_DISMISSIBLE by default.

## 7. Sustain

`futureRuntime.sustain` Effects pin `mpCost = max(1, floor(finalMp / PRO))` (M4 Formula over WO10's Final MP; 17 / 4 → 4;
4 / 5 → 1) and `apCost = sustainApPerRound` (1). A held `mpCost` is re-executed by M4 on every transition and an arbitrary
value is refused. MAINTENANCE pays, per Effect in stable identity order, AP (WO3 SPEND) then mana (WO3 MAGICAL_PAYMENT,
`meEligible: true`): ME first, then MP; the Sustain Cost is never reduced (5 vs ME 3 / MP 10 → 3 ME + 2 MP). "Permanent
Sustain" (Sustain ≤ ME) is informational: payment, AP and Concentration still apply every round. WO13 never refreshes ME —
WO3's START_OF_ROUND timing does.

## 8. Atomic Payment and Maintenance Selection

Each upkeep is staged on a working copy and adopted only when AP and mana are both legal; a failure restores the staged
Resources exactly (no partial mutation, no negative resource). When every upkeep can be paid it is. When none can (or the
only one cannot) each ends SUSTAIN_UNPAID. When some but not all can, the result is PENDING_MAINTENANCE_SELECTION with the
exact legal identities; the controller's ordered `selection` is paid all-or-nothing and unselected Effects end
SUSTAIN_UNPAID. The engine never picks oldest / newest / cheapest / first.

## 9. Mana Lock

A Mana Lock is WO3 RESERVE_CAPACITY on MP (M4: reservation changes `reservedCapacity` only). Locked MP is not spent and
current MP is untouched — M4's permanent contract keeps current above the available maximum as a legal preserved state
(m4 invariant "Current May Remain Above Available Maximum"), so no clamp or rejection is invented. Ending the Effect (any
reason) releases exactly its reservation (RELEASE_CAPACITY): available maximum returns, current MP does not refill. Locks
stack per Active Effect (Max 50, 10 + 15 → 25; one ends → 35). The base Maximum MP progression is never overwritten. The
amount needs an exact policy rule (`FINAL_SPELL_MP` or `FIXED`); the canonical policy has none (M5-SC-052) so activation
fails closed. Mana Lock and Sustain are never combined automatically; MANA_LOCK is NOT_DISMISSIBLE by default.

## 10. Concentration

Capacity: `1 + floor(RES / 2)` (M4 Formula; RES 1 → 1, 2 → 2, 3 → 2, 4 → 3, 5 → 3, 6 → 4; M5-SC-054). Consumers: live
Effects whose Duration says `concentration: WO13` (Sustained) plus an unfinished Channel. Starting a consumer beyond capacity
is refused; nothing is ended automatically. Concentration is not a Status Condition.

## 11. Concentration Save, DC and Failure Scope

CONCENTRATION_TEST takes a structured trigger (TAKES_DAMAGE, GRAPPLED, RESTRAINED, KNOCKED_PRONE, FORCIBLY_MOVED, STUNNED,
DAZED, FAILED_RELEVANT_SAVE, MAGICAL_DISRUPTION, MULTIPLE_UNSTABLE_EFFECTS, or the GM's CONCENTRATION_TEST_REQUIRED), a
target (an Active Effect or CHANNEL) and an explicit roll. DC = `8 + 2 × max(0, consumers − 1)` counting the disrupted
consumer. The Save is WO2's Prowess SAVING_THROW (Character Die + PRO + bonuses); a success boolean is never accepted.
No roll → PENDING_INPUT. Success changes nothing (no refund, no bonus). Failure ends the disrupted Effect
(CONCENTRATION_FAILED, releasing its own lock / slot) or fails the Channel; `failureScope: ALL` (explicit) ends every
consumer.

## 12. Channeling

CHANNEL_START pins the Spell's WO10 Final AP, requires a free Concentration slot and allows one Channel
(`maximumSimultaneous` 1). CHANNEL_INVEST spends AP through WO3 (1 … remaining; overpayment refused); reaching the
requirement completes immediately (no round boundary): the Channel ends, its slot is released and the Spell is
`readyToResolve` through the normal path. ROUND_END abandons a Channel that received less than `minimumApPerRound` this round.
A failed Concentration Save fails the Spell and loses all progress (restart at 0). CHANNEL_STOP abandons without refund. MP
payment timing is not defined (M5-SC-053): no MP is paid; the result carries `mpPayment: UNRESOLVED`.

## 13. Dismissal, Expiration and External Ends

Dismissal is the pinned per-Duration rule (SUSTAINED FREE_ACTION; everything else NOT_DISMISSIBLE without an exact rule).
EXTERNAL_END consumes DISPELLED, BANISHED / DESTROYED / SOURCE_ENDED (SOURCE_DESTROYED), INTERRUPTED and RULE_TERMINATED with
an exact source key; WO13 performs no Dispel check. Ending one Effect releases only its own slot and lock; there is no
cascade.

## 14. Ticks and Summons

An outcome operation carrying a structured `timing` (START_OF_TARGET_TURN, END_OF_TARGET_TURN, START_OF_CASTER_TURN,
END_OF_CASTER_TURN, ON_ROUND_START) yields ACTIVE_EFFECT_TICK_DUE on the matching TIMING event; nothing is applied and prose
timing is never parsed (no canonical Effect carries a timing yet). Summons use the same Duration metadata: a Sustained summon
uses Sustain and Concentration, a Timed one does not; no summon runtime or active-summon cap is built here.

## 15. Rules Inspector and Source Maps

`inspector`: Concentration capacity / used / DC; MP reserved / available maximum / current; per Active Effect the source
Spell, Ruleset, Duration and remaining rounds, Sustain (MP, AP, payment source), Concentration, Mana Lock and lifecycle;
the Channel (Spell, required / invested / remaining AP, slot, status). `resourceChanges` name the Active Effect or Channel,
rule, resource, operation, amount, before / after (and reservation / available maximum), Ruleset and WO3 subject.
`formulaEvaluations`, `runtimeEvaluations` and `concentration.test.core` carry every M4 plan and context, replayable through
`POST /api/rules/evaluate`.

## 16. Exact Ruleset and History

The state, every Active Effect and the Channel carry their Ruleset, Ability, Duration and policy versions. A request under
another Ruleset or policy version is refused; nothing is recompiled. An R1 Effect keeps R1 Sustain / lock / dismissal rules
after R2 changes them.

## 17. Unresolved Conflicts

Unchanged: M5-SC-042, M5-SC-046, M5-SC-047, M5-SC-048, M5-SC-049, M5-SC-050, M5-SC-051. New: M5-SC-052 (Mana Lock amount),
M5-SC-053 (Channel MP timing) — both fail closed; M5-SC-054 (Concentration capacity source discrepancy) resolved by the
WO13 designer instruction. Older Chapter text ("a failed check ends all Sustained spells"; "capacity returns only if the
spell ends normally") is superseded provenance.

## 18. Out of Scope

HP / Healing / Status Condition / Armor / movement application, terrain, summon AI, cast-time Duration rewriting, dynamic
Sustain or Mana Lock conversion, reactive Metamagic, chain rewriting, persistence (no schema or migration).
