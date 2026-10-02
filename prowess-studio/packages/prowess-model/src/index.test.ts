import { describe, expect, it } from "vitest";
import * as ProwessModel from "./index.js";

describe("@prowess/model — shared model import", () => {
  it("can be imported and exposes a package version", () => {
    expect(ProwessModel.PROWESS_MODEL_PACKAGE_VERSION).toBe("0.1.0");
  });

  it("exposes the controlled Entity type set", () => {
    expect(ProwessModel.ENTITY_TYPES).toContain("SPELL_EFFECT");
    expect(ProwessModel.isEntityType("SPELL_EFFECT")).toBe(true);
    expect(ProwessModel.isEntityType("NOT_A_TYPE")).toBe(false);
  });

  it("exposes the controlled EntityVersion status set", () => {
    expect(ProwessModel.ENTITY_VERSION_STATUSES).toContain("CANON");
    expect(ProwessModel.isEntityVersionStatus("CANON")).toBe(true);
  });

  it("exposes the controlled relationship type set", () => {
    expect(ProwessModel.RELATIONSHIP_TYPES).toContain("REQUIRES");
    expect(ProwessModel.isRelationshipType("REQUIRES")).toBe(true);
  });

  it("brands identifiers without changing their runtime representation", () => {
    const id = ProwessModel.EntityId.of("11111111-1111-1111-1111-111111111111");
    expect(id).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("exposes the Entity error vocabulary as a DomainError with a stable code", () => {
    const error = new ProwessModel.DomainError(
      ProwessModel.ENTITY_ERROR_CODES.NOT_FOUND,
      "Entity not found",
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("ENTITY.NOT_FOUND");
    expect(error.message).toBe("Entity not found");
  });

  it("exposes the EntityVersion error vocabulary, reusing ENTITY.NOT_FOUND for a missing parent Entity", () => {
    expect(ProwessModel.ENTITY_VERSION_ERROR_CODES.NOT_FOUND).toBe("ENTITY_VERSION.NOT_FOUND");
    expect(ProwessModel.ENTITY_VERSION_ERROR_CODES.REVISION_CONFLICT).toBe(
      "ENTITY_VERSION.REVISION_CONFLICT",
    );
    expect(ProwessModel.ENTITY_VERSION_ERROR_CODES.INVALID_PARENT).toBe(
      "ENTITY_VERSION.INVALID_PARENT",
    );
    // Deliberately reused, not a parallel "ENTITY_VERSION.ENTITY_NOT_FOUND" —
    // see errors.ts's doc comment.
    expect(ProwessModel.ENTITY_ERROR_CODES.NOT_FOUND).toBe("ENTITY.NOT_FOUND");
  });

  it("exposes the Keyword/KeywordCategory/KeywordAssignment error vocabularies", () => {
    expect(ProwessModel.KEYWORD_CATEGORY_ERROR_CODES.NOT_FOUND).toBe(
      "KEYWORD_CATEGORY.NOT_FOUND",
    );
    expect(ProwessModel.KEYWORD_CATEGORY_ERROR_CODES.CANONICAL_KEY_CONFLICT).toBe(
      "KEYWORD_CATEGORY.CANONICAL_KEY_CONFLICT",
    );
    expect(ProwessModel.KEYWORD_ERROR_CODES.NOT_FOUND).toBe("KEYWORD.NOT_FOUND");
    expect(ProwessModel.KEYWORD_ERROR_CODES.CANONICAL_KEY_CONFLICT).toBe(
      "KEYWORD.CANONICAL_KEY_CONFLICT",
    );
    expect(ProwessModel.KEYWORD_ASSIGNMENT_ERROR_CODES.DUPLICATE).toBe(
      "KEYWORD_ASSIGNMENT.DUPLICATE",
    );
    expect(ProwessModel.KEYWORD_ASSIGNMENT_ERROR_CODES.INVALID_SOURCE).toBe(
      "KEYWORD_ASSIGNMENT.INVALID_SOURCE",
    );
  });

  it("exposes the complete EntityRelationship error vocabulary", () => {
    expect(ProwessModel.RELATIONSHIP_ERROR_CODES.NOT_FOUND).toBe("RELATIONSHIP.NOT_FOUND");
    expect(ProwessModel.RELATIONSHIP_ERROR_CODES.INVALID_SOURCE).toBe(
      "RELATIONSHIP.INVALID_SOURCE",
    );
    expect(ProwessModel.RELATIONSHIP_ERROR_CODES.INVALID_TARGET).toBe(
      "RELATIONSHIP.INVALID_TARGET",
    );
    expect(ProwessModel.RELATIONSHIP_ERROR_CODES.DUPLICATE).toBe("RELATIONSHIP.DUPLICATE");
    expect(ProwessModel.RELATIONSHIP_ERROR_CODES.INVALID_TYPE).toBe("RELATIONSHIP.INVALID_TYPE");
    expect(ProwessModel.RELATIONSHIP_ERROR_CODES.SELF_REFERENCE).toBe(
      "RELATIONSHIP.SELF_REFERENCE",
    );
  });

  it("exposes the SourceDocument and SourceReference error vocabularies", () => {
    expect(ProwessModel.SOURCE_DOCUMENT_ERROR_CODES.NOT_FOUND).toBe("SOURCE_DOCUMENT.NOT_FOUND");
    expect(ProwessModel.SOURCE_DOCUMENT_ERROR_CODES.INVALID_INPUT).toBe(
      "SOURCE_DOCUMENT.INVALID_INPUT",
    );
    expect(ProwessModel.SOURCE_REFERENCE_ERROR_CODES.NOT_FOUND).toBe(
      "SOURCE_REFERENCE.NOT_FOUND",
    );
    expect(ProwessModel.SOURCE_REFERENCE_ERROR_CODES.INVALID_INPUT).toBe(
      "SOURCE_REFERENCE.INVALID_INPUT",
    );
  });
});
