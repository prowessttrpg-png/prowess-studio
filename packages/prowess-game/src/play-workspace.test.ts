import { describe, expect, it } from "vitest";
import { orchestrateRulesEvaluation } from "@prowess/rules";
import { compileAbilityDefinition, readAbilityDefinitionRun } from "./ability/compile.js";
import { compileExecutionCore, executeAbilityResolution, executeCompiledResolution } from "./ability/effect-execution.js";
import { transitionActiveMagic, transitionActiveMagicWith } from "./ability/active-magic.js";
import { Problems } from "./internal/problems.js";
import { buildPlayWorkspace } from "./play/workspace.js";
import { evaluatePlayOperation, readPlayOperation } from "./play/operations.js";
import { readPlayRuntimeState } from "./play/state.js";
import { activeMagicFixture, caster, pool } from "./testing/active-magic-fixtures.js";
import { attackInput, choiceInput, executionFixture, saveInput } from "./testing/effect-execution-fixtures.js";
import { EMBER_ID, EMPTY, playWorld, roll, step, STRIKE_ID, WARD_ID } from "./testing/play-fixtures.js";
import type { PlayStored } from "./play/operations.js";
import type { PlayContext } from "./play/operations.js";

/**
 * PAS-10 M6-WO10 — Character Play Workspace domain tests (verification A, B, C). Every number asserted here was produced
 * by M4 through the existing M5 / M6 authorities; the world is the isolated M6-WO8 test Release (never canon).
 */
const T = { timeout: 300_000 };
const id = (n: number) => `00000000-0000-4000-8000-0000000b${String(n).padStart(4, "0")}`;
const HEX = id(1), LOCK = id(4);
const current = (stored: PlayStored, key: string, ctx: PlayContext = playWorld().context) => buildPlayWorkspace(ctx, stored).resources.find((r) => r.resourceKey === key)!.current;
function run(ctx: PlayContext, ops: unknown[], start: PlayStored = EMPTY) {
  let stored = start;
  const outcomes = ops.map((op) => {
    const r = step(ctx, stored, op);
    stored = r.stored;
    return r.outcome;
  });
  return { stored, outcomes };
}
const INTO_TURN = [{ kind: "TIMING", event: "BEGIN_COMBAT" }, { kind: "TIMING", event: "START_ROUND" }, { kind: "TIMING", event: "START_TURN" }];
const manual = (resourceKey: string, after: number) => ({ kind: "MANUAL_ADJUSTMENT", resourceKey, after, reason: "test setup" });
function extraSpells() {
  return playWorld().withSpells([
    { abilityId: HEX, name: "Hex", effects: [["effect1", "spell.effect.impair"]], duration: ["spell.duration.rounds", { rounds: 2 }] },
    { abilityId: LOCK, name: "Lock", effects: [["effect1", "fixture.wo9.effect.maintenance"]], duration: ["spell.duration.mana_lock", {}] },
  ]);
}

describe("M6-WO10 A — runtime, timing and the action economy", () => {
  it("M6-I151 M6-I152 initializes from the sheet's derived values with exact Character and Release provenance", T, () => {
    const w = playWorld();
    const view = buildPlayWorkspace(w.context, EMPTY);
    expect(view.runtime.characterId).toBe(w.context.characterId);
    expect(view.runtime.releaseId).toBe(w.context.releaseId);
    expect(view.runtime.rulesetProvenance).toEqual(w.f.bundle.rulesetProvenance);
    // Current = the sheet's derived maximum when never saved (as on the Character Sheet); no maximum is stored.
    for (const r of view.resources.filter((x) => !x.runtimeOnly)) expect(r.current, r.resourceKey).toBe(w.context.mechanics.resources.find((m) => m.resourceKey === r.resourceKey)!.maximum);
    expect(Object.keys(view.runtime).sort()).toEqual(["activeMagic", "advancementCount", "characterId", "combat", "contractVersion", "movement", "movementAllowance", "releaseId", "reservedMp", "rulesetProvenance"]);
    expect(view.persisted).toBe(false);
  });

  it("M6-I160 AP capacity is the Release-derived BASE_AP_CAPACITY (never a hard-coded three)", T, () => {
    const w = playWorld();
    const capacity = w.profile.derivedStatistics.find((d) => d.statistic === "BASE_AP_CAPACITY")!.value;
    expect(capacity).not.toBe(3);
    const { stored } = run(w.context, [...INTO_TURN.slice(0, 2), manual("AP", 1), INTO_TURN[2]]);
    expect(current(stored, "AP")).toBe(capacity);
  });

  it("M6-I160 START_OF_ROUND refreshes ME and Counter Actions; START_OF_TURN refreshes AP; END_OF_TURN expires AP and Movement", T, () => {
    const w = playWorld();
    const r = run(w.context, [{ kind: "TIMING", event: "BEGIN_COMBAT" }, manual("ME", 1), manual("AP", 2), { kind: "TIMING", event: "START_ROUND" }]);
    expect(current(r.stored, "ME")).toBe(5);
    expect(current(r.stored, "AP")).toBe(2); // AP does not refresh at the start of a round
    const t = run(w.context, [{ kind: "TIMING", event: "START_TURN" }, { kind: "GENERAL_ACTION", actionKey: "MOVE" }], r.stored);
    expect(current(t.stored, "AP")).toBe(4);
    expect(current(t.stored, "MOVEMENT_ALLOWANCE")).toBe(30);
    const e = run(w.context, [{ kind: "TIMING", event: "END_TURN" }], t.stored);
    expect([current(e.stored, "AP"), current(e.stored, "MOVEMENT_ALLOWANCE"), current(e.stored, "HP")]).toEqual([0, 0, 15]);
    expect(e.outcomes[0]!.trace.timing).toMatchObject({ event: "END_OF_TURN" });
  });

  it("M6-I160 duplicate or out-of-sequence timing events are refused (no double refresh); nothing advances on its own", T, () => {
    const w = playWorld();
    const r = run(w.context, [...INTO_TURN, { kind: "TIMING", event: "START_TURN" }, { kind: "TIMING", event: "END_ROUND" }, { kind: "TIMING", event: "END_TURN" }, { kind: "TIMING", event: "START_TURN" }]);
    expect(r.outcomes.map((o) => o.status)).toEqual(["COMMITTABLE", "COMMITTABLE", "COMMITTABLE", "REFUSED", "REFUSED", "COMMITTABLE", "REFUSED"]);
    expect(r.outcomes[6]!.reasons[0]!.message).toMatch(/already taken its turn this round \(AP would refresh twice\)/);
    // Re-reading the stored state changes nothing (no automatic refresh, advance or reset).
    expect(buildPlayWorkspace(w.context, r.stored).runtime).toEqual(r.stored.runtime);
    expect(buildPlayWorkspace(w.context, r.stored).timing.legal).toEqual(["START_ROUND"].filter(() => false).concat(["END_ROUND", "END_COMBAT"]));
  });

  it("M6-I161 FIXED payment is confirmed before any follow-on; a failed payment grants nothing and changes nothing", T, () => {
    const w = playWorld();
    const r = run(w.context, [...INTO_TURN, manual("AP", 0), { kind: "GENERAL_ACTION", actionKey: "MOVE" }]);
    const refused = r.outcomes[4]!;
    expect(refused.status).toBe("REFUSED");
    expect(refused.reasons[0]!.code).toBe("PLAY.INSUFFICIENT_RESOURCES");
    expect(refused.resourcesAfter).toBeNull();
    expect(refused.runtimeAfter).toBeNull();
    expect(current(r.stored, "MOVEMENT_ALLOWANCE")).toBe(0);
  });

  it("M6-I161 RANGE / MINIMUM need an explicit legal choice; VARIABLE costs are never priced as zero", T, () => {
    const w = playWorld();
    const r = run(w.context, [...INTO_TURN, { kind: "GENERAL_ACTION", actionKey: "GRAPPLE" }, { kind: "GENERAL_ACTION", actionKey: "GRAPPLE", chosenCost: 3 }, { kind: "GENERAL_ACTION", actionKey: "GRAPPLE", chosenCost: 2 }, { kind: "GENERAL_ACTION", actionKey: "CAST_SPELL" }, { kind: "GENERAL_ACTION", actionKey: "USE_SKILL_ACTION" }]);
    expect(r.outcomes.slice(3).map((o) => o.status)).toEqual(["PENDING_INPUT", "REFUSED", "COMMITTABLE", "REFUSED", "UNSUPPORTED"]);
    expect(current(r.stored, "AP")).toBe(3);
    expect(r.outcomes[6]!.reasons[0]!.code).toBe("PLAY.COST_UNRESOLVED");
  });

  it("M6-I161 an ACTIVE, APPLIED, unconditional Action Improvement overrides the FIXED cost (M6-WO9 authority)", T, async () => {
    const { improvementWorld } = await import("./testing/play-fixtures.js");
    const ctx = improvementWorld();
    const r = run(ctx, [...INTO_TURN, { kind: "GENERAL_ACTION", actionKey: "DODGE_ACTION" }]);
    expect(r.outcomes[3]!.status).toBe("COMMITTABLE");
    expect(r.outcomes[3]!.trace.improvementOverride).toMatchObject({ amount: 2 });
    expect(current(r.stored, "AP", ctx)).toBe(buildPlayWorkspace(ctx, EMPTY).resources.find((x) => x.resourceKey === "AP")!.maximum! - 2);
  });

  it("M6-I162 split movement and terrain are charged by WO3 / M4; over-spending is refused whole", T, () => {
    const w = playWorld();
    const r = run(w.context, [...INTO_TURN, { kind: "GENERAL_ACTION", actionKey: "MOVE" }, { kind: "MOVE", segments: [{ distance: 10, terrainKey: "NORMAL" }] }, { kind: "MOVE", segments: [{ distance: 5, terrainKey: "DIFFICULT" }] }, { kind: "MOVE", segments: [{ distance: 5, terrainKey: "NORMAL" }, { distance: 10, terrainKey: "NORMAL" }] }]);
    expect(r.outcomes.slice(4).map((o) => o.status)).toEqual(["COMMITTABLE", "COMMITTABLE", "REFUSED"]);
    expect(current(r.stored, "MOVEMENT_ALLOWANCE")).toBe(10);
    expect(r.stored.runtime!.movement).toEqual({ grants: [30], segments: [{ distance: 10, terrainKey: "NORMAL", allowanceCost: 10 }, { distance: 5, terrainKey: "DIFFICULT", allowanceCost: 10 }] });
  });

  it("M6-I163 Counter Actions: outside the own turn, an explicit declared trigger, Counter Action cost (no AP); Surprise blocks round 1", T, () => {
    const w = playWorld();
    const react = { kind: "GENERAL_ACTION", actionKey: "COUNTER_REACTION", trigger: { triggerKey: "ENEMY_ATTACKS", description: "the goblin swings at me" } };
    const r = run(w.context, [{ kind: "TIMING", event: "BEGIN_COMBAT" }, { kind: "TIMING", event: "START_ROUND" }, { kind: "GENERAL_ACTION", actionKey: "COUNTER_REACTION" }, react, { kind: "TIMING", event: "START_TURN" }, react]);
    expect(r.outcomes.slice(2).map((o) => o.status)).toEqual(["PENDING_INPUT", "COMMITTABLE", "COMMITTABLE", "REFUSED"]);
    expect(r.outcomes[2]!.reasons[0]!.message).toMatch(/does not by itself make a reaction legal/);
    expect(r.outcomes[3]!.resourcesAfter!.find((x) => x.resourceKey === "AP")!.current).toBe(5);
    expect(r.outcomes[3]!.resourcesAfter!.find((x) => x.resourceKey === "COUNTER_ACTION")!.current).toBe(0);
    expect(r.outcomes[3]!.inputs.trigger).toMatchObject({ source: "PLAYER_DECLARED" });
    const s = run(w.context, [{ kind: "TIMING", event: "BEGIN_COMBAT", surprised: true }, { kind: "TIMING", event: "START_ROUND" }, react]);
    expect(s.outcomes[2]!.reasons[0]!.code).toBe("PLAY.USAGE_UNAVAILABLE");
  });

  it("M6-I153 the operation contract is closed: derived mechanics are not accepted fields", () => {
    expect(readPlayOperation({ kind: "GENERAL_ACTION", actionKey: "MOVE", apCost: 0 }).ok).toBe(false);
    expect(readPlayOperation({ kind: "WEAPON_ATTACK", attackKey: "a", hand: "MAIN_HAND", damageProfileKey: "x", hit: true }).ok).toBe(false);
    expect(readPlayOperation({ kind: "SPELL", abilityId: EMBER_ID, revisionNumber: 1, targets: [], inputs: [{ requestKey: "k", kind: "ATTACK_ROLL", roll: roll(5), targetDodge: 1, success: true }] }).ok).toBe(false);
    expect(readPlayOperation({ kind: "MANUAL_ADJUSTMENT", resourceKey: "AP", after: 2, maximum: 99 }).ok).toBe(false);
  });
});

describe("M6-WO10 B — Attack, Spell and Maneuver resolution", () => {
  it("M6-I159 M6-I167 a Weapon Attack pays its OWN authored AP once and resolves through the WO2 Attack Roll; damage is never applied", T, () => {
    const w = playWorld();
    const attack = w.context.attackLibrary.mainHand!.attacks[0]!;
    const base = { kind: "WEAPON_ATTACK", attackKey: attack.attackKey, hand: attack.hand, damageProfileKey: attack.damage[0]!.profileKey };
    const r = run(w.context, [...INTO_TURN, base, { ...base, roll: roll(8), targetDodge: 5 }, { ...base, roll: roll(1), targetDodge: 30 }]);
    expect(r.outcomes.slice(3).map((o) => o.status)).toEqual(["PENDING_INPUT", "COMMITTABLE", "COMMITTABLE"]);
    const [hit, miss] = [r.outcomes[4]!, r.outcomes[5]!];
    expect(hit.trace.resolution).toMatchObject({ hit: true });
    expect(hit.trace.outcome).toMatchObject({ kind: "DAMAGE_PROFILE", applied: false });
    expect(miss.trace.resolution).toMatchObject({ hit: false });
    expect(current(r.stored, "AP")).toBe(5 - attack.apCost - attack.apCost);
    expect(JSON.stringify(hit.trace.payments)).toContain(attack.attack.canonicalKey);
    expect(JSON.stringify(hit.trace.payments)).not.toMatch(/LIGHT_ATTACK|BALANCED_ATTACK|HEAVY_ATTACK/);
    expect(hit.inputs.targetDodge).toEqual({ value: 5, source: "PLAYER_GM_PROVIDED" });
  });

  it("M6-I158 a Spell with missing inputs pays nothing and lists the exact pending requests; the complete input commits once", T, () => {
    const w = playWorld();
    const cast = { kind: "SPELL", abilityId: EMBER_ID, revisionNumber: 1, targets: [{ targetKey: "goblin" }], inputs: [] as unknown[] };
    const pending = run(w.context, [...INTO_TURN, cast]);
    const p = pending.outcomes[3]!;
    expect(p.status).toBe("PENDING_INPUT");
    expect(p.resourcesAfter).toBeNull();
    expect(p.pending[0]).toMatchObject({ kind: "ATTACK_ROLL", by: "ATTACKER", characterDie: "D8" });
    const requestKey = p.pending[0]!.requestKey as string;
    const done = run(w.context, [{ ...cast, inputs: [{ requestKey, kind: "ATTACK_ROLL", roll: roll(7), targetDodge: 4 }] }], pending.stored);
    const c = done.outcomes[0]!;
    expect(c.status).toBe("COMMITTABLE");
    // ME pays first for a Spell's casting MP (M5-SC-004): 11 MP listed = 5 ME + 6 MP; the listed cost is unchanged.
    expect([current(done.stored, "ME"), current(done.stored, "MP"), current(done.stored, "AP")]).toEqual([0, 1, 3]);
    const mana = (c.trace.payments as { kind: string; payments?: { listedAmount: number; policy: string }[] }[]).find((x) => x.kind === "MAGICAL_PAYMENT")!;
    expect(mana.payments![0]).toMatchObject({ listedAmount: 11, policy: "ME_ELIGIBLE_MAGICAL_COST" });
    expect((c.trace.resolution as { outcomes: { applied: boolean }[] }).outcomes.every((o) => o.applied === false)).toBe(true);
  });

  it("M6-I164 Saving Throw: the defender (GM-described) rolls against the Character DC; a successful Save is the Effect's FAILURE", T, () => {
    const ctx = extraSpells();
    const cast = { kind: "SPELL", abilityId: HEX, revisionNumber: 1, targets: [{ targetKey: "ogre" }], inputs: [] as unknown[] };
    const pending = run(ctx, [...INTO_TURN, cast]).outcomes[3]!;
    expect(pending.pending[0]).toMatchObject({ kind: "SAVING_THROW", by: "DEFENDER", defaultDifficultyClass: ctx.characterDc });
    const requestKey = pending.pending[0]!.requestKey as string;
    const defender = { level: 1, stats: { STR: 3, AGI: 3, CON: 3, PER: 3, RES: 3, PRO: 3 } };
    const saved = run(ctx, [...INTO_TURN, { ...cast, inputs: [{ requestKey, kind: "SAVING_THROW", roll: roll(4), defender }] }]).outcomes[3]!;
    const failed = run(ctx, [...INTO_TURN, { ...cast, inputs: [{ requestKey, kind: "SAVING_THROW", roll: roll(1), defender }] }]).outcomes[3]!;
    const result = (o: typeof saved) => (o.trace.resolution as { outcomes: { result: string }[] }).outcomes[0]!.result;
    expect([saved.status, failed.status]).toEqual(["COMMITTABLE", "COMMITTABLE"]);
    expect(result(saved)).toBe("FAILURE");
    expect(result(failed)).toBe("SUCCESS");
    expect((saved.inputs.inputs as { difficultyClass: unknown; defender: unknown }[])[0]).toMatchObject({ difficultyClass: { value: ctx.characterDc, source: "CHARACTER_DC" }, defender: { source: "PLAYER_GM_PROVIDED" } });
  });

  it("M6-I165 a Maneuver resolves its independent groups (one Attack Roll per group), pays its M5-WO11 cost once and applies nothing", T, () => {
    const w = playWorld();
    const use = { kind: "MANEUVER", abilityId: STRIKE_ID, revisionNumber: 1, targets: [{ targetKey: "goblin" }, { targetKey: "orc" }], groupTargets: [{ groupKey: "attack1", targetKeys: ["goblin"] }, { groupKey: "attack2", targetKeys: ["orc"] }], inputs: [] as unknown[] };
    const pending = run(w.context, [...INTO_TURN, use]).outcomes[3]!;
    expect(pending.status).toBe("PENDING_INPUT");
    expect(pending.pending.map((q) => q.scope)).toEqual(["group.attack1", "group.attack2"]);
    const inputs = pending.pending.map((q, i) => ({ requestKey: q.requestKey, kind: "ATTACK_ROLL", roll: roll(i === 0 ? 8 : 1), targetDodge: 6 }));
    const r = run(w.context, [...INTO_TURN, { ...use, inputs }]);
    const o = r.outcomes[3]!;
    expect(o.status).toBe("COMMITTABLE");
    const groups = (o.trace.resolution as { groups: { groupKey: string; targets: { resolution: { result: string } }[] }[] }).groups;
    expect(groups.map((g) => [g.groupKey, g.targets[0]!.resolution.result])).toEqual([["attack1", "SUCCESS"], ["attack2", "FAILURE"]]);
    expect(current(r.stored, "AP")).toBe(5 - (o.trace.costs as { finalApCost: number }).finalApCost);
    expect(JSON.stringify(o.trace.payments)).not.toContain("ME_ELIGIBLE");
  });

  it("M6-I158 runtime-deferred Abilities are never executed (Mana Lock amount M5-SC-052 fails closed)", T, () => {
    const ctx = extraSpells();
    const o = run(ctx, [...INTO_TURN, { kind: "SPELL", abilityId: LOCK, revisionNumber: 1, targets: [{ targetKey: "ally" }], inputs: [] }]).outcomes[3]!;
    expect(o.status).toBe("UNSUPPORTED");
    expect(o.reasons[0]!.message).toContain("M5-SC-052");
    expect(o.resourcesAfter).toBeNull();
  });

  it("M6-I152 exact revision identity: a stale revision is refused, never re-interpreted as the current one", T, () => {
    const w = playWorld();
    const o = run(w.context, [...INTO_TURN, { kind: "SPELL", abilityId: EMBER_ID, revisionNumber: 7, targets: [{ targetKey: "goblin" }], inputs: [] }]).outcomes[3]!;
    expect(o.reasons[0]!.code).toBe("PLAY.REVISION_CHANGED");
  });

  it("M6-I171 the M5-WO12 adapter path executes the five chain behaviors exactly as the canonical path (golden equivalence)", T, () => {
    const F = executionFixture();
    for (const key of ["fixture.wo12.spell.continue", "fixture.wo12.spell.success_only", "fixture.wo12.spell.failure_only", "fixture.wo12.spell.stop", "fixture.wo12.spell.branch"]) {
      const request = F.ability(key, "MASTER") as Record<string, unknown>;
      const compiled = compileAbilityDefinition(request);
      if (!compiled.ok) throw new Error(key);
      const ran = orchestrateRulesEvaluation({ evaluationKey: `authored.${String(request.subjectKey)}`, contexts: { ruleset: request.ruleset as never }, plan: compiled.value.evaluationPlan });
      const authored = readAbilityDefinitionRun(compiled.value, ran.data!);
      if (!authored.ok) throw new Error(key);
      const core = compileExecutionCore(new Problems(), request, compiled.value, authored.value, compiled.value.definition.entityVersionId);
      if (!core.ok) throw new Error(key);
      const ek = core.value.plan.executionKey;
      for (const natural of [6, 1]) {
        let inputs: Record<string, unknown>[] = [];
        for (let i = 0; i < 6; i += 1) {
          const execution = { targets: [{ targetKey: "t1" }], inputs };
          const canonical = executeAbilityResolution({ ...request, execution });
          expect(executeCompiledResolution(core.value, { execution }), `${key} ${String(natural)} #${String(i)}`).toEqual(canonical);
          if (!canonical.ok || canonical.value.status === "COMPLETE") break;
          inputs = [...inputs, ...canonical.value.pendingInputs.map((q) => (q.kind === "ATTACK_ROLL" ? attackInput(ek, q.requestKey, natural) : q.kind === "SAVING_THROW" ? saveInput(ek, q.requestKey, natural) : choiceInput(ek, q.requestKey, q.kind as "SAVE_REMOVAL" | "SAVE_SELECTION", q.options![0]!)))];
        }
      }
    }
  });
});

describe("M6-WO10 C — Active Magic through M5-WO13", () => {
  it("M6-I166 a Sustained Signature Spell activates once (no second payment), consumes Concentration and pays Sustain on MAINTENANCE", T, () => {
    const w = playWorld();
    const cast = { kind: "SPELL", abilityId: WARD_ID, revisionNumber: 1, targets: [{ targetKey: "self" }], inputs: [] };
    const r = run(w.context, [...INTO_TURN, cast]);
    const c = r.outcomes[3]!;
    expect(c.status).toBe("COMMITTABLE");
    expect(c.trace.activeMagic).toMatchObject({ status: "APPLIED" });
    const effect = r.stored.runtime!.activeMagic!.effects[0]!;
    expect(effect.ability).toMatchObject({ kind: "CHARACTER_SIGNATURE_SPELL", signatureAbilityId: WARD_ID, revisionNumber: 1 });
    expect(effect.sustain).toMatchObject({ apCost: 1 });
    // Casting paid 1 AP + 7 MP (5 ME + 2 MP); ACTIVATE paid nothing further.
    expect([current(r.stored, "AP"), current(r.stored, "ME"), current(r.stored, "MP")]).toEqual([4, 0, 5]);
    expect(buildPlayWorkspace(w.context, r.stored).concentration).toMatchObject({ used: 1 });
    const m = run(w.context, [{ kind: "ACTIVE_MAGIC", event: "MAINTENANCE" }], r.stored);
    expect(m.outcomes[0]!.status).toBe("COMMITTABLE");
    expect(current(m.stored, "AP")).toBe(3);
    expect(m.stored.runtime!.activeMagic!.effects[0]!.sustain!.lastPayment).not.toBeNull();
  });

  it("M6-I166 Sustained Effects are dismissed by the pinned rule; ending releases the slot; history is kept", T, () => {
    const w = playWorld();
    const r = run(w.context, [...INTO_TURN, { kind: "SPELL", abilityId: WARD_ID, revisionNumber: 1, targets: [{ targetKey: "self" }], inputs: [] }]);
    const key = r.stored.runtime!.activeMagic!.effects[0]!.activeEffectKey;
    const d = run(w.context, [{ kind: "ACTIVE_MAGIC", event: "DISMISS", activeEffectKey: key }, { kind: "ACTIVE_MAGIC", event: "DISMISS", activeEffectKey: key }], r.stored);
    expect(d.outcomes.map((o) => o.status)).toEqual(["COMMITTABLE", "REFUSED"]);
    expect(d.stored.runtime!.activeMagic!.effects[0]).toMatchObject({ status: "ENDED", endReason: "DISMISSED" });
    expect(buildPlayWorkspace(w.context, d.stored).concentration).toMatchObject({ used: 0 });
  });

  it("M6-I166 ROUNDS durations tick down only at explicit END_ROUND and expire; END_COMBAT ends only Combat-duration Effects", T, () => {
    const ctx = extraSpells();
    const pending = run(ctx, [...INTO_TURN, { kind: "SPELL", abilityId: HEX, revisionNumber: 1, targets: [{ targetKey: "ogre" }], inputs: [] }]).outcomes[3]!;
    const requestKey = pending.pending[0]!.requestKey as string;
    const defender = { level: 1, stats: { STR: 3, AGI: 3, CON: 3, PER: 3, RES: 3, PRO: 3 } };
    const r = run(ctx, [...INTO_TURN, { kind: "SPELL", abilityId: HEX, revisionNumber: 1, targets: [{ targetKey: "ogre" }], inputs: [{ requestKey, kind: "SAVING_THROW", roll: roll(1), defender }] }, { kind: "TIMING", event: "END_TURN" }, { kind: "TIMING", event: "END_ROUND" }]);
    expect(r.stored.runtime!.activeMagic!.effects[0]!.duration.remainingRounds).toBe(1);
    const e = run(ctx, [{ kind: "TIMING", event: "START_ROUND" }, { kind: "TIMING", event: "END_ROUND" }], r.stored);
    expect(e.stored.runtime!.activeMagic!.effects[0]).toMatchObject({ status: "ENDED", endReason: "EXPIRED" });
  });

  it("M6-I166 Concentration test: no roll holds a pending decision; a failed Save ends the disrupted Effect; success changes nothing", T, () => {
    const w = playWorld();
    const r = run(w.context, [...INTO_TURN, { kind: "SPELL", abilityId: WARD_ID, revisionNumber: 1, targets: [{ targetKey: "self" }], inputs: [] }]);
    const key = r.stored.runtime!.activeMagic!.effects[0]!.activeEffectKey;
    const p = run(w.context, [{ kind: "ACTIVE_MAGIC", event: "CONCENTRATION_TEST", trigger: "TAKES_DAMAGE", target: key }, { kind: "GENERAL_ACTION", actionKey: "MOVE" }, { kind: "ACTIVE_MAGIC", event: "DISMISS", activeEffectKey: key }], r.stored);
    expect(p.outcomes[0]!.pending[0]).toMatchObject({ kind: "CONCENTRATION_SAVE" });
    expect(buildPlayWorkspace(w.context, p.stored).activeMagic.pendingDecision).toBe("CONCENTRATION_SAVE");
    expect(p.outcomes[2]!.reasons[0]!.code).toBe("PLAY.PENDING_DECISION");
    const fail = run(w.context, [{ kind: "ACTIVE_MAGIC", event: "CONCENTRATION_TEST", trigger: "TAKES_DAMAGE", target: key, roll: roll(1) }], p.stored);
    expect(fail.stored.runtime!.activeMagic!.effects[0]).toMatchObject({ status: "ENDED", endReason: "CONCENTRATION_FAILED" });
    const pass = run(w.context, [{ kind: "ACTIVE_MAGIC", event: "CONCENTRATION_TEST", trigger: "TAKES_DAMAGE", target: key, roll: roll(8) }], r.stored);
    expect(pass.stored.runtime!.activeMagic!.effects[0]).toMatchObject({ status: "ACTIVE" });
  });

  it("M6-I166 Channeling: AP is invested through WO3; completion leaves the MP payment UNRESOLVED (M5-SC-053); stop refunds nothing", T, () => {
    const w = playWorld();
    const r = run(w.context, [...INTO_TURN, { kind: "ACTIVE_MAGIC", event: "CHANNEL_START", abilityId: EMBER_ID, revisionNumber: 1 }, { kind: "ACTIVE_MAGIC", event: "CHANNEL_INVEST", amount: 1 }]);
    expect(r.outcomes.slice(3).map((o) => o.status)).toEqual(["COMMITTABLE", "COMMITTABLE"]);
    expect(r.stored.runtime!.activeMagic!.channel).toMatchObject({ investedAp: 1, mpPayment: { status: "UNRESOLVED", conflictKey: "M5-SC-053" } });
    const done = run(w.context, [{ kind: "ACTIVE_MAGIC", event: "CHANNEL_INVEST", amount: 1 }], r.stored);
    expect(done.outcomes[0]!.summary).toMatch(/M5-SC-053/);
    expect(current(done.stored, "MP")).toBe(7);
    const stop = run(w.context, [{ kind: "ACTIVE_MAGIC", event: "CHANNEL_STOP" }], r.stored);
    expect(stop.stored.runtime!.activeMagic!.channel).toBeNull();
    expect(current(stop.stored, "AP")).toBe(4);
  });

  it("M6-I171 with no adapter, WO13 refuses a Character Spell identity; the canonical transition is unchanged", T, () => {
    const f = activeMagicFixture();
    const req = { contractVersion: 1, definitions: f.bundle, ruleset: f.ruleset, caster: caster(), casterKey: "caster.1", resources: pool({ HP: 10, MP: 20, ME: 4, AP: 3 }), state: null, event: { kind: "ACTIVATE", activeEffectKey: "ae.1", ability: f.ability("fixture.wo13.spell.sustained") } };
    expect(transitionActiveMagicWith(req, null)).toEqual(transitionActiveMagic(req));
    const forged = { ...req, event: { kind: "ROUND_END" }, state: { contractVersion: 1, casterKey: "caster.1", rulesetProvenance: f.bundle.rulesetProvenance, channel: null, effects: [{ ...(transitionActiveMagic(req) as unknown as { value: { state: { effects: Record<string, unknown>[] } } }).value.state.effects[0], ability: { kind: "CHARACTER_SIGNATURE_SPELL", characterId: "caster.1", signatureAbilityId: "x", revisionNumber: 1, canonicalKey: "character.signature_spell.x.r1" } }] } };
    const out = transitionActiveMagic(forged);
    expect(out.ok).toBe(false);
  });
});

describe("M6-WO10 — manual adjustments, reconciliation and stored state", () => {
  it("M6-I168 a manual adjustment is validated against the sheet bounds and classified MANUAL_ADJUSTMENT (never RULES_EXECUTED)", T, () => {
    const w = playWorld();
    const r = run(w.context, [manual("HP", 9), manual("HP", 99), manual("HP", 9)]);
    expect(r.outcomes.map((o) => [o.status, o.classification])).toEqual([["COMMITTABLE", "MANUAL_ADJUSTMENT"], ["REFUSED", null], ["REFUSED", null]]);
    expect(r.outcomes[0]!.inputs).toMatchObject({ before: 15, after: 9, source: "PLAYER_GM_PROVIDED" });
    expect(r.outcomes[0]!.summary).toMatch(/not calculated by the rules engine/);
  });

  it("M6-I152 an advancement while Active Magic is held requires explicit reconciliation; nothing is silently reinterpreted", T, () => {
    const w = playWorld();
    const r = run(w.context, [...INTO_TURN, { kind: "SPELL", abilityId: WARD_ID, revisionNumber: 1, targets: [{ targetKey: "self" }], inputs: [] }]);
    const advanced = w.withAdvancement(w.context.advancementCount + 1);
    const blocked = evaluatePlayOperation(advanced, r.stored, { kind: "ACTIVE_MAGIC", event: "MAINTENANCE" });
    expect(blocked.status).toBe("RECONCILIATION_REQUIRED");
    expect(buildPlayWorkspace(advanced, r.stored).reconciliation.required).toBe(true);
    const ok = evaluatePlayOperation(advanced, r.stored, { kind: "RECONCILE" });
    expect(ok.status).toBe("COMMITTABLE");
    expect(ok.runtimeAfter!.advancementCount).toBe(advanced.advancementCount);
    expect(ok.runtimeAfter!.activeMagic).toEqual(r.stored.runtime!.activeMagic);
  });

  it("M6-I152 a stored state of another Release is never reinterpreted", T, () => {
    const w = playWorld();
    const r = run(w.context, INTO_TURN);
    const other = { ...r.stored, runtime: { ...r.stored.runtime!, releaseId: "00000000-0000-4000-8000-0000000e9999" } };
    expect(evaluatePlayOperation(w.context, other, { kind: "TIMING", event: "END_TURN" }).status).toBe("RECONCILIATION_REQUIRED");
    expect(buildPlayWorkspace(w.context, other).timing.legal).toEqual([]);
  });

  it("M6-I169 the stored runtime reads back exactly (closed contract) and a malformed one is refused, never repaired", T, () => {
    const w = playWorld();
    const r = run(w.context, INTO_TURN);
    const back = readPlayRuntimeState(JSON.parse(JSON.stringify(r.stored.runtime)), { characterId: w.context.characterId });
    expect(back).toEqual({ ok: true, state: r.stored.runtime });
    expect(readPlayRuntimeState({ ...r.stored.runtime, extra: 1 }, { characterId: w.context.characterId }).ok).toBe(false);
    expect(readPlayRuntimeState({ ...r.stored.runtime, movementAllowance: -1 }, { characterId: w.context.characterId }).ok).toBe(false);
  });
});
