/** Small HTTP-level building blocks shared by the M2 API tests (every step goes through a real route). */
import { call, key } from "./m2-api-harness";
import * as R from "./m2-routes";

export async function apiRuleset(label: string, approved = true, extra: Record<string, unknown> = {}) {
  const created = await call(R.Rulesets.POST, "POST", "/api/rulesets", {}, { canonicalKey: key(label), name: `M2 API ${label}`, channel: "CORE_PLAYTEST", ...extra });
  if (created.status !== 201) throw new Error(`ruleset create failed: ${JSON.stringify(created.body)}`);
  const id = created.data.id as string;
  if (approved) {
    await call(R.RulesetSubmit.POST, "POST", `/api/rulesets/${id}/submit-review`, { rulesetId: id });
    await call(R.RulesetApprove.POST, "POST", `/api/rulesets/${id}/approve`, { rulesetId: id });
  }
  return id;
}
export async function apiManifest(rulesetId: string, entries: Array<{ entityId: string; entityVersionId: string }>, parentManifestId?: string) {
  const r = await call(R.Manifests.POST, "POST", `/api/rulesets/${rulesetId}/manifests`, { rulesetId }, { entries, ...(parentManifestId ? { parentManifestId } : {}) });
  if (r.status !== 201) throw new Error(`manifest create failed: ${JSON.stringify(r.body)}`);
  return r.data;
}
export async function apiPolicy(rulesetId: string, authorities: unknown[] = []) {
  const r = await call(R.Policies.POST, "POST", `/api/rulesets/${rulesetId}/canon-policies`, { rulesetId }, { name: "P", authorities });
  if (r.status !== 201) throw new Error(`policy create failed: ${JSON.stringify(r.body)}`);
  return r.data;
}
export async function apiApprovedChangeSet(rulesetId: string, operations: unknown[]) {
  const cs = await call(R.ChangeSets.POST, "POST", `/api/rulesets/${rulesetId}/change-sets`, { rulesetId }, { name: "cs", operations });
  if (cs.status !== 201) throw new Error(`change set create failed: ${JSON.stringify(cs.body)}`);
  const id = cs.data.id as string;
  await call(R.CsSubmit.POST, "POST", `/api/change-sets/${id}/submit-review`, { changeSetId: id });
  await call(R.CsApprove.POST, "POST", `/api/change-sets/${id}/approve`, { changeSetId: id });
  return id;
}
