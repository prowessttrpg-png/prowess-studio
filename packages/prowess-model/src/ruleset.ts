import type { CanonicalKey } from "./canonical-key.js";
import { isValidCanonicalKey } from "./canonical-key.js";
import type { RulesetId } from "./ids.js";
import { isRulesetChannel, type RulesetChannel } from "./ruleset-channel.js";
import type { RulesetStatus } from "./ruleset-status.js";

/**
 * A Ruleset — the stable identity and governance lifecycle of a named rules
 * configuration (PAS-10 M2-WO1).
 *
 * ```
 * Ruleset                 (this: identity + status + channel + lineage)
 *    |  future (M2-WO2)
 *    v
 * RulesetManifest         (exact pinned composition)
 *    |
 *    v
 * Entity -> EntityVersion
 * ```
 *
 * A Ruleset holds NO content and references no Entity or EntityVersion. Which
 * EntityVersion applies under a Ruleset is never derived from the latest
 * revision, CANON status, revision number, or Source authority — a later
 * manifest will pin it explicitly. There is deliberately no "current version",
 * "use latest", or "active rule" anything here.
 *
 * `status` and `channel` are descriptive governance metadata: an APPROVED or
 * CORE_PLAYTEST Ruleset does not make any EntityVersion Canon.
 *
 * `parentRulesetId` is lineage metadata only (future inheritance). Nothing
 * resolves content through a parent in M2-WO1, and the parent is chosen at
 * creation — no operation here changes it.
 */
export interface Ruleset {
  id: RulesetId;
  canonicalKey: CanonicalKey;
  /** Human-facing name; the Ruleset owns it (unlike an EntityVersion's displayName). */
  name: string;
  description: string | null;
  status: RulesetStatus;
  channel: RulesetChannel;
  /** A human-facing label such as "0.1" or "Core Playtest 2026.10". Never parsed as semver. */
  versionLabel: string | null;
  parentRulesetId: RulesetId | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * What a caller may supply. There is intentionally NO `status`: the service
 * always creates a Ruleset as DRAFT, so a caller cannot mint a PUBLISHED one.
 */
export interface CreateRulesetInput {
  canonicalKey: string;
  name: string;
  description?: string | null;
  channel: string;
  versionLabel?: string | null;
  parentRulesetId?: string | null;
}

export const MAX_RULESET_NAME_LENGTH = 200;
export const MAX_RULESET_VERSION_LABEL_LENGTH = 100;

export interface RulesetInputProblem {
  field: "canonicalKey" | "name" | "description" | "channel" | "versionLabel" | "parentRulesetId";
  message: string;
}

/**
 * Pure, shape-only validation of `CreateRulesetInput`; returns the first
 * problem found, or `null`. Whether a parent actually exists is a persistence
 * question and is checked by the service, not here.
 *
 * The canonical key reuses the project's one grammar (`isValidCanonicalKey`) —
 * no second key syntax exists for Rulesets.
 */
export function validateCreateRulesetInput(input: CreateRulesetInput): RulesetInputProblem | null {
  if (typeof input.canonicalKey !== "string" || !isValidCanonicalKey(input.canonicalKey)) {
    return { field: "canonicalKey", message: `Not a valid canonical key: ${JSON.stringify(input.canonicalKey)}` };
  }
  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    return { field: "name", message: "name is required and must not be empty" };
  }
  if (input.name.trim().length > MAX_RULESET_NAME_LENGTH) {
    return { field: "name", message: `name must be at most ${MAX_RULESET_NAME_LENGTH} characters` };
  }
  if (typeof input.channel !== "string" || !isRulesetChannel(input.channel)) {
    return { field: "channel", message: `Not a recognized RulesetChannel: ${JSON.stringify(input.channel)}` };
  }
  if (input.versionLabel !== undefined && input.versionLabel !== null) {
    if (typeof input.versionLabel !== "string" || input.versionLabel.trim().length === 0) {
      return { field: "versionLabel", message: "versionLabel, when supplied, must not be blank" };
    }
    if (input.versionLabel.trim().length > MAX_RULESET_VERSION_LABEL_LENGTH) {
      return { field: "versionLabel", message: `versionLabel must be at most ${MAX_RULESET_VERSION_LABEL_LENGTH} characters` };
    }
  }
  if (input.description !== undefined && input.description !== null && typeof input.description !== "string") {
    return { field: "description", message: "description, when supplied, must be a string" };
  }
  if (input.parentRulesetId !== undefined && input.parentRulesetId !== null && typeof input.parentRulesetId !== "string") {
    return { field: "parentRulesetId", message: "parentRulesetId, when supplied, must be a string" };
  }
  return null;
}
