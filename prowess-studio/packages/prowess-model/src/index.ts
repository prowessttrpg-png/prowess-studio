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
