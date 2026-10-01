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
export type { PrismaClient } from "../generated/prisma/client.js";
