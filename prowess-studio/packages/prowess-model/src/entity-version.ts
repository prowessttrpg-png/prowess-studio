import type { ChangeType } from "./change-type.js";
import type { EntityId, EntityVersionId } from "./ids.js";
import type { EntityVersionStatus } from "./status.js";

/**
 * EntityVersion — the historical/versioned representation of a stable
 * Entity identity (PAS-10 M1-WO2).
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
 * **Snapshot principle:** each persisted EntityVersion is a self-contained
 * snapshot. Creating revision 2 never alters revision 1 — there is no
 * operation anywhere in this package that mutates an existing
 * EntityVersion row's content (see M1-WO2's docs for why `updatedAt` is
 * deliberately absent from this type, unlike `Entity`).
 *
 * **Not yet enforced (M1-WO3):** lifecycle/immutability rules — e.g. that
 * a `CANON` or `PLAYTEST` version cannot be edited in place. M1-WO2 only
 * establishes the `status` field and its controlled values.
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
