import type { EntityAliasId, EntityId } from "./ids.js";

/**
 * EntityAlias — alternate human-readable lookup/discovery metadata for a
 * stable Entity (PAS-10 M1-WO4).
 *
 * ```
 * Entity
 *   canonical_key: spell.affinity.emission
 *
 * Aliases:
 *   Emission
 *   Evocation
 * ```
 *
 * Aliases are NOT a replacement for any of:
 *   - Entity identity (the UUID `id` — see `./entity.js`)
 *   - the canonical key (stable, machine-readable — also `./entity.js`)
 *   - `EntityVersion.displayName` (the human-facing name for a specific
 *     historical revision — see `./entity-version.js`)
 *
 * All three answer different questions:
 *
 * ```
 * Entity.canonicalKey        = stable machine key
 * EntityVersion.displayName  = human-facing name for THAT historical revision
 * EntityAlias.alias          = alternate lookup/reference name for the Entity as a whole
 * ```
 *
 * Aliases attach to the Entity, not to any single EntityVersion — a name
 * used across several historical revisions (or one that predates/survives
 * a terminology change entirely) only needs to be recorded once. Nothing
 * in this Work Order copies aliases into EntityVersion rows, and nothing
 * automatically creates an alias from a Version's `displayName` — alias
 * creation is always explicit (see M1-WO4 §26 — hidden/automatic writes
 * here would be a surprise, not a convenience).
 */
export interface EntityAlias {
  id: EntityAliasId;
  entityId: EntityId;
  /** Authored, as typed — casing/spacing preserved exactly. Never destroyed. */
  alias: string;
  /** `normalizeEntityAlias(alias)` — the lookup/matching form. */
  normalizedAlias: string;
  /** Authored context, exactly as given, or `null` if none was supplied. */
  context: string | null;
  createdAt: Date;
}

/** Input shape for creating a new EntityAlias. */
export interface CreateEntityAliasInput {
  alias: string;
  context?: string | null;
}

/** Documented limit — see `isValidEntityAlias`. */
export const MAX_ENTITY_ALIAS_LENGTH = 200;

/**
 * The one authoritative alias-normalization function (PAS-10 M1-WO4 §5).
 * Every place that compares, stores, or looks up a normalized alias —
 * `@prowess/db`'s repository/service, this module's own validation, and
 * any future caller — must go through this function rather than
 * reimplementing the steps independently.
 *
 * Also used to normalize `context` (see `./entity-alias.js`'s service
 * consumer) — the same whitespace/casing concerns apply to a context
 * string as to an alias itself, so one function serves both rather than
 * duplicating near-identical logic.
 *
 * Steps, in order:
 *   1. Unicode-normalize via `.normalize("NFC")` — canonical composition,
 *      deliberately NOT `"NFKC"` (compatibility normalization). NFKC can
 *      fold visually-or-semantically-distinct characters together (e.g.
 *      collapsing a single "ﬁ" ligature or full-width characters into
 *      their ASCII-ish equivalents) in ways that could incorrectly
 *      conflate two different fictional names. NFC only recomposes
 *      characters that are canonically equivalent (e.g. "é" typed as
 *      e + combining-acute vs. the single precomposed "é" codepoint both
 *      normalize to the same form), which is the safer, more conservative
 *      choice for a system that must support invented/fictional
 *      terminology, not just real-world languages.
 *   2. Trim leading/trailing whitespace.
 *   3. Collapse any run of internal whitespace to a single space.
 *   4. Lowercase via `.toLowerCase()` — deliberately locale-INDEPENDENT
 *      Unicode lowercasing, not `.toLocaleLowerCase()`. The result of this
 *      function is persisted as a database lookup/uniqueness key
 *      (`normalized_alias` / `normalized_context`), so it must be
 *      reproducible across every developer machine, CI runner, and
 *      deployment target regardless of that host's configured locale.
 *      `.toLocaleLowerCase()` with no explicit locale argument uses the
 *      JS runtime's *default* locale, which can differ by host — the
 *      classic example is Turkish: `"I".toLocaleLowerCase("tr-TR")`
 *      produces `"ı"` (dotless i, U+0131), not the ASCII `"i"` every other
 *      locale would produce. A value normalized on a Turkish-locale host
 *      could then fail to match the same alias normalized on an
 *      English-locale host — exactly the kind of environment-dependent
 *      bug a persisted matching key must never have.
 *      `.toLowerCase()` always applies the same locale-independent
 *      Unicode default case mapping, everywhere.
 *
 * No transliteration, no accent stripping, no ASCII restriction — Unicode
 * aliases are fully supported, per M1-WO4 §6.
 *
 * Example: `"  Direct   Damage "` -> `"direct damage"`.
 */
export function normalizeEntityAlias(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Whether `value` is a valid alias/context string: non-empty after
 * normalization, and no longer than `MAX_ENTITY_ALIAS_LENGTH` characters
 * as authored. Rejects empty and whitespace-only input. Does NOT impose
 * canonical-key syntax — spaces, capitalization, and ordinary name
 * punctuation are all valid.
 */
export function isValidEntityAlias(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  if (value.length > MAX_ENTITY_ALIAS_LENGTH) {
    return false;
  }
  return normalizeEntityAlias(value).length > 0;
}
