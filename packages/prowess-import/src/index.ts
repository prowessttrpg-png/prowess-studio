/**
 * @prowess/import — framework-independent, import-specific PURE logic (PAS-10 M3-WO2).
 *
 * Depends only on @prowess/model and the Node standard library (node:crypto for SHA-256). Never on @prowess/db,
 * Prisma, Next.js, React or apps/studio. Persistence of Batches and Candidates lives in @prowess/db, which may use
 * these helpers. No semantic Prowess extraction lives here (that begins in WO3).
 */
export { canonicalJson, canonicalizeJsonText, CanonicalJsonError } from "./canonical-json.js";
export {
  EXTRACTION_CANDIDATE_FINGERPRINT_VERSION,
  extractionCandidateFingerprint,
  extractionCandidateFingerprintPreimage,
  IMPORT_BATCH_FINGERPRINT_VERSION,
  importBatchFingerprint,
  importBatchFingerprintPreimage,
  sha256Hex,
} from "./fingerprint.js";
export type { ExtractionCandidateFingerprintInput, FingerprintAnchor, ImportBatchFingerprintInput } from "./fingerprint.js";
export { isAnchorInScope, sectionSubtree } from "./scope.js";
export type { ScopeAnchor, SectionParentLink } from "./scope.js";
export { EXTRACTION_SET_HASH_VERSION, extractionSetHash, extractionSetPreimage } from "./fingerprint.js";
export { ExtractionError, ExtractorRegistry, runExtraction, scopeStructure } from "./extractor.js";
export type { ExtractionBatchIdentity, ExtractionContext, ExtractionErrorKind, ExtractionRun, ExtractorDefinition, ExtractorPayloadSchema } from "./extractor.js";
export {
  segmentStructure,
  STRUCTURAL_EXTRACTOR_KEY,
  STRUCTURAL_EXTRACTOR_VERSION,
  STRUCTURAL_PAYLOAD_SCHEMA_VERSION,
  STRUCTURAL_ROOT_CONTENT_PAYLOAD_SCHEMA,
  STRUCTURAL_SECTION_PAYLOAD_SCHEMA,
  STRUCTURAL_TABLE_PAYLOAD_SCHEMA,
  structuralExtractorV1,
  unitsToCandidates,
} from "./structural-v1.js";
export type { StructuralExtractionUnit, StructuralUnitType } from "./structural-v1.js";
export { defaultExtractorRegistry, OFFICIAL_EXTRACTORS } from "./registry.js";
export {
  defaultMatcherRegistry,
  editSimilarity,
  ENTITY_CATALOG_HASH_VERSION,
  ENTITY_MATCHER_KEY,
  ENTITY_MATCHER_V1_DEFAULT_CONFIG,
  ENTITY_MATCHER_VERSION,
  entityCatalogHash,
  entityMatcherV1,
  IMPORT_MATCH_RESULT_HASH_VERSION,
  IMPORT_MATCH_RUN_FINGERPRINT_VERSION,
  importMatchResultHash,
  importMatchRunFingerprint,
  isIdentityCandidate,
  matcherConfigHash,
  MatcherRegistry,
  MatchingError,
  OFFICIAL_MATCHERS,
  resolveMatcherConfig,
  runMatching,
} from "./matcher.js";
export type {
  DuplicateGroupOutput,
  EntityIdentityRecord,
  ImportMatchRunFingerprintInput,
  MatchAssessmentOutput,
  MatchCandidateInput,
  MatcherDefinition,
  MatcherOutput,
  MatchingErrorKind,
  MatchingRun,
  MatchSuggestionOutput,
} from "./matcher.js";
export {
  findingsToCandidates,
  findSemanticStatements,
  normalizeKeywordLabel,
  SEMANTIC_FORMULA_PAYLOAD_SCHEMA,
  SEMANTIC_FOUNDATION_EXTRACTOR_KEY,
  SEMANTIC_FOUNDATION_EXTRACTOR_VERSION,
  SEMANTIC_KEYWORD_PAYLOAD_SCHEMA,
  SEMANTIC_PAYLOAD_SCHEMA_VERSION,
  SEMANTIC_REQUIREMENT_PAYLOAD_SCHEMA,
  semanticFoundationExtractorV1,
} from "./semantic-foundation-v1.js";
export type { SemanticFinding } from "./semantic-foundation-v1.js";
export { parseAssignment, parseExpression } from "./semantic-formula.js";
export type { FormulaParse } from "./semantic-formula.js";
