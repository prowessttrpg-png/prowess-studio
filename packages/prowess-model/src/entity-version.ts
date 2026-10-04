import type { ChangeType } from "./change-type.js";
import type { EntityId, EntityVersionId } from "./ids.js";
import type { EntityVersionStatus } from "./status.js";

/**
 * EntityVersion — the historical/versioned representation of a stable
 * Entity identity (PAS-10 M1-WO2; lifecycle/mutation rules added M1-WO3).
 *
 * ```
 * Entity (canonical_key: test.rule.versioned)
 *   Revision 1 — displayName: "Test Rule", structuredData: { value: 10 }
 *   Revision 2 — displayName: "Test Rule", structuredData: { value: 20 }
 * ```
 *
 * Every field that describes *what this concept currently looks like* —
 * display name, description, rules text, structured content, status —
 * lives here, never on `Entity` (see `./entity.js`'s own doc comment for
 * the reverse half of this rule).
 *
 * **Historical independence vs. mutability — two different concepts, easy
 * to conflate:** every EntityVersion is historically independent from
 * every other revision of the same Entity (creating revision 2 never
 * alters revision 1's content — this is permanent and was already true in
 * M1-WO2). That is NOT the same claim as "every EntityVersion row is
 * immutable the instant it's created." A `DRAFT` Version is a mutable
 * working revision — see `@prowess/db`'s `updateDraftEntityVersion`. Once
 * a Version leaves `DRAFT`, its authored content is protected according to
 * the lifecycle rules (`./entity-version-lifecycle.ts`'s
 * `canMutateEntityVersionContent`) — attempting to edit it throws
 * `ENTITY_VERSION.IMMUTABLE`. M1-WO2's earlier phrasing here ("each
 * persisted EntityVersion is a self-contained, immutable snapshot") was
 * imprecise for exactly this reason and has been corrected.
 *
 * **Lifecycle status vs. Ruleset Canon authority — also not the same
 * thing:** reaching `status: "CANON"` means only that this Version has
 * reached the CANON lifecycle state. It does NOT mean this Version is
 * globally "the active Prowess rule." Which exact EntityVersion is
 * authoritative within a given Ruleset is a question later M2 Ruleset
 * Manifests answer — never a field on EntityVersion itself (no
 * `isCurrent`/`isActiveRule`/`currentVersionId` exists or should ever be
 * added here).
 */
export interface EntityVersion {
  id: EntityVersionId;
  entityId: EntityId;
  /** Positive, unique-within-this-Entity sequence number. Never the identity. */
  revisionNumber: number;
  status: EntityVersionStatus;
  /** Human-facing name for this Version specifically — see `./entity.js`. */
  displayName: string;
  shortDescription: string | null;
  rulesText: string | null;
  /**
   * Variable structured content future subsystem-specific schemas will
   * validate (e.g. `base_mp`, `damage_parameters`) — not yet implemented.
   * Deliberately typed as `unknown` at this domain layer rather than a
   * specific shape; and deliberately NEVER a substitute for relational
   * architecture — Entity relationships, Keywords, Sources, Rulesets, and
   * aliases all get dedicated relational models in later Work Orders, not
   * a home inside this JSON blob.
   */
  structuredData: unknown;
  /** The EntityVersion this one was created from, if any. Same-Entity only. */
  parentVersionId: EntityVersionId | null;
  changeType: ChangeType | null;
  changeSummary: string | null;
  createdAt: Date;
  /**
   * Added in M1-WO3, once the mutation policy existed to give it meaning
   * (M1-WO2 deliberately omitted it — see this type's own doc comment
   * history, and docs/architecture/entity-version-lifecycle.md). Updates
   * only when DRAFT content actually changes via `updateDraftEntityVersion`
   * — never implies a protected, non-DRAFT Version can be mutated.
   */
  updatedAt: Date;
}

/**
 * Input shape for creating a new EntityVersion. Deliberately excludes
 * `revisionNumber` — revision allocation is automatic (see
 * `@prowess/db`'s `createEntityVersion`), never caller-supplied.
 */
export interface CreateEntityVersionInput {
  displayName: string;
  shortDescription?: string | null;
  rulesText?: string | null;
  /** Defaults to `{}` if omitted — see M1-WO2 docs for why an empty object, not null. */
  structuredData?: unknown;
  /** Defaults to `DRAFT` if omitted. */
  status?: EntityVersionStatus;
  parentVersionId?: string | null;
  changeType?: ChangeType | null;
  changeSummary?: string | null;
}

/**
 * Whether `value` is a valid EntityVersion `displayName` — a non-empty
 * string once trimmed. Pure, framework-independent, same pattern as
 * `isValidCanonicalKey` — used by `@prowess/db`'s EntityVersion service
 * before anything reaches Prisma.
 */
export function isValidDisplayName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Explicit DTO for updating a DRAFT EntityVersion's authored content
 * (PAS-10 M1-WO3 §5–6). Deliberately an allowlist, not a generic Prisma
 * update payload — only these fields are ever mutable, and only while the
 * Version's status is `DRAFT`. Every field the identity/lineage layer
 * requires to stay fixed (`id`, `entityId`, `revisionNumber`, `createdAt`,
 * `parentVersionId`, and `status` itself — see
 * `transitionEntityVersionStatus` for the separate, dedicated status
 * operation) has no place in this type at all, not merely a runtime check
 * against it.
 */
export interface UpdateDraftEntityVersionInput {
  displayName?: string;
  shortDescription?: string | null;
  rulesText?: string | null;
  structuredData?: unknown;
  changeType?: ChangeType | null;
  changeSummary?: string | null;
}
