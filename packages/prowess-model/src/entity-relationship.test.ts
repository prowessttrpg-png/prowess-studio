import { describe, expect, it } from "vitest";
import { EntityRelationshipId } from "./ids.js";
import type { CreateEntityRelationshipInput, EntityRelationship } from "./entity-relationship.js";
import type { JsonObject } from "./json.js";

describe("EntityRelationshipId", () => {
  it("brands a UUID string without changing its runtime representation", () => {
    const id = EntityRelationshipId.of("66666666-6666-6666-6666-666666666666");
    expect(id).toBe("66666666-6666-6666-6666-666666666666");
  });
});

describe("EntityRelationship metadata typing", () => {
  it("accepts a plain JSON-compatible object as metadata, round-tripping exactly", () => {
    const metadata: JsonObject = { note: "test relationship", priority: 1, active: true };
    const relationship: Pick<EntityRelationship, "metadata"> = { metadata };

    expect(relationship.metadata).toEqual({ note: "test relationship", priority: 1, active: true });
  });

  it("accepts nested JSON-compatible structures", () => {
    const metadata: JsonObject = {
      tags: ["editorial", "draft"],
      nested: { a: 1, b: null },
    };
    const input: CreateEntityRelationshipInput = {
      sourceEntityId: "a",
      targetEntityId: "b",
      relationshipType: "SEE_ALSO",
      metadata,
    };

    expect(input.metadata).toEqual({ tags: ["editorial", "draft"], nested: { a: 1, b: null } });
  });

  it("defaults are the caller's responsibility — metadata is optional on the input type", () => {
    const input: CreateEntityRelationshipInput = {
      sourceEntityId: "a",
      targetEntityId: "b",
      relationshipType: "SEE_ALSO",
    };

    expect(input.metadata).toBeUndefined();
  });
});
