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
