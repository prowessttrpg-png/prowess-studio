/**
 * @prowess/db
 *
 * Centralized PostgreSQL persistence boundary. Owns the Prisma schema,
 * migrations, and the single shared PrismaClient instance.
 *
 * Framework-independent domain packages (@prowess/model, and later
 * @prowess/rules, @prowess/canon) must never import from this package or
 * from Prisma directly — the dependency direction is:
 *
 *   prowess-model  <-  this package (@prowess/db)  <-  application
 *
 * never the reverse.
 */
export { prisma } from "./client.js";
export {
  assertSafeToResetTestDatabase,
  assertRunningAgainstTestDatabase,
  UnsafeTestDatabaseResetError,
  type TestDatabaseGuardOptions,
} from "./testDatabaseGuard.js";
export { createEntity, getEntityById, findEntityByCanonicalKey } from "./entity/index.js";
export type { CreateEntityInput } from "./entity/index.js";
export {
  createEntityVersion,
  getEntityVersion,
  listEntityVersions,
  getLatestEntityVersion,
  updateDraftEntityVersion,
  transitionEntityVersionStatus,
} from "./entity-version/index.js";
export {
  createEntityAlias,
  listEntityAliases,
  findEntitiesByAlias,
  removeEntityAlias,
} from "./entity-alias/index.js";
export type { AliasEntityMatch } from "./entity-alias/index.js";
export {
  createKeywordCategory,
  getKeywordCategory,
  findKeywordCategoryByCanonicalKey,
} from "./keyword-category/index.js";
export {
  createKeywordDefinition,
  getKeywordDefinition,
  findKeywordDefinitionByCanonicalKey,
  listKeywordDefinitions,
} from "./keyword-definition/index.js";
export {
  assignKeywordToEntity,
  removeKeywordFromEntity,
  listEntityKeywords,
  findEntitiesByKeyword,
} from "./entity-keyword/index.js";
export type { EntityKeywordAssignment, EntityKeywordMatch } from "./entity-keyword/index.js";
export {
  assignKeywordToEntityVersion,
  removeKeywordFromEntityVersion,
  listEntityVersionKeywords,
  findEntityVersionsByKeyword,
} from "./entity-version-keyword/index.js";
export type {
  EntityVersionKeywordAssignment,
  EntityVersionKeywordMatch,
} from "./entity-version-keyword/index.js";
export type { PrismaClient } from "../generated/prisma/client.js";
