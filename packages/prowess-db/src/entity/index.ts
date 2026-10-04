/**
 * Public surface for Entity persistence. Only the service is exported —
 * `./repository.ts` is an internal implementation detail (see its own doc
 * comment) and is never re-exported from here or from `@prowess/db`'s own
 * package entry point.
 */
export { createEntity, getEntityById, findEntityByCanonicalKey } from "./service.js";
export type { CreateEntityInput } from "./service.js";
