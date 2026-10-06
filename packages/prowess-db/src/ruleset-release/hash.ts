import { createHash } from "node:crypto";
import { canonicalManifestText } from "@prowess/model";

/**
 * Lowercase hex SHA-256 of the canonical PROWESS_MANIFEST_V1 composition text (PAS-10 M2-WO8 §41).
 * Pure and database-free: depends only on the (entityId, entityVersionId) pins.
 */
export function computeManifestHash(pins: ReadonlyArray<{ entityId: string; entityVersionId: string }>): string {
  return createHash("sha256").update(canonicalManifestText(pins), "utf8").digest("hex");
}
