import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "../../src/prisma-errors";

// The message shape below is copied from a real failure in CI (Prisma 7 +
// @prisma/adapter-pg): it names the constraint and carries NO meta.target.
const adapterError = (constraint: string) =>
  Object.assign(
    new Error(
      "\nInvalid `tx.entityVersion.create()` invocation in\n" +
        "/home/runner/work/prowess-studio/prowess-studio/packages/prowess-db/src/entity-version/repository.ts:130:44\n\n" +
        "  127 });\n→ 130 const row = await tx.entityVersion.create(\n" +
        `Unique constraint failed on the constraint: \`${constraint}\``,
    ),
    {
      code: "P2002",
      meta: {
        driverAdapterError: {
          message: "UniqueConstraintViolation",
          cause: { originalCode: "23505", kind: "UniqueConstraintViolation", constraint: { index: constraint } },
        },
      },
    },
  );

// Exactly the matchers used by the seven call sites.
const SITES: Array<[string, string, string[]]> = [
  ["entity canonical key", "entities_canonical_key_key", ["canonical_key"]],
  ["keyword category canonical key", "keyword_categories_canonical_key_key", ["canonical_key"]],
  ["keyword definition canonical key", "keyword_definitions_canonical_key_key", ["canonical_key"]],
  ["entity alias", "entity_aliases_entity_alias_context_key", ["entity_id", "normalized_alias", "normalized_context"]],
  ["entity relationship", "entity_relationships_source_target_type_key", ["source_entity_id", "target_entity_id", "relationship_type"]],
  ["entity revision", "entity_versions_entity_id_revision_number_key", ["entity_id", "revision_number"]],
  ["ruleset canonical key", "rulesets_canonical_key_key", ["canonical_key"]],
];

describe("isUniqueViolation (the Prisma 7 driver-adapter regression)", () => {
  it.each(SITES)("recognizes the adapter-shaped P2002 for: %s", (_label, constraint, fields) => {
    expect(isUniqueViolation(adapterError(constraint), { constraint, fields })).toBe(true);
  });

  it("recognizes it from the message alone, and from meta alone", () => {
    const messageOnly = Object.assign(new Error("Unique constraint failed on the constraint: `entities_canonical_key_key`"), { code: "P2002" });
    expect(isUniqueViolation(messageOnly, { constraint: "entities_canonical_key_key" })).toBe(true);
    const metaOnly = Object.assign(new Error("boom"), {
      code: "P2002",
      meta: { driverAdapterError: { cause: { constraint: { index: "entities_canonical_key_key" } } } },
    });
    expect(isUniqueViolation(metaOnly, { constraint: "entities_canonical_key_key" })).toBe(true);
  });

  it("still honors the classic-engine meta.target column list", () => {
    const classic = Object.assign(new Error("x"), { code: "P2002", meta: { target: ["entity_id", "revision_number"] } });
    const matcher = { constraint: "entity_versions_entity_id_revision_number_key", fields: ["entity_id", "revision_number"] };
    expect(isUniqueViolation(classic, matcher)).toBe(true);
    const partial = Object.assign(new Error("x"), { code: "P2002", meta: { target: ["entity_id"] } });
    expect(isUniqueViolation(partial, matcher)).toBe(false);
  });

  it("does NOT match a different constraint (each site is scoped to its own)", () => {
    const keywordViolation = adapterError("keyword_definitions_canonical_key_key");
    expect(isUniqueViolation(keywordViolation, { constraint: "entities_canonical_key_key", fields: ["canonical_key"] })).toBe(false);
  });

  it("does NOT match non-unique errors, other codes, or non-errors", () => {
    const fk = Object.assign(new Error("Foreign key constraint violated on the constraint: `entity_aliases_entity_id_fkey`"), { code: "P2003" });
    expect(isUniqueViolation(fk, { constraint: "entity_aliases_entity_id_fkey" })).toBe(false);
    expect(isUniqueViolation(new Error("plain"), { constraint: "x" })).toBe(false);
    for (const value of [null, undefined, "P2002", 42]) expect(isUniqueViolation(value, { constraint: "x" })).toBe(false);
  });

  it("is not fooled by a constraint-like name appearing elsewhere in the message (e.g. a file path)", () => {
    const err = Object.assign(new Error("/src/entities_canonical_key_key.ts failed"), { code: "P2002" });
    expect(isUniqueViolation(err, { constraint: "entities_canonical_key_key" })).toBe(false);
  });
});

describe("constraint names used by the detectors exist in the migrations", () => {
  const dir = path.join(process.cwd(), "prisma", "migrations");
  const sql = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(path.join(dir, entry.name, "migration.sql"), "utf8"))
    .join("\n");

  it.each(SITES)("%s: a unique index with that exact name is created", (_label, constraint) => {
    expect(sql).toContain(`CREATE UNIQUE INDEX "${constraint}"`);
  });
});
