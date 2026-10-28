/**
 * M6-WO1 negative / mutation controls (PAS-10 M6-WO1 §78) on the shared CLOSEOUT-03 harness: each control mutates REAL
 * source, the permanent M6-WO1 guard must FAIL for a behavioural reason, and the file is restored byte-for-byte.
 * Guard: the M6-WO1 static gate plus the Compendium Admin UI / library suites (one command, one green baseline).
 */
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runControls, vitestGuard } from "./lib/control-harness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const guard = vitestGuard(root, "apps/studio", ["tests/unit/m6-wo1-static.test.ts", "tests/unit/m6-wo1-compendium-admin-ui.test.tsx", "tests/unit/m6-wo1-authoring-lib.test.ts"], { timeout: 300_000, ciEnv: false });
const replace = (from, to) => (text) => {
  assert.equal(text.split(from).length, 2, `one exact mutation anchor: ${from}`);
  return text.replace(from, to);
};
const append = (extra) => (text) => `${text}\n${extra}\n`;

const DB = "packages/prowess-db/src/compendium-authoring";
const UI = "apps/studio/app/compendium/admin";
const controls = [
  // §78 bypass the API: the Compendium frontend talks to the database directly.
  ["bypass API — import the DB into the Compendium", `${UI}/_components/RevisionWorkspace.tsx`, replace('import Link from "next/link";', 'import Link from "next/link";\nimport { prisma } from "@prowess/db";\nvoid prisma;')],
  // §78 replace M5 validation with `return valid`.
  ["replace M5 validation with a constant PASS", `${DB}/validation.ts`, replace("validateStoredProwessDefinition({ entityType, structuredData: { prowessDefinition: candidate } })", '({ ok: true, value: { kind: "NOT_A_DEFINITION" } } as ReturnType<typeof validateStoredProwessDefinition>)')],
  // §78 allow editing an immutable revision.
  ["allow editing an immutable revision", `${DB}/service.ts`, replace("if (!canMutateEntityVersionContent(version.status)) {", "if (false && !canMutateEntityVersionContent(version.status)) {")],
  // §78 infer the Definition kind from a name.
  ["infer the Definition kind from the display name", `${DB}/service.ts`, replace("  const kind = (structuredData[STORAGE_FIELD] as Record<string, unknown>).definitionKind;", "  const kind = (structuredData[STORAGE_FIELD] as Record<string, unknown>).definitionKind ?? (structuredData as { displayName?: string }).displayName;")],
  // §78 save a display name instead of the exact Definition reference.
  ["store a display name instead of the exact reference", `${UI}/_components/DefinitionReferencePicker.tsx`, replace("onClick={() => onSelect(r.ref)}", "onClick={() => onSelect({ ...r.ref, entityVersionId: r.displayName })}")],
  // §78 route Publish directly to a lifecycle mutation.
  ["route the hand-off to a lifecycle mutation (publish bypass)", `${DB}/service.ts`, replace("  return createChangeSet(input.rulesetId, {", '  await transitionEntityVersionStatus(version.id, "CANON");\n  return createChangeSet(input.rulesetId, {')],
  // §78 remove server validation.
  ["remove server-side refusal on Save", `${DB}/service.ts`, replace("    validation = await validateDefinitionCandidate(entity.entityType, input.prowessDefinition);\n    if (validation.refused) throw refusal(validation);", "    validation = await validateDefinitionCandidate(entity.entityType, input.prowessDefinition);")],
  ["create the Entity before validating", `${DB}/service.ts`, replace("  const validation = await validateDefinitionCandidate(entityType, input.prowessDefinition);\n  if (validation.refused) throw refusal(validation);", "  const validation = await validateDefinitionCandidate(entityType, input.prowessDefinition);")],
  // §78 allow Targeting Effect fields.
  ["allow an Effect resolution field on Targeting", `${UI}/_lib/descriptors.ts`, replace('      { key: "geometry", label: "Geometry",', '      { key: "resolution", label: "Resolution", group: "Geometry", input: "resolution", required: false },\n      { key: "geometry", label: "Geometry",')],
  // §76 no second Definition catalog.
  ["hand-written second Definition catalog in the UI", `${UI}/_lib/descriptors.ts`, append('export const KINDS = ["SPELL_EFFECT", "SPELL_TARGETING", "SPELL_TRAIT"];')],
  ["catalog copied instead of derived from the M5 registry", `${DB}/catalog.ts`, replace("    kinds: PROWESS_DEFINITION_KIND_NAMES.map(kindRow),", '    kinds: (["SPELL_EFFECT", "SPELL_TARGETING"] as ProwessDefinitionKind[]).map(kindRow),')],
  // §76 no game mechanics in UI constants.
  ["M5 vocabulary values hard-coded in the UI", `${UI}/_components/DefinitionEditor.tsx`, replace("const options = catalog.vocabularies[field.vocabulary] ?? [];", 'const options = ["ATTACK_ROLL", "SAVING_THROW", "AUTOMATIC"];')],
  // §75 client-supplied revision number.
  ["accept a client-supplied revision number", "apps/studio/app/api/compendium-authoring/entities/[entityId]/revisions/route.ts", replace('["baseVersionId", "changeType", "changeSummary"]', '["baseVersionId", "changeType", "changeSummary", "revisionNumber"]')],
  // §63 preview must not persist.
  ["Preview saves the Draft", `${UI}/_components/DefinitionPreview.tsx`, replace('import type { ValidationResultDto } from "../_lib/authoring-client";', 'import { saveDraft, type ValidationResultDto } from "../_lib/authoring-client";\nvoid saveDraft;')],
  // §30 / §46 latest selection inside authoring.
  ["latest-revision lookup in authoring", `${DB}/service.ts`, append("export const newest = (entityId: string) => getLatestEntityVersion(entityId);")],
  // §80–81 frozen M4 / schema.
  ["M4 source change", "packages/prowess-rules/src/index.ts", append("// m6-wo1 control")],
  ["schema change without approval", "packages/prowess-db/prisma/schema.prisma", append("// m6-wo1 control")],
  ["M5 mechanics change", "packages/prowess-game/src/definition/payload.ts", replace('  "resolution",\n  "save",', '  "save",')],
];

runControls({
  root,
  title: "M6-WO1",
  controls: controls.map(([name, file, mutate]) => ({ name, file, mutate, guard })),
  expect: /AssertionError|expected|failed/i,
  caught: (name) => `Caught and restored: ${name}`,
  done: (count) => `All ${count} M6-WO1 controls caught and restored.`,
});
