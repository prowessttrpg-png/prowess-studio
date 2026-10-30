/**
 * M6-WO2 negative / mutation controls (PAS-10 M6-WO2) on the shared CLOSEOUT-03 harness: each control mutates REAL
 * source, the permanent M6-WO2 guard must FAIL for a behavioural reason, and the file is restored byte-for-byte.
 * Guard: the M6-WO2 static gate plus the Rules Reference UI / library suites (one command, one green baseline).
 * Invariants: M6-I011 … M6-I020.
 */
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runControls, vitestGuard } from "./lib/control-harness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const guard = vitestGuard(root, "apps/studio", ["tests/unit/m6-wo2-static.test.ts", "tests/unit/m6-wo2-rules-reference-ui.test.tsx", "tests/unit/m6-wo2-reference-lib.test.ts"], { timeout: 300_000, ciEnv: false });
const replace = (from, to) => (text) => {
  assert.equal(text.split(from).length, 2, `one exact mutation anchor: ${from}`);
  return text.replace(from, to);
};
const append = (extra) => (text) => `${text}\n${extra}\n`;

const DB = "packages/prowess-db/src/compendium-reference";
const UI = "apps/studio/app/compendium/rulesets";
const controls = [
  // Layering: the Rules Reference frontend talks to the database directly.
  ["bypass the API — import the DB into the Rules Reference", `${UI}/_components/EntryDetailView.tsx`, replace('import Link from "next/link";', 'import Link from "next/link";\nimport { prisma } from "@prowess/db";\nvoid prisma;')],
  // M6-I012: the Latest Revision substitutes for the Release pin.
  ["show the latest revision instead of the pinned one", `${DB}/service.ts`, replace("selectEntityVersionById(pin.entityVersionId)", "selectEntityVersionById(pin.entityId)")],
  // M6-I011: membership no longer scoped to the Release manifest.
  ["drop the Release-manifest scope from entry queries", `${DB}/repository.ts`, replace("const and: Prisma.Sql[] = [Prisma.sql`me.manifest_id = ${manifestId}::uuid`];", "const and: Prisma.Sql[] = [Prisma.sql`TRUE`];\n  void manifestId;")],
  // M6-I011: reconstruct inheritance for a (flattened) Release manifest.
  ["reconstruct manifest inheritance for a Release", `${DB}/service.ts`, append('export { getEffectiveManifestEntries } from "../ruleset-inheritance/resolution.js";')],
  // M6-I011: a Release of another Ruleset is accepted (fallback across Rulesets).
  ["accept a Release from another Ruleset", `${DB}/service.ts`, replace("if (release.rulesetId !== ruleset.id) {", "if (false && release.rulesetId !== ruleset.id) {")],
  // M6-I017: the client recomputes the manifest hash instead of trusting the server's M2 verification.
  ["compute the manifest hash in the browser", `${UI}/_components/ReleaseControls.tsx`, append("export const digest = (text: string) => crypto.subtle.digest(\"SHA-256\", new TextEncoder().encode(text));")],
  // M6-I017: an integrity failure is no longer an announced, serious warning.
  ["silence the integrity warning", `${UI}/_components/ReleaseControls.tsx`, replace('<div className="gov-bad" role="alert" data-testid="reference-integrity">', '<div className="gov-muted" data-testid="reference-integrity">')],
  // M6-I017: the Latest Release is auto-selected on load instead of resolved by an explicit action.
  ["auto-select the Latest Release on load", `${UI}/_components/RulesetReference.tsx`, replace("      setData(await listReleases(rulesetId));", "      setData(await listReleases(rulesetId));\n      void resolveLatestRelease(rulesetId);")],
  // M6-I019: entry links lose the Release context.
  ["drop the Release from entry links", `${UI}/_lib/reference-urls.ts`, replace("export const entryHref = (rulesetId: string, releaseId: string, entityId: string) => `${releaseHref(rulesetId, releaseId)}/entities/${enc(entityId)}`;", "export const entryHref = (rulesetId: string, releaseId: string, entityId: string) => `/compendium/entities/${enc(entityId)}`;")],
  // M6-I016: an authored exact reference is rewritten to the Release's pin.
  ["rewrite the authored reference to the pinned revision", `${DB}/service.ts`, replace("      authored: ref,", "      authored: pinned === null ? ref : { ...ref, entityVersionId: pinned.entityVersionId },")],
  // M6-I016: a version mismatch is hidden.
  ["hide the reference version mismatch", `${UI}/_components/EntryDetailView.tsx`, replace("Version mismatch: the authored reference names {authored}; this Release pins Revision {r.pinned.revisionNumber}.", "Revision {r.pinned.revisionNumber}")],
  // M6-I015 / M6-I010: a Definition kind is inferred from the display name.
  ["infer the Definition kind from the display name", `${DB}/service.ts`, replace('    definitionKind: str("definitionKind"),', '    definitionKind: str("definitionKind") ?? str("displayName"),')],
  // M6-I015: a second, hand-written Definition catalog in the presenter.
  ["hand-written second Definition catalog in the presenter", `${UI}/_components/DefinitionPresenter.tsx`, append('export const KINDS = ["SPELL_EFFECT", "SPELL_TARGETING"];')],
  // M6-I015: raw JSON becomes the primary view.
  ["raw JSON as the primary mechanical view", `${UI}/_components/DefinitionPresenter.tsx`, replace("          <StructuredValue value={payload} context={context} />", "          <pre>{JSON.stringify(payload, null, 2)}</pre>")],
  // M6-I014: facets dropped before reaching the server (client-side filtering instead).
  ["stop sending the kind facet to the server", `${UI}/_components/ReleaseBrowser.tsx`, replace("        kind: filters.kind || undefined,", "        kind: undefined,")],
  // M6-I020: the reference read module writes.
  ["a write inside the reference read module", `${DB}/repository.ts`, append("export const touch = (id: string) => prisma.entity.update({ where: { id }, data: {} });")],
  // M6-I020: a mutating reference route.
  ["a POST handler on a reference route", "apps/studio/app/api/compendium-reference/rulesets/[rulesetId]/releases/route.ts", append("export async function POST(): Promise<Response> {\n  try {\n    return new Response(null);\n  } catch (error) {\n    return toErrorResponse(error);\n  }\n}")],
  // §108: no schema change.
  ["schema change without approval", "packages/prowess-db/prisma/schema.prisma", append("// m6-wo2 control")],
];

runControls({
  root,
  title: "M6-WO2",
  controls: controls.map(([name, file, mutate]) => ({ name, file, mutate, guard })),
  expect: /AssertionError|expected|failed/i,
  caught: (name) => `Caught and restored: ${name}`,
  done: (count) => `All ${count} M6-WO2 controls caught and restored.`,
});
