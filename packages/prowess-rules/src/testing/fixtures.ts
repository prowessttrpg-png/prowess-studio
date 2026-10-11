/**
 * Small, generic, synthetic fixtures for @prowess/rules tests (PAS-10 M4-WO1 §61). Neutral keys only (`stat.power`,
 * `resource.primary`, `keyword.fire`, `rule.example`) — no game semantics are executable. Test support only; not
 * exported from the package entry point. Each call returns a FRESH object so tests can freeze or compare freely.
 */
export const IDS = {
  ruleset: "10000000-0000-4000-8000-000000000001",
  parentRuleset: "10000000-0000-4000-8000-000000000002",
  manifest: "20000000-0000-4000-8000-000000000001",
  parentManifest: "20000000-0000-4000-8000-000000000002",
  release: "30000000-0000-4000-8000-000000000001",
  entityA: "40000000-0000-4000-8000-00000000000a",
  entityB: "40000000-0000-4000-8000-00000000000b",
  versionA: "50000000-0000-4000-8000-00000000000a",
  versionB: "50000000-0000-4000-8000-00000000000b",
} as const;

export const MANIFEST_HASH = "a".repeat(64);

export function rulesetInput() {
  return {
    rulesetId: IDS.ruleset,
    manifestId: IDS.manifest,
    manifestHash: MANIFEST_HASH,
    rulesetVersionLabel: "0.1",
    release: { releaseId: IDS.release, releaseNumber: 3, versionLabel: "Example 3" },
    rules: [
      { entityId: IDS.entityB, entityVersionId: IDS.versionB, canonicalKey: "rule.example_b", entityType: "GENERIC_RULE", sourceManifestId: IDS.parentManifest, sourceRulesetId: IDS.parentRuleset },
      { entityId: IDS.entityA, entityVersionId: IDS.versionA, canonicalKey: "rule.example", entityType: "GENERIC_RULE" },
    ],
  };
}

export function actorInput() {
  return {
    actorRef: "actor-1",
    stats: { "stat.power": 4, "stat.focus": 2 },
    ranks: { "rank.example": "tier_two", "rank.numeric": 3 },
    keywords: ["keyword.fire", "keyword.air"],
    resources: { "resource.primary": 17 },
    ownedEntities: [{ entityId: IDS.entityA, entityVersionId: IDS.versionA }],
    properties: { "property.flag": true },
    tags: ["tag.example"],
  };
}

export function buildInput() {
  return {
    buildKind: "example.build",
    components: [
      { key: "component.second", reference: { entityId: IDS.entityB, entityVersionId: IDS.versionB }, parameters: { "param.size": 2 } },
      { key: "component.first", parameters: {} },
    ],
    parameters: { "param.mode": "example" },
    keywords: ["keyword.fire"],
    properties: {},
    references: [{ entityId: IDS.entityA, entityVersionId: IDS.versionA }],
  };
}

export function runtimeInput() {
  return {
    resourceValues: { "resource.primary": 9 },
    reservedCapacity: { "resource.primary": 2 },
    activeEffects: [{ key: "effect.example", properties: { "property.stacks": 1 } }],
    conditions: ["condition.example"],
    state: { "state.round": 1 },
  };
}

export function requestInput(kind = "example.noop") {
  return {
    kind,
    ruleset: rulesetInput(),
    actor: actorInput(),
    build: buildInput(),
    runtime: runtimeInput(),
    metadata: { caller: "test", purpose: "example" },
  };
}
