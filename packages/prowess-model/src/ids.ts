/**
 * Branded identifier types shared across the Prowess Platform.
 *
 * These are structural placeholders for M0. They establish the identifier
 * *shapes* that persistence, API, and UI layers agree on, without implying
 * any particular database schema — that is defined starting in M1
 * (Entity & Version Core).
 *
 * Branding prevents accidentally passing an EntityId where an
 * EntityVersionId is expected, even though both are UUID strings at runtime.
 */

declare const brand: unique symbol;

/** A nominal ("branded") string type. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** UUID identifying a stable Entity identity (see M1-WO1). */
export type EntityId = Brand<string, "EntityId">;

/** UUID identifying a specific historical EntityVersion (see M1-WO2). */
export type EntityVersionId = Brand<string, "EntityVersionId">;

/** UUID identifying an EntityAlias (see M1-WO4). */
export type EntityAliasId = Brand<string, "EntityAliasId">;

/** UUID identifying a KeywordCategory (see M1-WO5). */
export type KeywordCategoryId = Brand<string, "KeywordCategoryId">;

/** UUID identifying a KeywordDefinition (see M1-WO5). */
export type KeywordDefinitionId = Brand<string, "KeywordDefinitionId">;

/** UUID identifying an EntityRelationship (see M1-WO6). */
/** UUID identifying an EntityRelationship (see M1-WO6). */
export type EntityRelationshipId = Brand<string, "EntityRelationshipId">;

/** UUID identifying a SourceDocument (see M1-WO7). */
export type SourceDocumentId = Brand<string, "SourceDocumentId">;

/** UUID identifying a SourceReference (see M1-WO7). */
export type SourceReferenceId = Brand<string, "SourceReferenceId">;

function asBrand<T extends string, B extends string>(value: T): Brand<T, B> {
  return value as Brand<T, B>;
}

export const EntityId = { of: (value: string) => asBrand<string, "EntityId">(value) };
export const EntityVersionId = {
  of: (value: string) => asBrand<string, "EntityVersionId">(value),
};
export const EntityAliasId = {
  of: (value: string) => asBrand<string, "EntityAliasId">(value),
};
export const KeywordCategoryId = {
  of: (value: string) => asBrand<string, "KeywordCategoryId">(value),
};
export const KeywordDefinitionId = {
  of: (value: string) => asBrand<string, "KeywordDefinitionId">(value),
};
export const EntityRelationshipId = {
  of: (value: string) => asBrand<string, "EntityRelationshipId">(value),
};
export const SourceDocumentId = {
  of: (value: string) => asBrand<string, "SourceDocumentId">(value),
};
export const SourceReferenceId = {
  of: (value: string) => asBrand<string, "SourceReferenceId">(value),
};
