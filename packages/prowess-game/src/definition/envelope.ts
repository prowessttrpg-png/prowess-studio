import type { CanonicalKey, EntityId, EntityVersionId, JsonObject } from "@prowess/model";
import { clonePlainData, deepFreeze, type PathSegment } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, isExactCanonicalKey, isExactUuid, own, readRecord, type ProwessOutcome } from "../internal/problems.js";
import {
  PROWESS_DEFINITION_KINDS,
  isProwessDefinitionKind,
  isProwessSystemFamily,
  type ProwessDefinitionKind,
  type ProwessSystemFamily,
} from "../vocabulary/families.js";
import { legacyTermFor } from "../vocabulary/terminology.js";
import { DEFINITION_ERROR_CODES as C } from "./codes.js";
import { readDefinitionPayload } from "./payload.js";

/**
 * A legacy source term used by the source this Definition was structured from (PAS-10 M5-WO1 §8, §161). Recorded in
 * PROVENANCE so the historical wording stays visible; the payload itself uses the canonical term.
 */
export interface LegacyTermUse {
  readonly legacyTerm: string;
  readonly canonicalTerm: string;
}

/**
 * Where an exact Definition came from (§84, M5-I007): the exact Ruleset composition it was materialized under and the
 * Manifest that supplied its pin. Ruleset identity is preserved — never re-derived.
 */
export interface ProwessDefinitionProvenance {
  readonly rulesetId: string;
  readonly manifestId: string;
  readonly releaseId: string | null;
  readonly sourceRulesetId: string | null;
  readonly sourceManifestId: string | null;
  readonly legacyTerms: readonly LegacyTermUse[];
}

/**
 * A versioned, exact, plain-data Prowess Definition (§75–77, M5-I005–I006).
 *
 * `schemaVersion` versions the PAYLOAD CONTRACT (e.g. version 1 of the Targeting contract) — it is not the
 * EntityVersion (content revision), not a Ruleset or Release version and not the compiler contract version.
 * `entityVersionId` is the historical rule identity; `canonicalKey` is semantic identity carried alongside it — never
 * a substitute for it (§80). There is no display name: display text is never identity (§79).
 */
export interface ProwessDefinitionEnvelope<P = JsonObject> {
  readonly schemaVersion: number;
  readonly systemFamily: ProwessSystemFamily;
  readonly definitionKind: ProwessDefinitionKind;
  readonly entityId: EntityId;
  readonly entityVersionId: EntityVersionId;
  readonly canonicalKey: CanonicalKey;
  readonly payload: P;
  readonly provenance: ProwessDefinitionProvenance;
}

/** An exact reference to one Definition version (§78). Every field must match — no partial or name matching. */
export interface ProwessDefinitionRef {
  readonly entityId: EntityId;
  readonly entityVersionId: EntityVersionId;
  readonly canonicalKey: CanonicalKey;
  readonly definitionKind: ProwessDefinitionKind;
  readonly systemFamily: ProwessSystemFamily;
}

const ENVELOPE_FIELDS = ["schemaVersion", "systemFamily", "definitionKind", "entityId", "entityVersionId", "canonicalKey", "payload", "provenance"];
const PROVENANCE_FIELDS = ["rulesetId", "manifestId", "releaseId", "sourceRulesetId", "sourceManifestId", "legacyTerms"];
const REF_FIELDS = ["entityId", "entityVersionId", "canonicalKey", "definitionKind", "systemFamily"];

function readNullableUuid(value: unknown, at: readonly PathSegment[], p: Problems): string | null {
  if (value === undefined || value === null) return null;
  if (isExactUuid(value)) return value;
  p.add(C.INVALID_PROVENANCE, at, "expected an exact lowercase UUID or null");
  return null;
}

function readProvenance(value: unknown, at: readonly PathSegment[], p: Problems): ProwessDefinitionProvenance | null {
  const r = readRecord(value, at, p, C.INVALID_PROVENANCE, PROVENANCE_FIELDS, ["rulesetId", "manifestId"]);
  if (r === null) return null;
  const before = p.count;
  const rulesetId = own(r, "rulesetId");
  const manifestId = own(r, "manifestId");
  if (!isExactUuid(rulesetId)) p.add(C.INVALID_PROVENANCE, [...at, "rulesetId"], "provenance names the exact Ruleset");
  if (!isExactUuid(manifestId)) p.add(C.INVALID_PROVENANCE, [...at, "manifestId"], "provenance names the exact Manifest");
  const releaseId = readNullableUuid(own(r, "releaseId"), [...at, "releaseId"], p);
  const sourceRulesetId = readNullableUuid(own(r, "sourceRulesetId"), [...at, "sourceRulesetId"], p);
  const sourceManifestId = readNullableUuid(own(r, "sourceManifestId"), [...at, "sourceManifestId"], p);
  const rawTerms = own(r, "legacyTerms") ?? [];
  const legacyTerms: LegacyTermUse[] = [];
  if (!Array.isArray(rawTerms)) p.add(C.INVALID_PROVENANCE, [...at, "legacyTerms"], "legacyTerms is an array");
  else
    rawTerms.forEach((t: unknown, i: number) => {
      const tr = readRecord(t, [...at, "legacyTerms", i], p, C.INVALID_PROVENANCE, ["legacyTerm", "canonicalTerm"], ["legacyTerm", "canonicalTerm"]);
      if (tr === null) return;
      const legacyTerm = own(tr, "legacyTerm");
      const canonicalTerm = own(tr, "canonicalTerm");
      const known = typeof legacyTerm === "string" ? legacyTermFor(legacyTerm) : null;
      // Only inventoried LEGACY → CANONICAL pairs are accepted: no arbitrary aliases (§13).
      if (known === null || known.term !== legacyTerm || known.canonicalTerm !== canonicalTerm) {
        p.add(C.INVALID_PROVENANCE, [...at, "legacyTerms", i], "only an inventoried LEGACY → CANONICAL terminology pair may be recorded");
        return;
      }
      if (legacyTerms.some((x) => x.legacyTerm === legacyTerm)) {
        p.add(C.INVALID_PROVENANCE, [...at, "legacyTerms", i], `duplicate legacy term ${legacyTerm}`);
        return;
      }
      legacyTerms.push({ legacyTerm, canonicalTerm });
    });
  if (p.count > before) return null;
  legacyTerms.sort((a, b) => (a.legacyTerm < b.legacyTerm ? -1 : a.legacyTerm > b.legacyTerm ? 1 : 0));
  return { rulesetId: rulesetId as string, manifestId: manifestId as string, releaseId, sourceRulesetId, sourceManifestId, legacyTerms };
}

/**
 * Internal reader used by the envelope, the bundle and stored-definition readers. `containerChecked` is passed ONLY by
 * the bundle factory, whose whole input — every envelope included — has already passed `checkPlainData` in the same
 * call (M5-CLOSEOUT-02 R3); every other reader inspects the envelope here.
 */
export function readEnvelope(input: unknown, at: readonly PathSegment[], p: Problems, containerChecked = false): ProwessDefinitionEnvelope | null {
  const before = p.count;
  if (!containerChecked && !checkPlainData(input, at, p, C.NOT_PLAIN_DATA)) return null;
  const r = readRecord(input, at, p, C.INVALID_ENVELOPE, ENVELOPE_FIELDS, ENVELOPE_FIELDS);
  if (r === null) return null;

  const entityId = own(r, "entityId");
  const entityVersionId = own(r, "entityVersionId");
  const canonicalKey = own(r, "canonicalKey");
  if (!isExactUuid(entityId)) p.add(C.MISSING_EXACT_IDENTITY, [...at, "entityId"], "every canonical Definition carries its exact Entity id");
  if (!isExactUuid(entityVersionId)) p.add(C.MISSING_EXACT_IDENTITY, [...at, "entityVersionId"], "every canonical Definition carries its exact EntityVersion id — never a floating latest version");
  if (!isExactCanonicalKey(canonicalKey)) p.add(C.MISSING_EXACT_IDENTITY, [...at, "canonicalKey"], "every canonical Definition carries its exact canonical key");

  const family = own(r, "systemFamily");
  const kind = own(r, "definitionKind");
  if (!isProwessSystemFamily(family)) p.add(C.UNKNOWN_SYSTEM_FAMILY, [...at, "systemFamily"], `unknown Prowess system family ${JSON.stringify(family)}`);
  if (!isProwessDefinitionKind(kind)) p.add(C.UNKNOWN_DEFINITION_KIND, [...at, "definitionKind"], `unknown Prowess Definition kind ${JSON.stringify(kind)}`);
  const spec = isProwessDefinitionKind(kind) ? PROWESS_DEFINITION_KINDS[kind] : null;
  if (spec !== null && isProwessSystemFamily(family) && spec.family !== family) {
    p.add(C.FAMILY_KIND_MISMATCH, [...at, "systemFamily"], `${kind as string} belongs to family ${spec.family}, not ${family}`);
  }

  const schemaVersion = own(r, "schemaVersion");
  if (typeof schemaVersion !== "number" || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    p.add(C.UNSUPPORTED_SCHEMA_VERSION, [...at, "schemaVersion"], "schemaVersion is an explicit positive integer payload-contract version");
  } else if (spec !== null && !spec.schemaVersions.includes(schemaVersion)) {
    p.add(
      C.UNSUPPORTED_SCHEMA_VERSION,
      [...at, "schemaVersion"],
      spec.schemaVersions.length === 0
        ? `${kind as string} is a known but reserved Definition kind: its payload contract belongs to a later M5 Work Order`
        : `${kind as string} payload schemaVersion ${schemaVersion} is not supported (supported: ${spec.schemaVersions.join(", ")})`,
    );
  }

  const provenance = readProvenance(own(r, "provenance"), [...at, "provenance"], p);
  const payload = p.count === before && spec !== null ? readDefinitionPayload(kind as ProwessDefinitionKind, spec.contract, own(r, "payload"), [...at, "payload"], p, schemaVersion as number) : null;
  if (p.count > before || payload === null || provenance === null) return null;
  return {
    schemaVersion: schemaVersion as number,
    systemFamily: family as ProwessSystemFamily,
    definitionKind: kind as ProwessDefinitionKind,
    entityId: entityId as EntityId,
    entityVersionId: entityVersionId as EntityVersionId,
    canonicalKey: canonicalKey as CanonicalKey,
    payload: clonePlainData(payload),
    provenance,
  };
}

/**
 * Validates and normalizes a Prowess Definition envelope. The input is never mutated or frozen; the returned value is
 * a detached, deep-frozen, JSON-safe copy (§146–147).
 */
export function createProwessDefinitionEnvelope(input: unknown): ProwessOutcome<ProwessDefinitionEnvelope> {
  const p = new Problems();
  const value = readEnvelope(input, [], p);
  return finish(p, () => value as ProwessDefinitionEnvelope);
}

/** The exact reference of an envelope. */
export function definitionRefOf(envelope: ProwessDefinitionEnvelope<unknown>): ProwessDefinitionRef {
  return deepFreeze({
    entityId: envelope.entityId,
    entityVersionId: envelope.entityVersionId,
    canonicalKey: envelope.canonicalKey,
    definitionKind: envelope.definitionKind,
    systemFamily: envelope.systemFamily,
  });
}

/** Internal reader for a Definition reference. */
export function readDefinitionRef(value: unknown, at: readonly PathSegment[], p: Problems, code: string): ProwessDefinitionRef | null {
  const r = readRecord(value, at, p, code, REF_FIELDS, REF_FIELDS);
  if (r === null) return null;
  const before = p.count;
  if (!isExactUuid(own(r, "entityId"))) p.add(code, [...at, "entityId"], "a Definition reference names its exact Entity id");
  if (!isExactUuid(own(r, "entityVersionId"))) p.add(code, [...at, "entityVersionId"], "a Definition reference names its exact EntityVersion id");
  if (!isExactCanonicalKey(own(r, "canonicalKey"))) p.add(code, [...at, "canonicalKey"], "a Definition reference names its exact canonical key");
  const kind = own(r, "definitionKind");
  const family = own(r, "systemFamily");
  if (!isProwessDefinitionKind(kind)) p.add(code, [...at, "definitionKind"], `unknown Prowess Definition kind ${JSON.stringify(kind)}`);
  else if (PROWESS_DEFINITION_KINDS[kind].family !== family) p.add(code, [...at, "systemFamily"], `${kind} belongs to family ${PROWESS_DEFINITION_KINDS[kind].family}`);
  if (p.count > before) return null;
  return {
    entityId: own(r, "entityId") as EntityId,
    entityVersionId: own(r, "entityVersionId") as EntityVersionId,
    canonicalKey: own(r, "canonicalKey") as CanonicalKey,
    definitionKind: kind as ProwessDefinitionKind,
    systemFamily: family as ProwessSystemFamily,
  };
}

/**
 * Whether two references name the SAME exact Definition version (§116, M5-I038). Every identity field must match.
 * Sharing a semantic shape, a contract, a canonical-key suffix or a display name never makes two Definitions equal.
 */
export function isSameExactDefinition(a: ProwessDefinitionRef, b: ProwessDefinitionRef): boolean {
  return (
    a.entityId === b.entityId &&
    a.entityVersionId === b.entityVersionId &&
    a.canonicalKey === b.canonicalKey &&
    a.definitionKind === b.definitionKind &&
    a.systemFamily === b.systemFamily
  );
}
