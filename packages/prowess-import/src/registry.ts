import { ExtractorRegistry } from "./extractor.js";
import { structuralExtractorV1 } from "./structural-v1.js";

/**
 * The official extractors of this deployment (PAS-10 M3-WO3). Changing an extractor's behaviour means registering a
 * NEW version; a registered key@version is never edited, because completed Batches pin it and re-verify against it.
 */
export const OFFICIAL_EXTRACTORS = [structuralExtractorV1] as const;

export const defaultExtractorRegistry = new ExtractorRegistry(OFFICIAL_EXTRACTORS);
