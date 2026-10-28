import type { EntityType, JsonObject } from "@prowess/model";
import type { ResolvedRuleReference, RulesetContext } from "@prowess/rules";
import { clonePlainData, deepFreeze, isPlainObject, type PathSegment } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, own, readRecord, type ProwessOutcome } from "../internal/problems.js";
import { PROWESS_DEFINITION_KINDS, isProwessDefinitionKind, type ProwessDefinitionKind, type ProwessSystemFamily } from "../vocabulary/families.js";
import { DEFINITION_ERROR_CODES as C } from "./codes.js";
import { readDefinitionContentHead, readDefinitionContentPayload, readEnvelope, readLegacyTerms, type LegacyTermUse, type ProwessDefinitionEnvelope } from "./envelope.js";

/**
 * How a Prowess Definition is held by the EXISTING M1 EntityVersion model (PAS-10 M5-WO1 §232 — no schema change, no
 * migration). An EntityVersion's `structuredData` carries the authored part of the envelope under one key:
 *
 *   structuredData.prowessDefinition = { schemaVersion, systemFamily, definitionKind, payload, legacyTerms? }
 *
 * Exact identity (Entity, EntityVersion, canonical key, EntityType) is NEVER read from that JSON: it comes from the
 * exact pinned rule of the RulesetContext the version was materialized under, so a stored blob cannot claim to be a
 * different version. An EntityVersion without the key is simply not a Prowess Definition (generic rule content).
 */
export const PROWESS_DEFINITION_STORAGE_KEY = "prowessDefinition";

const STORED_FIELDS = ["schemaVersion", "systemFamily", "definitionKind", "payload", "legacyTerms"];
const STORED_REQUIRED = ["schemaVersion", "systemFamily", "definitionKind", "payload"];

export type StoredDefinitionReading =
  | { readonly kind: "DEFINITION"; readonly envelope: ProwessDefinitionEnvelope }
  | { readonly kind: "NOT_A_DEFINITION" };

/**
 * The shared first step of every stored-Definition reader: the storage key's record (allowed / required fields) and the
 * kind ↔ storage EntityType rule. Returns null when the record itself is malformed (problems recorded).
 */
function readStoredRecord(stored: unknown, entityType: unknown, at: readonly PathSegment[], p: Problems): Record<string, unknown> | null {
  const record = readRecord(stored, at, p, C.INVALID_STORED_DEFINITION, STORED_FIELDS, STORED_REQUIRED);
  if (record === null) return null;
  const kind = own(record, "definitionKind");
  if (isProwessDefinitionKind(kind) && !(PROWESS_DEFINITION_KINDS[kind].entityTypes as readonly unknown[]).includes(entityType)) {
    p.add(C.ENTITY_TYPE_MISMATCH, [...at, "definitionKind"], `${kind} is stored under EntityType ${PROWESS_DEFINITION_KINDS[kind].entityTypes.join(" / ")}, not ${String(entityType)}`);
  }
  return record;
}

/**
 * Reads the stored Prowess Definition of one exact pinned rule. Pure: the caller (the server materializer) supplies
 * the EntityVersion's `structuredData` it loaded by exact id.
 */
export function readStoredProwessDefinition(input: {
  readonly ruleset: RulesetContext;
  readonly rule: ResolvedRuleReference;
  readonly structuredData: unknown;
}): ProwessOutcome<StoredDefinitionReading> {
  const p = new Problems();
  const { ruleset, rule, structuredData } = input;
  if (!isPlainObject(structuredData) || own(structuredData, PROWESS_DEFINITION_STORAGE_KEY) === undefined) {
    return finish(p, () => ({ kind: "NOT_A_DEFINITION" as const }));
  }
  const at = [PROWESS_DEFINITION_STORAGE_KEY];
  const stored = readStoredRecord(own(structuredData, PROWESS_DEFINITION_STORAGE_KEY), rule.entityType, at, p);
  if (stored === null) return finish(p, () => null as never);

  const envelope = readEnvelope(
    {
      schemaVersion: own(stored, "schemaVersion"),
      systemFamily: own(stored, "systemFamily"),
      definitionKind: own(stored, "definitionKind"),
      entityId: rule.entityId,
      entityVersionId: rule.entityVersionId,
      canonicalKey: rule.canonicalKey,
      payload: own(stored, "payload"),
      provenance: {
        rulesetId: ruleset.rulesetId,
        manifestId: ruleset.manifestId,
        releaseId: ruleset.release === null ? null : ruleset.release.releaseId,
        sourceRulesetId: rule.sourceRulesetId,
        sourceManifestId: rule.sourceManifestId,
        legacyTerms: own(stored, "legacyTerms") ?? [],
      },
    },
    at,
    p,
  );
  return finish(p, () => ({ kind: "DEFINITION" as const, envelope: envelope as ProwessDefinitionEnvelope }));
}

/** The normalized authored content of a stored Prowess Definition — no identity, no Ruleset provenance. */
export interface StoredDefinitionContent {
  readonly schemaVersion: number;
  readonly systemFamily: ProwessSystemFamily;
  readonly definitionKind: ProwessDefinitionKind;
  readonly payload: JsonObject;
  readonly legacyTerms: readonly LegacyTermUse[];
}

export type StoredDefinitionValidation =
  | { readonly kind: "DEFINITION"; readonly definition: StoredDefinitionContent }
  | { readonly kind: "NOT_A_DEFINITION" };

/**
 * Validates the stored Prowess Definition held by an EntityVersion's `structuredData` WITHOUT identity or Ruleset
 * provenance (PAS-10 M6-WO1 §14, §41, §81 — the approved smallest public-surface addition).
 *
 * Authoring needs to validate content that is not yet saved, not yet an EntityVersion and not pinned by any Ruleset,
 * so the exact-identity readers (`createProwessDefinitionEnvelope`, `readStoredProwessDefinition`) cannot be used
 * without fabricating ids. This function runs the SAME internal readers they run — the stored record and EntityType
 * rule, the family / kind / schemaVersion head, the kind's payload contract, legacy terminology — so there is one
 * validator, not two. It never assigns identity: the result has no Entity, EntityVersion, canonical key or Ruleset.
 *
 * Untrusted input: plain-data protections run first (accessors, functions, prototypes, cycles, unsafe keys, non-finite
 * numbers). The input is never mutated; the result is a detached, deep-frozen copy.
 */
export function validateStoredProwessDefinition(input: { readonly entityType: EntityType; readonly structuredData: unknown }): ProwessOutcome<StoredDefinitionValidation> {
  const p = new Problems();
  const container = isPlainObject(input) ? input : null;
  const structuredData = container === null ? undefined : own(container, "structuredData");
  const entityType = container === null ? undefined : own(container, "entityType");
  if (!checkPlainData(structuredData, [], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  if (!isPlainObject(structuredData) || own(structuredData, PROWESS_DEFINITION_STORAGE_KEY) === undefined) {
    return finish(p, () => deepFreeze({ kind: "NOT_A_DEFINITION" as const }));
  }
  const at = [PROWESS_DEFINITION_STORAGE_KEY];
  const stored = readStoredRecord(own(structuredData, PROWESS_DEFINITION_STORAGE_KEY), entityType, at, p);
  if (stored === null) return finish(p, () => null as never);

  const before = p.count;
  const head = readDefinitionContentHead(stored, at, p);
  const legacyTerms = readLegacyTerms(own(stored, "legacyTerms") ?? [], [...at, "legacyTerms"], p, C.INVALID_STORED_DEFINITION);
  const payload = p.count === before && head !== null ? readDefinitionContentPayload(head, own(stored, "payload"), [...at, "payload"], p) : null;
  if (p.count > 0 || head === null || payload === null || legacyTerms === null) return finish(p, () => null as never);
  const definition: StoredDefinitionContent = { ...head, payload: clonePlainData(payload), legacyTerms };
  return finish(p, () => deepFreeze({ kind: "DEFINITION" as const, definition }));
}
