import { describe, expect, it } from "vitest";
import { ChangeSetImpactCollector, CHANGE_SET_IMPACT_CATEGORIES, type ChangeSetImpactReason } from "./change-set-impact.js";
import { CHANGE_SET_OPERATION_TYPES, isChangeSetOperationType, MANIFEST_COMPOSITION_OPERATION_TYPES } from "./change-set-operation-type.js";
import { CHANGE_SET_STATUSES, INITIAL_CHANGE_SET_STATUS, isChangeSetStatus } from "./change-set-status.js";
import { translateDecisionToOperations, type DecisionTranslationFacts } from "./change-set-translation.js";
import {
  CHANGE_SET_OPERATION_RULES,
  MAX_CHANGE_SET_OPERATIONS,
  validateCreateChangeSetInput,
  type CreateChangeSetInput,
  type CreateChangeSetOperationInput,
} from "./change-set.js";
import { CHANGE_SET_ERROR_CODES } from "./errors.js";
import { ChangeSetId, ChangeSetOperationId, type ChangeSetOperationId as OpId } from "./ids.js";

const E = "11111111-1111-4111-8111-111111111111";
const E2 = "12121212-1212-4212-8212-121212121212";
const V1 = "22222222-2222-4222-8222-222222222222";
const V2 = "33333333-3333-4333-8333-333333333333";
const M = "44444444-4444-4444-8444-444444444444";
const D = "55555555-5555-4555-8555-555555555555";
const P = "66666666-6666-4666-8666-666666666666";
const cs = (operations: CreateChangeSetOperationInput[], over: Partial<CreateChangeSetInput> = {}): CreateChangeSetInput => ({ name: "Apply errata", operations, ...over });
const kind = (operations: CreateChangeSetOperationInput[], over: Partial<CreateChangeSetInput> = {}) => validateCreateChangeSetInput(cs(operations, over))?.kind ?? null;
const valid: Record<string, CreateChangeSetOperationInput> = {
  PIN_ENTITY_VERSION: { operationType: "PIN_ENTITY_VERSION", targetEntityId: E, toEntityVersionId: V1 },
  REPLACE_ENTITY_VERSION: { operationType: "REPLACE_ENTITY_VERSION", targetEntityId: E, fromEntityVersionId: V1, toEntityVersionId: V2, targetManifestId: M },
  ADD_ENTITY_TO_MANIFEST: { operationType: "ADD_ENTITY_TO_MANIFEST", targetEntityId: E, toEntityVersionId: V1 },
  REMOVE_ENTITY_FROM_MANIFEST: { operationType: "REMOVE_ENTITY_FROM_MANIFEST", targetEntityId: E },
  CREATE_ENTITY_VERSION: { operationType: "CREATE_ENTITY_VERSION", targetEntityId: E, fromEntityVersionId: V1 },
  DEPRECATE_ENTITY_VERSION: { operationType: "DEPRECATE_ENTITY_VERSION", targetEntityId: E, fromEntityVersionId: V1 },
  NO_CHANGE: { operationType: "NO_CHANGE", targetManifestId: M, description: "nothing to do" },
};

describe("vocabularies, ids, errors (§3, §7, §37, §38)", () => {
  it("ChangeSetStatus is the five-state lifecycle and every ChangeSet starts DRAFT", () => {
    expect([...CHANGE_SET_STATUSES]).toEqual(["DRAFT", "READY_FOR_REVIEW", "APPROVED", "REJECTED", "SUPERSEDED"]);
    expect(INITIAL_CHANGE_SET_STATUS).toBe("DRAFT");
    expect(isChangeSetStatus("draft")).toBe(false);
  });
  it("ChangeSetOperationType is exactly the seven proposals; four of them compose a future manifest", () => {
    expect([...CHANGE_SET_OPERATION_TYPES]).toEqual([
      "PIN_ENTITY_VERSION",
      "REPLACE_ENTITY_VERSION",
      "ADD_ENTITY_TO_MANIFEST",
      "REMOVE_ENTITY_FROM_MANIFEST",
      "CREATE_ENTITY_VERSION",
      "DEPRECATE_ENTITY_VERSION",
      "NO_CHANGE",
    ]);
    expect([...MANIFEST_COMPOSITION_OPERATION_TYPES]).toEqual(["PIN_ENTITY_VERSION", "REPLACE_ENTITY_VERSION", "ADD_ENTITY_TO_MANIFEST", "REMOVE_ENTITY_FROM_MANIFEST"]);
    for (const t of ["APPLY", "EXECUTE", "pin_entity_version", ""]) expect(isChangeSetOperationType(t)).toBe(false);
  });
  it("ids brand without changing values; errors are exactly the twelve CHANGE_SET codes", () => {
    expect(ChangeSetId.of(E)).toBe(E);
    expect(ChangeSetOperationId.of(V1)).toBe(V1);
    // M2-WO8 added INVALID_STATUS_TRANSITION for the review lifecycle (13 codes).
    expect(Object.keys(CHANGE_SET_ERROR_CODES)).toHaveLength(13);
    for (const [key, code] of Object.entries(CHANGE_SET_ERROR_CODES)) expect(code).toBe(`CHANGE_SET.${key}`);
    expect(Object.keys(CHANGE_SET_ERROR_CODES).filter((k) => /APPLY|EXECUTE|PUBLISH/.test(k))).toEqual([]);
  });
});

describe("the operation matrix (§8)", () => {
  it.each(Object.entries(valid))("accepts a minimal valid %s", (_type, op) => {
    expect(kind([op])).toBeNull();
  });

  it("the matrix is exactly as specified", () => {
    expect(CHANGE_SET_OPERATION_RULES).toEqual({
      PIN_ENTITY_VERSION: { targetEntity: "required", fromVersion: "forbidden", toVersion: "required" },
      REPLACE_ENTITY_VERSION: { targetEntity: "required", fromVersion: "required", toVersion: "required" },
      ADD_ENTITY_TO_MANIFEST: { targetEntity: "required", fromVersion: "forbidden", toVersion: "required" },
      REMOVE_ENTITY_FROM_MANIFEST: { targetEntity: "required", fromVersion: "optional", toVersion: "forbidden" },
      CREATE_ENTITY_VERSION: { targetEntity: "required", fromVersion: "optional", toVersion: "forbidden" },
      DEPRECATE_ENTITY_VERSION: { targetEntity: "required", fromVersion: "required", toVersion: "forbidden" },
      NO_CHANGE: { targetEntity: "forbidden", fromVersion: "forbidden", toVersion: "forbidden" },
    });
  });

  it("every required field is enforced and every forbidden field rejected, for every type", () => {
    for (const type of CHANGE_SET_OPERATION_TYPES) {
      const rules = CHANGE_SET_OPERATION_RULES[type];
      const fields = { targetEntity: "targetEntityId", fromVersion: "fromEntityVersionId", toVersion: "toEntityVersionId" } as const;
      for (const [rule, field] of Object.entries(fields) as Array<[keyof typeof fields, (typeof fields)[keyof typeof fields]]>) {
        const base = { ...valid[type]! };
        if (rules[rule] === "required") {
          delete base[field];
          expect(kind([base]), `${type} without ${field}`).toBe("INVALID_OPERATION");
        }
        if (rules[rule] === "forbidden") {
          expect(kind([{ ...valid[type]!, [field]: field === "targetEntityId" ? E : V2 }]), `${type} with ${field}`).toBe("INVALID_OPERATION");
        }
      }
    }
  });

  it.each([
    ["REPLACE with from = to (case-insensitive)", { operationType: "REPLACE_ENTITY_VERSION", targetEntityId: E, fromEntityVersionId: V1, toEntityVersionId: ` ${V1.toUpperCase()}` }],
    ["an unknown type", { operationType: "APPLY_MANIFEST", targetEntityId: E }],
    ["a blank id", { operationType: "PIN_ENTITY_VERSION", targetEntityId: E, toEntityVersionId: "  " }],
    ["a blank manifest id", { operationType: "PIN_ENTITY_VERSION", targetEntityId: E, toEntityVersionId: V1, targetManifestId: "" }],
    ["a non-string description", { operationType: "NO_CHANGE", description: 4 }],
    ["NO_CHANGE carrying an Entity", { operationType: "NO_CHANGE", targetEntityId: E }],
  ])("rejects %s as INVALID_OPERATION", (_name, op) => {
    expect(kind([op as CreateChangeSetOperationInput])).toBe("INVALID_OPERATION");
  });
});

describe("ChangeSet-level rules (§12–§14)", () => {
  it("requires 1..100 operations and a non-blank name", () => {
    expect(kind([])).toBe("INVALID_INPUT");
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ operationType: "CREATE_ENTITY_VERSION", targetEntityId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` }));
    expect(kind(many(MAX_CHANGE_SET_OPERATIONS))).toBeNull();
    expect(kind(many(MAX_CHANGE_SET_OPERATIONS + 1))).toBe("INVALID_INPUT");
    expect(kind([valid.NO_CHANGE!], { name: " " })).toBe("INVALID_INPUT");
    expect(kind([valid.NO_CHANGE!], { canonDecisionId: "" })).toBe("INVALID_INPUT");
    expect(validateCreateChangeSetInput(null as unknown as CreateChangeSetInput)?.kind).toBe("INVALID_INPUT");
  });

  it.each([
    ["two REPLACEs for one Entity", [valid.REPLACE_ENTITY_VERSION!, { ...valid.REPLACE_ENTITY_VERSION!, toEntityVersionId: V1, fromEntityVersionId: V2 }]],
    ["REMOVE + ADD for one Entity", [valid.REMOVE_ENTITY_FROM_MANIFEST!, valid.ADD_ENTITY_TO_MANIFEST!]],
    ["PINs of different Versions", [valid.PIN_ENTITY_VERSION!, { ...valid.PIN_ENTITY_VERSION!, toEntityVersionId: V2 }]],
    ["the same PIN twice", [valid.PIN_ENTITY_VERSION!, { ...valid.PIN_ENTITY_VERSION!, targetEntityId: E.toUpperCase() }]],
    ["PIN + REPLACE for one Entity", [valid.PIN_ENTITY_VERSION!, valid.REPLACE_ENTITY_VERSION!]],
    ["NO_CHANGE mixed with a change", [valid.NO_CHANGE!, valid.CREATE_ENTITY_VERSION!]],
    ["two NO_CHANGEs", [valid.NO_CHANGE!, valid.NO_CHANGE!]],
    ["the same DEPRECATE twice", [valid.DEPRECATE_ENTITY_VERSION!, valid.DEPRECATE_ENTITY_VERSION!]],
    ["the same CREATE twice", [valid.CREATE_ENTITY_VERSION!, valid.CREATE_ENTITY_VERSION!]],
    ["deprecating the Version being pinned", [valid.PIN_ENTITY_VERSION!, valid.DEPRECATE_ENTITY_VERSION!]],
  ])("rejects %s as OPERATION_CONFLICT", (_name, ops) => {
    expect(kind(ops as CreateChangeSetOperationInput[])).toBe("OPERATION_CONFLICT");
  });

  it("accepts coexisting operations that do not contradict", () => {
    expect(
      kind([
        valid.REPLACE_ENTITY_VERSION!,
        { operationType: "DEPRECATE_ENTITY_VERSION", targetEntityId: E, fromEntityVersionId: V1 }, // deprecate the version being replaced AWAY from
        { operationType: "CREATE_ENTITY_VERSION", targetEntityId: E, fromEntityVersionId: V2 },
        { operationType: "PIN_ENTITY_VERSION", targetEntityId: E2, toEntityVersionId: "77777777-7777-4777-8777-777777777777" }, // another Entity
      ]),
    ).toBeNull();
  });
});

describe("translateDecisionToOperations (§15–§21)", () => {
  const facts = (over: Partial<DecisionTranslationFacts>): DecisionTranslationFacts => ({
    decisionId: D,
    decisionType: "SELECT_RULE",
    conflictDisposition: "RESOLVED",
    entityId: E,
    chosenEntityVersionId: V1,
    targetManifestId: M,
    effective: null,
    ...over,
  });
  const only = (over: Partial<DecisionTranslationFacts>) => {
    const ops = translateDecisionToOperations(facts(over));
    expect(ops).toHaveLength(1);
    return ops[0]!;
  };

  it("SELECT_RULE: no effective pin -> ADD; same pin -> NO_CHANGE; other pin -> REPLACE; no manifest -> PIN (§16)", () => {
    expect(only({})).toMatchObject({ operationType: "ADD_ENTITY_TO_MANIFEST", targetEntityId: E, toEntityVersionId: V1, targetManifestId: M });
    expect(only({ effective: { entityVersionId: V1, resolvedFromManifestId: M, source: "EXPLICIT" } })).toMatchObject({ operationType: "NO_CHANGE", targetManifestId: M });
    expect(only({ effective: { entityVersionId: V2, resolvedFromManifestId: M, source: "EXPLICIT" } })).toMatchObject({
      operationType: "REPLACE_ENTITY_VERSION",
      fromEntityVersionId: V2,
      toEntityVersionId: V1,
      targetManifestId: M,
    });
    expect(only({ targetManifestId: null })).toMatchObject({ operationType: "PIN_ENTITY_VERSION", targetEntityId: E, toEntityVersionId: V1 });
  });

  it("MERGE uses the same mapping with its result Version (§17)", () => {
    expect(only({ decisionType: "MERGE", chosenEntityVersionId: V2, effective: { entityVersionId: V1, resolvedFromManifestId: M, source: "EXPLICIT" } })).toMatchObject({
      operationType: "REPLACE_ENTITY_VERSION",
      fromEntityVersionId: V1,
      toEntityVersionId: V2,
    });
  });

  it("an INHERITED pin becomes a REPLACE targeting the child manifest, and says the parent is unchanged (§21)", () => {
    const op = only({ effective: { entityVersionId: V2, resolvedFromManifestId: P, source: "INHERITED" } });
    expect(op).toMatchObject({ operationType: "REPLACE_ENTITY_VERSION", targetManifestId: M, fromEntityVersionId: V2 });
    expect(op.description).toMatch(/INHERITED from manifest .*parent is unchanged/);
  });

  it.each([
    ["KEEP_SEPARATE", { decisionType: "KEEP_SEPARATE", conflictDisposition: "ACCEPTED_DIVERGENCE", chosenEntityVersionId: null }],
    ["RESOLVE_CONFLICT + DISMISSED", { decisionType: "RESOLVE_CONFLICT", conflictDisposition: "DISMISSED", chosenEntityVersionId: null }],
    ["RESOLVE_CONFLICT + RESOLVED (even with a version fact)", { decisionType: "RESOLVE_CONFLICT", chosenEntityVersionId: V1 }],
    ["SELECT_RULE with no chosen Version", { chosenEntityVersionId: null }],
  ])("%s -> NO_CHANGE, never an inferred winner (§18–§20)", (_name, over) => {
    const op = only(over as Partial<DecisionTranslationFacts>);
    expect(op.operationType).toBe("NO_CHANGE");
    expect(op.targetEntityId ?? null).toBeNull();
    expect(validateCreateChangeSetInput({ name: "x", operations: [op] })).toBeNull(); // translation output always validates
  });

  it("is deterministic", () => {
    expect(translateDecisionToOperations(facts({}))).toEqual(translateDecisionToOperations(facts({})));
  });
});

describe("ChangeSetImpactCollector (§31–§33)", () => {
  const r = (sequence: number | null, reason: string, relationshipType: string | null = null): ChangeSetImpactReason => ({
    sourceOperationId: sequence === null ? null : (`op-${sequence}` as unknown as OpId),
    sequence,
    reason,
    relationshipType,
  });

  it("keeps one item per (category, resource) with every distinct reason, in a stable order regardless of insertion order", () => {
    const build = (order: number[]) => {
      const c = new ChangeSetImpactCollector();
      const adds: Array<() => void> = [
        () => c.add("CANON_GOVERNANCE", "CANON_DECISION", "d", r(null, "linked")),
        () => c.add("DIRECT_ENTITY", "ENTITY", "b", r(2, "target of 2")),
        () => c.add("DIRECT_ENTITY", "ENTITY", "a", r(1, "target of 1")),
        () => c.add("DIRECT_ENTITY", "ENTITY", "a", r(3, "target of 3")),
        () => c.add("DIRECT_ENTITY", "ENTITY", "a", r(1, "target of 1")), // exact duplicate path: collapsed
        () => c.add("RELATIONSHIP_DEPENDENT_ENTITY", "ENTITY", "a", r(2, "neighbour", "REQUIRES")),
        () => c.add("MANIFEST", "RULESET", "z", r(1, "owner")),
        () => c.add("MANIFEST", "RULESET_MANIFEST", "z", r(1, "analyzed")),
      ];
      for (const i of order) adds[i]!();
      return c.toItems();
    };
    const forward = build([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(build([7, 6, 5, 4, 3, 2, 1, 0])).toEqual(forward);
    expect(forward.map((i) => `${i.category}/${i.resourceType}/${i.resourceId}:${i.reasons.length}`)).toEqual([
      "DIRECT_ENTITY/ENTITY/a:2",
      "DIRECT_ENTITY/ENTITY/b:1",
      "MANIFEST/RULESET/z:1",
      "MANIFEST/RULESET_MANIFEST/z:1",
      "RELATIONSHIP_DEPENDENT_ENTITY/ENTITY/a:1",
      "CANON_GOVERNANCE/CANON_DECISION/d:1",
    ]);
    expect(forward[0]!.reasons.map((x) => x.sequence)).toEqual([1, 3]);
    expect(CHANGE_SET_IMPACT_CATEGORIES).toHaveLength(8);
  });
});
