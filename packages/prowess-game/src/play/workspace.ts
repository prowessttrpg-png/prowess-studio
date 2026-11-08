import { transitionActiveMagicWith } from "../ability/active-magic.js";
import { buildActionDirectory } from "../card/action.js";
import { attackCardKey } from "../card/equipment.js";
import { clonePlainData, deepFreeze } from "../internal/plain-data.js";
import { indexRuntimeDefinitions } from "../runtime/definitions.js";
import { characterSpellAdapter, evaluateManeuverSource, evaluateSpellSource, signatureSourceKey } from "./abilities.js";
import { PLAY_CONTRACT_VERSION, PLAY_REASON_CODES as R, type PlayAvailability, type PlayReason, type PlayRuntimeState } from "./contract.js";
import { attackCosts, attackResolutionSupport, attacksOf, evaluatePlayOperation, initialPlayRuntime, legalTimingEvents, pendingDecisionOf, previewCosts, RUNTIME_HELD_RESOURCES, runtimeResourcesOf, SPELL_CASTING_ME_ELIGIBLE, type PlayContext, type PlayStored } from "./operations.js";

/**
 * PAS-10 M6-WO10 — the Play Workspace READ model. Every value is copied from an existing authority: the sheet mechanics
 * (M6-WO5), the Release's RESOURCE / ACTION Definitions (M5-WO3), the General Action cards (M6-WO9), the Attack Library
 * (M6-WO6), the Signature Spell / Maneuver evaluations (M6-WO7 / WO8 over M5-WO10 / WO11) and the Active Magic state
 * (M5-WO13). Availability is the runtime engine's own verdict on a payment preview — never a client comparison. Pure; it
 * writes nothing and never advances time.
 */
const spellCardKey = (abilityId: string, revisionNumber: number) => `SIGNATURE_SPELL:${abilityId}:${String(revisionNumber)}`;
const maneuverCardKey = (abilityId: string, revisionNumber: number) => `SIGNATURE_MANEUVER:${abilityId}:${String(revisionNumber)}`;

const availabilityOf = (status: string, reasons: readonly PlayReason[]): PlayAvailability => {
  if (status === "COMMITTABLE") return "AVAILABLE";
  if (status === "PENDING_INPUT") return "PENDING_INPUT";
  if (status === "UNSUPPORTED") return "UNSUPPORTED";
  return reasons.some((r) => r.code === R.INSUFFICIENT_RESOURCES) ? "INSUFFICIENT_RESOURCES" : "UNAVAILABLE";
};

export function buildPlayWorkspace(ctx: PlayContext, stored: PlayStored) {
  const runtime: PlayRuntimeState = stored.runtime ?? initialPlayRuntime(ctx);
  const index = indexRuntimeDefinitions(ctx.bundle);
  const resources = index.ok ? runtimeResourcesOf(ctx, stored, runtime, index.value) : { resources: [] };
  const name = (ref: { entityVersionId: string; canonicalKey: string }) => ctx.names[ref.entityVersionId] ?? ref.canonicalKey;
  const sameIdentity = runtime.releaseId === ctx.releaseId && runtime.characterId === ctx.characterId;
  const reconciliation: PlayReason[] = [
    ...(sameIdentity ? [] : [{ code: R.RELEASE_MISMATCH, message: "the stored play state belongs to another Release; it is never reinterpreted" }]),
    ...(runtime.advancementCount !== ctx.advancementCount && (runtime.activeMagic?.effects.some((e) => e.status !== "ENDED") === true || runtime.activeMagic?.channel != null) ? [{ code: R.RECONCILIATION_REQUIRED, message: "the Character advanced while Active Magic is held — acknowledge it before further play" }] : []),
  ];
  const window = runtime.combat.turn === "ACTIVE" && runtime.combat.phase === "ROUND" ? "OWN_TURN" : "OUTSIDE_OWN_TURN";

  // ---- resources (exact current, the sheet's derived maximum, reserved capacity, authored timing) ----
  const resourceRows = resources.resources.map((r) => {
    const d = index.ok ? index.value.resources[r.resourceKey] : undefined;
    const sheet = ctx.mechanics.resources.find((x) => x.resourceKey === r.resourceKey) ?? null;
    return {
      resourceKey: r.resourceKey,
      definition: d?.ref ?? null,
      name: d === undefined ? r.resourceKey : name(d.ref),
      current: r.current,
      minimum: d?.payload.minimum ?? null,
      maximum: sheet?.maximum ?? null,
      reservedCapacity: r.reservedCapacity,
      stored: RUNTIME_HELD_RESOURCES[r.resourceKey] !== undefined ? stored.runtime !== null : stored.sheetResources?.some((x) => x.resourceKey === r.resourceKey) === true,
      refresh: d?.payload.refresh.map((x) => ({ timing: x.timing, target: x.target })) ?? [],
      expiry: d?.payload.expiry.map((x) => ({ timing: x.timing, preservable: x.preservableByExplicitRule })) ?? [],
      runtimeOnly: sheet === null,
    };
  });

  // ---- Concentration (M5-WO13's own M4 Formulas; a read-only TIMING probe never changes state) ----
  let concentration: { capacity: number; used: number; dc: number | null } | { unavailable: string } = { unavailable: "the Release pins no active-magic policy" };
  if (pendingDecisionOf(runtime.activeMagic) === null) {
    const probe = transitionActiveMagicWith({ contractVersion: 1, definitions: ctx.bundle, ruleset: ctx.ruleset, caster: ctx.casterCore, casterKey: ctx.characterId, resources, state: runtime.activeMagic, event: { kind: "TIMING", timing: "ON_ROUND_START" } }, characterSpellAdapter(ctx));
    if (probe.ok) concentration = { capacity: probe.value.inspector.concentration.capacity, used: probe.value.inspector.concentration.used, dc: probe.value.inspector.concentration.dc };
    else concentration = { unavailable: probe.problems.map((q) => q.message).slice(0, 2).join("; ") };
  } else concentration = { unavailable: "a held Active Magic decision is pending; resolve it first" };

  // ---- General Actions and Counter Actions: the M6-WO9 cards + the engine's verdict on a payment preview ----
  const directory = buildActionDirectory({ bundle: ctx.bundle, profile: ctx.equippedProfile, context: { characterId: ctx.characterId, characterReleaseId: ctx.releaseId, rulesetProvenance: ctx.bundle.rulesetProvenance, names: ctx.names } });
  const actions = directory.cards.map((card) => {
    const a = card.section;
    const d = index.ok ? index.value.actions[a.actionKey] : undefined;
    const model = d?.payload.actionPointCost.model ?? null;
    const probe = model === "FIXED" || model === "NONE" ? evaluatePlayOperation(ctx, stored, { kind: "GENERAL_ACTION", actionKey: a.actionKey }) : null;
    const pending = model === "RANGE" || model === "MINIMUM" ? { status: "PENDING_INPUT", reasons: [{ code: R.COST_CHOICE_REQUIRED, message: "choose the AP cost when using it" }] } : null;
    const variable = model === "VARIABLE" ? { status: "UNSUPPORTED", reasons: [{ code: R.COST_UNRESOLVED, message: d?.payload.actionPointCost.model === "VARIABLE" && d.payload.actionPointCost.determinedBy === "SPELL" ? "set by the Spell it casts — use the Spells tab" : "set by the system it is used for; not priced here" }] } : null;
    const verdict = probe ?? pending ?? variable ?? { status: "UNSUPPORTED", reasons: [] };
    return {
      cardKey: card.cardKey,
      category: a.timing === "OUTSIDE_OWN_TURN" ? ("COUNTER" as const) : ("GENERAL" as const),
      actionKey: a.actionKey,
      action: a.action,
      name: card.name,
      timing: a.timing,
      requiresTrigger: a.requiresTrigger,
      costModel: d === undefined ? null : clonePlainData(d.payload.actionPointCost),
      ap: clonePlainData(card.costs.ap),
      otherCosts: a.otherCosts,
      grantsMovement: a.movementGrant !== null,
      availability: verdict.status === "PENDING_INPUT" && verdict.reasons.some((r) => r.code === R.TRIGGER_REQUIRED) ? ("PENDING_INPUT" as PlayAvailability) : availabilityOf(verdict.status, verdict.reasons),
      reasons: verdict.reasons,
    };
  });

  // ---- Weapon Attacks (M6-WO6, the sheet's library) ----
  const attacks = attacksOf(ctx.attackLibrary).map((at) => {
    const { weapon: weaponRef, attack: attackRef } = at;
    const costs = attackCosts(at);
    const support = attackResolutionSupport(at);
    const preview = support.supported && at.eligibility === "ELIGIBLE" ? previewCosts(ctx, stored, costs, "play.preview.attack") : null;
    const timingReason = window !== "OWN_TURN" ? [{ code: R.WRONG_TIMING_WINDOW, message: "Attacks are made on the Character's own turn" }] : [];
    const availability: PlayAvailability = !support.supported ? "REFERENCE_ONLY" : at.eligibility !== "ELIGIBLE" ? "UNAVAILABLE" : timingReason.length ? "UNAVAILABLE" : preview?.canPay ? "AVAILABLE" : "INSUFFICIENT_RESOURCES";
    return {
      cardKey: attackCardKey(at.hand, weaponRef, attackRef),
      attackKey: at.attackKey,
      hand: at.hand,
      weapon: weaponRef,
      attack: attackRef,
      name: `${name(weaponRef)} — ${name(attackRef)}`,
      grip: at.grip,
      costs: { ap: costs.ap.kind === "SPEND" ? costs.ap.amount : null, mp: costs.mp?.amount ?? 0 },
      damage: at.damage.map((x) => ({ profileKey: x.profileKey, damageType: x.damageType, status: x.status, final: x.final, reason: x.reason })),
      range: at.range,
      resolution: at.resolution,
      requirements: at.requirements,
      eligibility: at.eligibility,
      notExecuted: at.notExecuted,
      support,
      availability,
      reasons: [...(support.reason === null ? [] : [{ code: R.RESOLUTION_UNSUPPORTED, message: support.reason }]), ...timingReason, ...(preview?.reasons ?? [])],
    };
  });

  // ---- Signature Spells (current revisions; the M6-WO7 evaluation) ----
  const spells = ctx.spells
    .filter((s) => s.status === "ACTIVE" && s.revisionNumber !== null)
    .map((s) => {
      const rev = s.revisionNumber as number;
      const otherRelease = s.revisionReleaseId !== ctx.releaseId;
      const e = otherRelease ? null : evaluateSpellSource(ctx, s);
      const ev = e?.evaluation ?? null;
      const duration = ev?.authored?.durationConditions?.duration ?? null;
      const costs = ev?.cost ? { finalApCost: ev.cost.ap.finalApCost, finalMpCost: ev.cost.finalMpCost } : null;
      const executable = ev !== null && ev.state === "VALID" && e?.compiled !== null && costs !== null;
      const label = signatureSourceKey("spell", s.abilityId, rev);
      const cast = index.ok ? Object.values(index.value.actions).find((a) => a.payload.actionPointCost.model === "VARIABLE" && a.payload.actionPointCost.determinedBy === "SPELL") : undefined;
      const preview = executable && cast !== undefined && costs !== null ? previewCosts(ctx, stored, { ap: { kind: "ACTION", subject: { subjectKey: "play.preview.spell", actionKey: cast.payload.actionKey, window: "OWN_TURN", actionPointCost: costs.finalApCost, costSourceKey: label } }, mp: { amount: costs.finalMpCost, meEligible: SPELL_CASTING_ME_ELIGIBLE, sourceKey: label } }, "play.preview.spell") : null;
      const reasons: PlayReason[] = [
        ...(otherRelease ? [{ code: R.RELEASE_MISMATCH, message: "this revision is pinned to another Release" }] : []),
        ...(ev !== null && ev.state === "VALID_WITH_RUNTIME_DEFERRED" ? ev.runtime.deferred.map((d) => ({ code: R.RESOLUTION_UNSUPPORTED, message: `${d.conflictKey}: ${d.message}` })) : []),
        ...(ev !== null && (ev.state === "INVALID" || ev.state === "INCOMPLETE") ? ev.issues.slice(0, 3).map((i) => ({ code: R.ABILITY_NOT_EXECUTABLE, message: i.message })) : []),
        ...(window !== "OWN_TURN" ? [{ code: R.WRONG_TIMING_WINDOW, message: "Spells are cast on the Character's own turn" }] : []),
        ...(preview?.reasons ?? []),
      ];
      const availability: PlayAvailability = !executable ? (ev !== null && ev.state === "VALID_WITH_RUNTIME_DEFERRED" ? "REFERENCE_ONLY" : "UNAVAILABLE") : window !== "OWN_TURN" ? "UNAVAILABLE" : preview?.canPay ? "PENDING_INPUT" : "INSUFFICIENT_RESOURCES";
      return {
        cardKey: spellCardKey(s.abilityId, rev),
        abilityId: s.abilityId,
        revisionNumber: rev,
        name: s.name,
        state: ev?.state ?? "UNAVAILABLE",
        costs,
        meEligible: SPELL_CASTING_ME_ELIGIBLE,
        keywords: ev?.keywords ?? [],
        targetLimit: e?.compiled?.plan.targetLimit ?? null,
        delivery: e?.compiled?.plan.delivery ?? null,
        chain: e?.compiled?.plan.chain === null || e?.compiled == null ? null : { start: e.compiled.plan.chain.start, nodes: e.compiled.plan.chain.nodes.map((n) => ({ effectKey: n.effectKey, definition: n.definition, family: n.family, resolution: n.resolution, behavior: n.behavior, route: n.route })) },
        duration: duration === null ? null : { definition: duration.definition, mode: duration.mode, becomesActiveMagic: duration.futureRuntime.persists, sustain: duration.futureRuntime.sustain, manaLock: duration.futureRuntime.manaLock, concentration: duration.futureRuntime.concentration },
        runtime: ev?.runtime ?? null,
        availability,
        reasons,
      };
    });

  // ---- Signature Maneuvers (current revisions; the M6-WO8 evaluation over the equipped Character) ----
  const maneuvers = ctx.maneuvers
    .filter((s) => s.status === "ACTIVE" && s.revisionNumber !== null)
    .map((s) => {
      const rev = s.revisionNumber as number;
      const otherRelease = s.revisionReleaseId !== ctx.releaseId;
      const e = otherRelease ? null : evaluateManeuverSource(ctx, s);
      const ev = e?.evaluation ?? null;
      const costs = ev?.cost ? { finalApCost: ev.cost.ap.finalApCost, finalMpCost: ev.cost.mp.finalMpCost } : null;
      const executable = ev !== null && ev.state === "VALID" && e?.compiled !== null && costs !== null;
      const label = signatureSourceKey("maneuver", s.abilityId, rev);
      const preview = executable && costs !== null ? previewCosts(ctx, stored, { ap: { kind: "SPEND", amount: costs.finalApCost, sourceKey: label }, mp: costs.finalMpCost > 0 ? { amount: costs.finalMpCost, meEligible: false, sourceKey: label } : null }, "play.preview.maneuver") : null;
      const separatelyPriced = (ev?.authored?.durationConditions?.conditions ?? []).flatMap((c) => (c.preparationAp === undefined ? [] : [{ condition: c.definition, preparationAp: c.preparationAp }]));
      const reasons: PlayReason[] = [
        ...(otherRelease ? [{ code: R.RELEASE_MISMATCH, message: "this revision is pinned to another Release" }] : []),
        ...(ev?.runtimeDeferred ?? []).map((d) => ({ code: R.RESOLUTION_UNSUPPORTED, message: `${d.code}: ${d.message}` })),
        ...(ev !== null && (ev.state === "INVALID" || ev.state === "INCOMPLETE") ? ev.issues.slice(0, 3).map((i) => ({ code: R.ABILITY_NOT_EXECUTABLE, message: i.message })) : []),
        ...(window !== "OWN_TURN" ? [{ code: R.WRONG_TIMING_WINDOW, message: "Maneuvers are used on the Character's own turn" }] : []),
        ...(preview?.reasons ?? []),
      ];
      const availability: PlayAvailability = !executable ? (ev !== null && ev.state === "VALID_WITH_RUNTIME_DEFERRED" ? "REFERENCE_ONLY" : "UNAVAILABLE") : window !== "OWN_TURN" ? "UNAVAILABLE" : preview?.canPay ? "PENDING_INPUT" : "INSUFFICIENT_RESOURCES";
      return {
        cardKey: maneuverCardKey(s.abilityId, rev),
        abilityId: s.abilityId,
        revisionNumber: rev,
        name: s.name,
        state: ev?.state ?? "UNAVAILABLE",
        costs,
        groups: (e?.compiled?.plan.groups ?? []).map((g) => ({ groupKey: g.groupKey, kind: g.kind, actionKeys: g.actionKeys, attack: g.attack, resolution: g.resolution, targetLimit: g.targetLimit, effects: g.effects.map((x) => ({ effectKey: x.effectKey, definition: x.definition, family: x.family, route: x.route })) })),
        targetLimit: e?.compiled?.plan.targetLimit ?? null,
        martialRank: e?.compiled?.plan.martialRank ?? null,
        separatelyPriced,
        availability,
        reasons,
      };
    });

  return deepFreeze(
    clonePlainData({
      contractVersion: PLAY_CONTRACT_VERSION,
      character: { id: ctx.characterId, name: ctx.characterName, level: ctx.level, releaseId: ctx.releaseId },
      header: {
        characterDie: ctx.mechanics.combat.characterDie,
        characterDc: ctx.mechanics.combat.characterDc,
        accuracy: ctx.mechanics.combat.accuracy,
        dodge: ctx.mechanics.combat.dodge,
        armor: ctx.mechanics.combat.armor,
        initiative: ctx.mechanics.combat.initiative,
        movement: ctx.mechanics.combat.movement,
        range: ctx.mechanics.combat.range,
      },
      runtime,
      recorded: stored.runtime !== null,
      reconciliation: { required: reconciliation.length > 0, reasons: reconciliation },
      timing: { legal: sameIdentity ? legalTimingEvents(runtime) : [], window },
      resources: resourceRows,
      concentration,
      actions,
      attacks,
      spells,
      maneuvers,
      activeMagic: { state: runtime.activeMagic, pendingDecision: pendingDecisionOf(runtime.activeMagic) },
      terrains: index.ok ? Object.values(index.value.terrains).map((t) => ({ terrainKey: t!.payload.terrainKey, definition: t!.ref, name: name(t!.ref) })) : [],
      names: ctx.names,
    }),
  );
}

export type PlayWorkspaceView = ReturnType<typeof buildPlayWorkspace>;
