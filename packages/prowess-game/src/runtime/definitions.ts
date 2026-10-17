import type { RuleProvenance } from "@prowess/rules";
import { deepFreeze } from "../internal/plain-data.js";
import { Problems, finish, type ProwessOutcome } from "../internal/problems.js";
import type { ProwessDefinitionBundle } from "../bundle/bundle.js";
import { RUNTIME_ERROR_CODES as R } from "../definition/codes.js";
import { definitionRefOf, type ProwessDefinitionEnvelope } from "../definition/envelope.js";
import type { ActionDefinitionPayload, CreatureSizeDefinitionPayload, ResourceDefinitionPayload, TerrainDefinitionPayload } from "../definition/runtime-payload.js";
import type { CoreEntry } from "../core/definitions.js";
import { RUNTIME_RESOURCE_KEYS, type CreatureSize, type PaymentPolicy, type RuntimeResourceKey, type TerrainKind } from "../vocabulary/runtime.js";

/**
 * Role index of the exact M5-WO3 runtime Definitions in ONE bundle: one RESOURCE Definition per runtime Resource, one
 * ACTION per action key, one CREATURE_SIZE per Size, one TERRAIN per terrain kind. Two Definitions claiming one role
 * fail closed — no "first wins", no fallback Ruleset, no default content. Pure; reads nothing outside the bundle.
 */
export interface RuntimeDefinitionIndex {
  readonly resources: Readonly<Record<RuntimeResourceKey, CoreEntry<ResourceDefinitionPayload>>>;
  readonly actions: Readonly<Record<string, CoreEntry<ActionDefinitionPayload>>>;
  readonly sizes: Readonly<Partial<Record<CreatureSize, CoreEntry<CreatureSizeDefinitionPayload>>>>;
  readonly terrains: Readonly<Partial<Record<TerrainKind, CoreEntry<TerrainDefinitionPayload>>>>;
}

function entryOf<P>(bundle: ProwessDefinitionBundle, envelope: ProwessDefinitionEnvelope): CoreEntry<P> {
  return {
    ref: definitionRefOf(envelope),
    payload: envelope.payload as unknown as P,
    provenance: {
      entityId: envelope.entityId,
      entityVersionId: envelope.entityVersionId,
      canonicalKey: envelope.canonicalKey,
      rulesetId: bundle.rulesetProvenance.rulesetId,
      manifestId: bundle.rulesetProvenance.manifestId,
    } as RuleProvenance,
  };
}

export function indexRuntimeDefinitions(bundle: ProwessDefinitionBundle): ProwessOutcome<RuntimeDefinitionIndex> {
  const p = new Problems();
  const roles = new Map<string, ProwessDefinitionEnvelope[]>();
  const claim = (family: string, key: string, envelope: ProwessDefinitionEnvelope) => {
    const role = `${family}:${key}`;
    roles.set(role, [...(roles.get(role) ?? []), envelope]);
  };
  for (const envelope of bundle.definitions) {
    const payload = envelope.payload as Record<string, unknown>;
    if (envelope.definitionKind === "RESOURCE") claim("resource", String(payload.resourceKey), envelope);
    else if (envelope.definitionKind === "ACTION") claim("action", String(payload.actionKey), envelope);
    else if (envelope.definitionKind === "CREATURE_SIZE") claim("size", String(payload.sizeKey), envelope);
    else if (envelope.definitionKind === "TERRAIN") claim("terrain", String(payload.terrainKey), envelope);
  }

  const resources: Partial<Record<RuntimeResourceKey, CoreEntry<ResourceDefinitionPayload>>> = {};
  const actions: Record<string, CoreEntry<ActionDefinitionPayload>> = {};
  const sizes: Partial<Record<CreatureSize, CoreEntry<CreatureSizeDefinitionPayload>>> = {};
  const terrains: Partial<Record<TerrainKind, CoreEntry<TerrainDefinitionPayload>>> = {};
  for (const role of [...roles.keys()].sort()) {
    const found = roles.get(role) ?? [];
    if (found.length > 1) {
      p.add(R.AMBIGUOUS_RUNTIME_DEFINITION, ["definitions"], `${found.length} Definitions claim the runtime role ${role} (${found.map((e) => e.canonicalKey).join(", ")}); exactly one is required`);
      continue;
    }
    const [family, key] = role.split(":") as [string, string];
    const envelope = found[0] as ProwessDefinitionEnvelope;
    if (family === "resource") resources[key as RuntimeResourceKey] = entryOf(bundle, envelope);
    else if (family === "action") actions[key] = entryOf(bundle, envelope);
    else if (family === "size") sizes[key as CreatureSize] = entryOf(bundle, envelope);
    else terrains[key as TerrainKind] = entryOf(bundle, envelope);
  }
  for (const key of RUNTIME_RESOURCE_KEYS) {
    if (resources[key] === undefined && !roles.has(`resource:${key}`)) p.add(R.MISSING_RUNTIME_DEFINITION, ["definitions"], `the bundle has no RESOURCE Definition for ${key}`);
  }

  // A payment policy's sources are ordered explicitly: two Resources at one position of one policy is ambiguous.
  const positions = new Map<string, string[]>();
  for (const entry of Object.values(resources)) {
    for (const eligibility of entry.payload.payment) {
      const slot = `${eligibility.policy}@${String(eligibility.order)}`;
      positions.set(slot, [...(positions.get(slot) ?? []), entry.payload.resourceKey]);
    }
  }
  for (const [slot, holders] of [...positions.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (holders.length > 1) p.add(R.INCONSISTENT_RUNTIME_DEFINITIONS, ["definitions"], `payment position ${slot} is claimed by ${holders.join(", ")}; payment order must be explicit`);
  }

  return finish(p, () => deepFreeze({ resources: resources as Record<RuntimeResourceKey, CoreEntry<ResourceDefinitionPayload>>, actions, sizes, terrains }));
}

/** The Resources that pay `policy`, in their explicit authored order (M4 re-sorts by the same `order` anyway). */
export function paymentSourcesOf(index: RuntimeDefinitionIndex, policy: PaymentPolicy): { entry: CoreEntry<ResourceDefinitionPayload>; order: number }[] {
  return RUNTIME_RESOURCE_KEYS.flatMap((key) => {
    const entry = index.resources[key];
    const eligibility = entry.payload.payment.find((x) => x.policy === policy);
    return eligibility === undefined ? [] : [{ entry, order: eligibility.order }];
  }).sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
}
