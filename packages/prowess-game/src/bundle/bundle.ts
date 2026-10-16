import { createRulesetContext, findResolvedRule, type RulesetContext } from "@prowess/rules";
import { Problems, checkPlainData, finish, own, readRecord, type ProwessOutcome } from "../internal/problems.js";
import { BUNDLE_ERROR_CODES as B, DEFINITION_ERROR_CODES as C } from "../definition/codes.js";
import { definitionRefOf, isSameExactDefinition, readEnvelope, type ProwessDefinitionEnvelope, type ProwessDefinitionRef } from "../definition/envelope.js";
import { PROWESS_DEFINITION_KINDS } from "../vocabulary/families.js";

/** The exact Ruleset identity a bundle was materialized from (PAS-10 M5-WO1 §84), copied verbatim from the context. */
export interface ProwessRulesetProvenance {
  readonly rulesetId: string;
  readonly manifestId: string;
  readonly manifestHash: string | null;
  readonly rulesetVersionLabel: string | null;
  readonly release: { readonly releaseId: string; readonly releaseNumber: number; readonly versionLabel: string } | null;
}

/**
 * Every exact Prowess Definition of ONE exact RulesetContext (§84–87, M5-I007–I009). Definitions are ordered by
 * Entity id (the RulesetContext order) so equal inputs give deep-equal bundles whatever order they were supplied in.
 * A bundle never holds a version its RulesetContext does not pin, and never mixes two Rulesets.
 */
export interface ProwessDefinitionBundle {
  readonly rulesetProvenance: ProwessRulesetProvenance;
  readonly definitions: readonly ProwessDefinitionEnvelope[];
}

export function rulesetProvenanceOf(ruleset: RulesetContext): ProwessRulesetProvenance {
  return {
    rulesetId: ruleset.rulesetId,
    manifestId: ruleset.manifestId,
    manifestHash: ruleset.manifestHash,
    rulesetVersionLabel: ruleset.rulesetVersionLabel,
    release: ruleset.release === null ? null : { ...ruleset.release },
  };
}

/**
 * Builds a bundle from an exact RulesetContext and Definition envelopes. Fails closed on: unsafe data, malformed or
 * unsupported envelopes, a version the context does not pin (injection), a canonical-key or EntityType disagreement
 * with the pinned rule, provenance naming another Ruleset / Manifest / Release (mixing), and duplicates.
 */
export function createProwessDefinitionBundle(input: unknown): ProwessOutcome<ProwessDefinitionBundle> {
  const p = new Problems();
  if (!checkPlainData(input, [], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  const r = readRecord(input, [], p, B.INVALID_BUNDLE, ["ruleset", "definitions"], ["ruleset", "definitions"]);
  if (r === null) return finish(p, () => null as never);

  const context = createRulesetContext(own(r, "ruleset"));
  if (!context.ok) {
    p.add(B.INVALID_RULESET, ["ruleset"], "a bundle requires an exact, valid M4 RulesetContext");
    return finish(p, () => null as never);
  }
  const ruleset = context.value;
  const raw = own(r, "definitions");
  if (!Array.isArray(raw)) {
    p.add(B.INVALID_BUNDLE, ["definitions"], "definitions is an array of Prowess Definition envelopes");
    return finish(p, () => null as never);
  }

  const accepted: ProwessDefinitionEnvelope[] = [];
  raw.forEach((item: unknown, i: number) => {
    const at = ["definitions", i];
    const envelope = readEnvelope(item, at, p);
    if (envelope === null) return;
    const pinned = findResolvedRule(ruleset, envelope.entityId);
    if (pinned === null || pinned.entityVersionId !== envelope.entityVersionId) {
      p.add(B.NOT_PINNED, [...at, "entityVersionId"], "this exact EntityVersion is not pinned by the bundle's RulesetContext; Definitions cannot be injected");
      return;
    }
    if (pinned.canonicalKey !== envelope.canonicalKey) {
      p.add(B.CANONICAL_CONFLICT, [...at, "canonicalKey"], `the pinned Entity's canonical key is ${pinned.canonicalKey}`);
      return;
    }
    if (!PROWESS_DEFINITION_KINDS[envelope.definitionKind].entityTypes.includes(pinned.entityType)) {
      p.add(C.ENTITY_TYPE_MISMATCH, [...at, "definitionKind"], `${envelope.definitionKind} cannot be stored as EntityType ${pinned.entityType}`);
      return;
    }
    const pv = envelope.provenance;
    const releaseId = ruleset.release === null ? null : ruleset.release.releaseId;
    if (pv.rulesetId !== ruleset.rulesetId || pv.manifestId !== ruleset.manifestId || pv.releaseId !== releaseId) {
      p.add(B.RULESET_MISMATCH, [...at, "provenance"], "this Definition was materialized under a different exact Ruleset / Manifest / Release; Rulesets are never mixed");
      return;
    }
    if (pv.sourceRulesetId !== pinned.sourceRulesetId || pv.sourceManifestId !== pinned.sourceManifestId) {
      p.add(B.RULESET_MISMATCH, [...at, "provenance"], "pin provenance must equal the exact context's (sourceRulesetId / sourceManifestId)");
      return;
    }
    const ref = definitionRefOf(envelope);
    if (accepted.some((a) => isSameExactDefinition(definitionRefOf(a), ref))) {
      p.add(B.DUPLICATE_DEFINITION, at, "the same exact Definition version is supplied twice");
      return;
    }
    accepted.push(envelope);
  });

  return finish(p, () => ({
    rulesetProvenance: rulesetProvenanceOf(ruleset),
    definitions: accepted.sort((a, b) => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0)),
  }));
}

/**
 * The bundle Definition `ref` names EXACTLY, or null. No fallback: absence never means "use another version", and no
 * display-name, alias, canonical-key-only or semantic-shape lookup exists (§79, §91).
 */
export function findBundleDefinition(bundle: ProwessDefinitionBundle, ref: ProwessDefinitionRef): ProwessDefinitionEnvelope | null {
  return bundle.definitions.find((d) => isSameExactDefinition(definitionRefOf(d), ref)) ?? null;
}

/** Whether a bundle was built from exactly this RulesetContext's identity. */
export function bundleMatchesRuleset(bundle: ProwessDefinitionBundle, ruleset: RulesetContext): boolean {
  const a = bundle.rulesetProvenance;
  const b = rulesetProvenanceOf(ruleset);
  const sameRelease =
    a.release === null || b.release === null
      ? a.release === b.release
      : a.release.releaseId === b.release.releaseId && a.release.releaseNumber === b.release.releaseNumber && a.release.versionLabel === b.release.versionLabel;
  return a.rulesetId === b.rulesetId && a.manifestId === b.manifestId && a.manifestHash === b.manifestHash && a.rulesetVersionLabel === b.rulesetVersionLabel && sameRelease;
}
