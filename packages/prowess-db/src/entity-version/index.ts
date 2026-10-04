/**
 * Public surface for EntityVersion persistence. Only the service is
 * exported — `./repository.ts` is an internal implementation detail (see
 * its own doc comment) and is never re-exported from here or from
 * `@prowess/db`'s own package entry point.
 */
export {
  createEntityVersion,
  getEntityVersion,
  listEntityVersions,
  getLatestEntityVersion,
  updateDraftEntityVersion,
  transitionEntityVersionStatus,
} from "./service.js";
