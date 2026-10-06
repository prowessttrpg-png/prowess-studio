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
  listKeywordCategories,
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
export {
  createEntityRelationship,
  getEntityRelationship,
  getOutgoingRelationships,
  getIncomingRelationships,
  removeEntityRelationship,
} from "./entity-relationship/index.js";
export type { RelationshipWithCounterpart } from "./entity-relationship/index.js";
export {
  createSourceDocument,
  getSourceDocument,
  listSourceDocuments,
} from "./source-document/index.js";
export {
  createSourceReference,
  getSourceReference,
  listSourceReferencesForVersion,
  listSourceReferencesForDocument,
  removeSourceReference,
} from "./source-reference/index.js";
export { listEntities } from "./entity-query/index.js";
export type {
  EntityListItem,
  ListEntitiesQuery,
  ListEntitiesResult,
} from "./entity-query/index.js";
export type { PrismaClient } from "../generated/prisma/client.js";
export { createRuleset, findRulesetByCanonicalKey, getRuleset, listRulesets } from "./ruleset/index.js";
export type { ListRulesetsFilters } from "./ruleset/index.js";
export {
  createRulesetManifest,
  getLatestRulesetManifest,
  getManifestEntry,
  getRulesetManifest,
  listRulesetManifests,
  resolveEntityVersionFromManifest,
} from "./ruleset-manifest/index.js";
export { getEffectiveManifestEntries, resolveEffectiveEntityVersion } from "./ruleset-inheritance/index.js";
export {
  createCanonPolicy,
  getCanonPolicy,
  getLatestCanonPolicy,
  getSourceAuthorityRecord,
  listCanonPolicies,
  resolveSourceAuthority,
} from "./canon-policy/index.js";
export { createRuleConflict, getRuleConflict, listRuleConflicts, listRuleConflictsForEntity } from "./rule-conflict/index.js";
export { createCanonDecision, getCanonDecision, listCanonDecisions, listCanonDecisionsForConflict } from "./canon-decision/index.js";
export {
  analyzeChangeSetImpact,
  createChangeSet,
  getChangeSet,
  listChangeSets,
  proposeChangeSetFromCanonDecision,
} from "./change-set/index.js";
