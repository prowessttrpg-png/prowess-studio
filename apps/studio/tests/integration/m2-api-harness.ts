/**
 * Shared harness for the M2 Ruleset / Canon API integration tests (PAS-10 M2-WO9 §92): calls the REAL
 * Next.js route handlers as functions against the real prowess_studio_test database. Entities, Versions
 * and source rows are created through the existing public services (they are not part of the M2 API).
 */
import { createEntity, createEntityVersion, createSourceDocument, createSourceReference, prisma } from "@prowess/db";
import { SOURCE_DOCUMENT_TYPES } from "@prowess/model";

export const PREFIX = "test.m2api";
let n = 0;
export const key = (label: string) => `${PREFIX}.${label.toLowerCase()}_${Date.now()}_${++n}`;

type Handler = (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
export interface ApiResult {
  status: number;
  contentType: string | null;
  body: { data?: unknown; pagination?: unknown; error?: { code: string; message: string; field?: string } } & Record<string, unknown>;
  // Convenience accessor for `body.data` (typed loosely for terse assertions).
  data: any;
}

/** Invokes a route handler. `body` may be an object (JSON-encoded) or a raw string (sent verbatim). */
export async function call(handler: unknown, method: string, path: string, params: Record<string, string> = {}, body?: unknown): Promise<ApiResult> {
  const init: RequestInit = { method, headers: { "content-type": "application/json" } };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  const response = await (handler as Handler)(new Request(`http://localhost${path}`, init), { params: Promise.resolve(params) });
  const json = (await response.json()) as ApiResult["body"];
  // The M1 error envelope is top-level `{ code, message, field, details }`; expose it as `error` for terse assertions.
  const error = typeof json.code === "string" ? { code: json.code, message: json.message as string, field: (json.field ?? undefined) as string | undefined } : undefined;
  return { status: response.status, contentType: response.headers.get("content-type"), body: { ...json, error }, data: json.data };
}

export async function entityWithVersions(label: string, ...names: string[]) {
  const entity = await createEntity({ entityType: "GENERIC_RULE", canonicalKey: key(label) });
  const versions = [];
  for (const name of names) versions.push(await createEntityVersion(entity.id, { displayName: name }));
  return { entity, versions };
}

export async function sourceFor(entityVersionId: string, label: string) {
  const doc = await createSourceDocument({ title: `${PREFIX} ${label} ${++n}`, sourceType: SOURCE_DOCUMENT_TYPES[0] as string });
  return createSourceReference(entityVersionId, { sourceDocumentId: doc.id });
}

/** Removes everything this harness created, in foreign-key order. */
export async function cleanupM2Api(): Promise<void> {
  const rulesetIds = (await prisma.ruleset.findMany({ where: { canonicalKey: { startsWith: PREFIX } }, select: { id: true } })).map((r: { id: string }) => r.id);
  const inR = { rulesetId: { in: rulesetIds } };
  await prisma.rulesetRelease.deleteMany({ where: inR });
  await prisma.changeSetOperation.deleteMany({ where: inR });
  await prisma.changeSet.deleteMany({ where: inR });
  await prisma.canonDecisionSelection.deleteMany({ where: { canonDecision: inR } });
  await prisma.canonDecision.deleteMany({ where: inR });
  await prisma.ruleConflictCandidate.deleteMany({ where: { ruleConflict: inR } });
  await prisma.ruleConflict.deleteMany({ where: inR });
  await prisma.sourceAuthorityRecord.deleteMany({ where: { canonPolicy: inR } });
  await prisma.canonPolicy.deleteMany({ where: inR });
  await prisma.rulesetManifestEntry.deleteMany({ where: { manifest: inR } });
  await prisma.rulesetManifest.updateMany({ where: inR, data: { parentManifestId: null } });
  await prisma.rulesetManifest.deleteMany({ where: inR });
  await prisma.ruleset.updateMany({ where: { id: { in: rulesetIds } }, data: { parentRulesetId: null } });
  await prisma.ruleset.deleteMany({ where: { id: { in: rulesetIds } } });
  const entityIds = (await prisma.entity.findMany({ where: { canonicalKey: { startsWith: PREFIX } }, select: { id: true } })).map((e: { id: string }) => e.id);
  const versionIds = (await prisma.entityVersion.findMany({ where: { entityId: { in: entityIds } }, select: { id: true } })).map((v: { id: string }) => v.id);
  await prisma.sourceReference.deleteMany({ where: { entityVersionId: { in: versionIds } } });
  await prisma.sourceDocument.deleteMany({ where: { title: { startsWith: PREFIX } } });
  await prisma.entityVersion.updateMany({ where: { id: { in: versionIds } }, data: { parentVersionId: null } });
  await prisma.entityVersion.deleteMany({ where: { id: { in: versionIds } } });
  await prisma.entity.deleteMany({ where: { id: { in: entityIds } } });
}

/** A content fingerprint of the given tables, to prove read-only routes write nothing. */
export async function fingerprint(tables: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of tables) {
    const [row] = await prisma.$queryRawUnsafe<Array<{ h: string }>>(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM "${t}" t`);
    out[t] = row?.h ?? "";
  }
  return out;
}
export const ALL_M2_TABLES = [
  "rulesets", "ruleset_manifests", "ruleset_manifest_entries", "canon_policies", "source_authority_records", "rule_conflicts", "rule_conflict_candidates",
  "canon_decisions", "canon_decision_selections", "change_sets", "change_set_operations", "ruleset_releases", "entity_versions",
];

export function collectKeys(value: unknown, path = "", out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v, i) => collectKeys(v, `${path}[${i}]`, out));
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(`${path}.${k}`);
      collectKeys(v, `${path}.${k}`, out);
    }
  }
  return out;
}
