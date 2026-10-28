export { getAuthoringCatalog, type AuthoringCatalog, type AuthoringDefinitionKind } from "./catalog.js";
export { AUTHORING_ISSUE_CODES, type AuthoringValidationIssue, type AuthoringValidationResult } from "./validation.js";
export {
  createAuthoredDefinition,
  createAuthoredRevision,
  listAuthoringDefinitions,
  proposeDefinitionChangeSet,
  updateAuthoredDraftDefinition,
  searchAuthoringKeywords,
  searchDefinitionReferences,
  submitAuthoredRevisionForReview,
  validateAuthoringCandidate,
  validateStoredRevision,
  type AuthoredDefinitionResult,
  type AuthoringDefinitionListItem,
  type CreateAuthoredDefinitionInput,
  type CreateAuthoredRevisionInput,
  type DefinitionReferenceCandidate,
  type ProposeDefinitionChangeSetInput,
  type UpdateAuthoredDraftDefinitionInput,
} from "./service.js";
