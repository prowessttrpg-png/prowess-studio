/**
 * @prowess/model
 *
 * Framework-independent shared domain types for the Prowess Platform.
 *
 * Scope for M0-WO1: identifier brands, entity type / status / relationship
 * type enums. This package must never depend on Next.js, React, or any
 * persistence library — see PAS-10 §7 Required Package Responsibilities.
 *
 * The actual Entity / EntityVersion domain models (with persistence-facing
 * shapes) are introduced starting in M1 and will build on these primitives.
 */

export const PROWESS_MODEL_PACKAGE_VERSION = "0.1.0";

export * from "./ids.js";
export * from "./entity-type.js";
export * from "./status.js";
export * from "./relationship-type.js";
export * from "./canonical-key.js";
export * from "./entity.js";
export * from "./errors.js";
export * from "./change-type.js";
export * from "./entity-version.js";
export * from "./entity-version-lifecycle.js";
export * from "./entity-alias.js";
export * from "./keyword-assignment-source.js";
export * from "./keyword-category.js";
export * from "./keyword-definition.js";
export * from "./keyword-assignment.js";
export * from "./json.js";
export * from "./entity-relationship.js";
export * from "./source-document-type.js";
export * from "./source-authority-status.js";
export * from "./source-document.js";
export * from "./source-reference.js";
export * from "./ruleset-status.js";
export * from "./ruleset-channel.js";
export * from "./ruleset.js";
export * from "./ruleset-lineage.js";
export * from "./ruleset-manifest.js";
