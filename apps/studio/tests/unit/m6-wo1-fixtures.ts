import type { AuthoringCatalogDto, ValidationIssueDto } from "../../app/compendium/admin/_lib/authoring-client";
import catalog from "./fixtures/m6-wo1-catalog.json";

/**
 * Shared fixtures for the M6-WO1 Compendium Admin UI tests. CATALOG is the LIVE authoring catalog, generated from the
 * M5 registry by packages/prowess-db/tests/unit/m6-wo1-authoring-catalog.test.ts (which fails on drift) — the UI is
 * tested against real kinds and vocabularies, never a hand-written copy.
 */
export const CATALOG = catalog as AuthoringCatalogDto;

export const issue = (path: string, over: Partial<ValidationIssueDto> = {}): ValidationIssueDto => ({
  code: "PROWESS_DEFINITION.INVALID_PAYLOAD",
  severity: "ERROR",
  path,
  message: `Problem at ${path || "the Definition"}`,
  definitionKind: "SPELL_EFFECT",
  component: null,
  source: "M5_CONTRACT",
  ...over,
});

export const kindRow = (definitionKind: string) => CATALOG.kinds.find((k) => k.definitionKind === definitionKind)!;
