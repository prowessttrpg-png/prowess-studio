import type { ResolvedRuleReference, RulesetContext } from "@prowess/rules";
import { isPlainObject } from "../internal/plain-data.js";
import { Problems, finish, own, readRecord, type ProwessOutcome } from "../internal/problems.js";
import { PROWESS_DEFINITION_KINDS, isProwessDefinitionKind } from "../vocabulary/families.js";
import { DEFINITION_ERROR_CODES as C } from "./codes.js";
import { readEnvelope, type ProwessDefinitionEnvelope } from "./envelope.js";

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

export type StoredDefinitionReading =
  | { readonly kind: "DEFINITION"; readonly envelope: ProwessDefinitionEnvelope }
  | { readonly kind: "NOT_A_DEFINITION" };

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
  const stored = readRecord(own(structuredData, PROWESS_DEFINITION_STORAGE_KEY), at, p, C.INVALID_STORED_DEFINITION, STORED_FIELDS, ["schemaVersion", "systemFamily", "definitionKind", "payload"]);
  if (stored === null) return finish(p, () => null as never);

  const kind = own(stored, "definitionKind");
  if (isProwessDefinitionKind(kind) && !PROWESS_DEFINITION_KINDS[kind].entityTypes.includes(rule.entityType)) {
    p.add(C.ENTITY_TYPE_MISMATCH, [...at, "definitionKind"], `${kind} is stored under EntityType ${PROWESS_DEFINITION_KINDS[kind].entityTypes.join(" / ")}, not ${rule.entityType}`);
  }
  const envelope = readEnvelope(
    {
      schemaVersion: own(stored, "schemaVersion"),
      systemFamily: own(stored, "systemFamily"),
      definitionKind: kind,
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
