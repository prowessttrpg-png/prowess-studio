import { DomainError, RULESET_RESOLUTION_ERROR_CODES } from "@prowess/model";
import { createRulesetContext, type RulesetContext } from "@prowess/rules";

/**
 * The deterministic, database-free final step of exact Ruleset resolution (PAS-10 M4-WO2 §15–26, §40–42, §85).
 *
 * Takes an exact composition already obtained from M2 (an effective Manifest or a frozen Release) plus the exact
 * identity rows of the pinned Entities / EntityVersions, checks it is unambiguous, and builds the ONE canonical
 * RulesetContext through @prowess/rules' own constructor — never by casting. Fails CLOSED with
 * RULESET_RESOLUTION.INVALID_COMPOSITION rather than choosing between ambiguous data. Inputs are never mutated; the
 * returned context is deep-frozen by the constructor.
 */

/** One exact pin of the composition, with where it came from. */
export interface CompositionPin {
  readonly entityId: string;
  readonly entityVersionId: string;
  /** The Ruleset / Manifest that SUPPLIED this pin (the inherited-from manifest, or the release manifest). */
  readonly sourceRulesetId: string;
  readonly sourceManifestId: string;
}

export interface EntityIdentityRow {
  readonly id: string;
  readonly canonicalKey: string;
  readonly entityType: string;
}

export interface EntityVersionOwnerRow {
  readonly id: string;
  readonly entityId: string;
}

export interface CompositionInput {
  readonly rulesetId: string;
  readonly manifestId: string;
  /** M2's stored release hash, verbatim — or null: a development Manifest has no authoritative hash in M2. */
  readonly manifestHash: string | null;
  readonly rulesetVersionLabel: string | null;
  readonly release: { readonly releaseId: string; readonly releaseNumber: number; readonly versionLabel: string } | null;
  readonly pins: readonly CompositionPin[];
  readonly entities: readonly EntityIdentityRow[];
  readonly versions: readonly EntityVersionOwnerRow[];
}

const lower = (value: string) => value.trim().toLowerCase();

function invalid(problems: readonly string[]): never {
  const shown = problems.slice(0, 10).join("; ");
  const more = problems.length > 10 ? `; and ${problems.length - 10} more` : "";
  throw new DomainError(
    RULESET_RESOLUTION_ERROR_CODES.INVALID_COMPOSITION,
    `The resolved composition cannot become an unambiguous RulesetContext: ${shown}${more}`,
  );
}

export function buildRulesetContextFromComposition(input: CompositionInput): RulesetContext {
  const entities = new Map(input.entities.map((row) => [lower(row.id), row] as const));
  const versionOwner = new Map(input.versions.map((row) => [lower(row.id), lower(row.entityId)] as const));
  const problems: string[] = [];
  const seenEntities = new Set<string>();
  const seenKeys = new Map<string, string>();

  for (const pin of input.pins) {
    const entityId = lower(pin.entityId);
    const versionId = lower(pin.entityVersionId);
    if (seenEntities.has(entityId)) {
      problems.push(`Entity ${entityId} appears more than once`);
      continue;
    }
    seenEntities.add(entityId);
    const entity = entities.get(entityId);
    if (entity === undefined) {
      problems.push(`pinned Entity ${entityId} does not exist`);
      continue;
    }
    const owner = versionOwner.get(versionId);
    if (owner === undefined) problems.push(`pinned EntityVersion ${versionId} does not exist`);
    else if (owner !== entityId) problems.push(`EntityVersion ${versionId} belongs to Entity ${owner}, not ${entityId}`);
    const holder = seenKeys.get(entity.canonicalKey);
    if (holder !== undefined) problems.push(`canonical key ${entity.canonicalKey} is claimed by Entities ${holder} and ${entityId}`);
    else seenKeys.set(entity.canonicalKey, entityId);
  }
  if (problems.length > 0) invalid(problems);

  const outcome = createRulesetContext({
    rulesetId: input.rulesetId,
    manifestId: input.manifestId,
    manifestHash: input.manifestHash,
    rulesetVersionLabel: input.rulesetVersionLabel,
    release: input.release === null ? null : { ...input.release },
    rules: input.pins.map((pin) => {
      const entity = entities.get(lower(pin.entityId)) as EntityIdentityRow;
      return {
        entityId: pin.entityId,
        entityVersionId: pin.entityVersionId,
        canonicalKey: entity.canonicalKey,
        entityType: entity.entityType,
        sourceRulesetId: pin.sourceRulesetId,
        sourceManifestId: pin.sourceManifestId,
      };
    }),
  });
  if (!outcome.ok) invalid(outcome.errors.map((e) => `${e.path ?? ""} ${e.message}`.trim()));
  return outcome.value;
}
