import { apiGet, apiList, apiPost, query } from "./http";
import type {
  AuthorityRecordDto, AuthorityResolutionDto, ChangeSetDto, ConflictDto, DecisionDto, EntityDto, EntityVersionDto, HashVerificationDto,
  ImpactReportDto, ManifestDto, PolicyDto, ReleaseDiffDto, ReleaseDto, ResolutionDto, RulesetDto, SourceDocumentDto, SourceReferenceDto,
} from "./types";

/**
 * Typed functions for every M2 endpoint the Studio uses (PAS-10 M2-WO10 §64), plus the M1 entity / version /
 * source lookups the pickers need. One function per endpoint; no logic beyond building the URL. Lists ask for
 * the API maximum page (100) — Phase-1 governance data per Ruleset is small (see the UI doc's limitations).
 */
const all = { pageSize: 100 };
const enc = encodeURIComponent;

// Rulesets
export const listRulesets = (f: { status?: string; channel?: string } = {}) => apiList<RulesetDto>(`/api/rulesets${query({ ...all, ...f })}`);
export const getRuleset = (id: string) => apiGet<RulesetDto>(`/api/rulesets/${enc(id)}`);
export const createRuleset = (body: Record<string, unknown>) => apiPost<RulesetDto>("/api/rulesets", body);
export const submitRulesetForReview = (id: string) => apiPost<RulesetDto>(`/api/rulesets/${enc(id)}/submit-review`);
export const approveRuleset = (id: string) => apiPost<RulesetDto>(`/api/rulesets/${enc(id)}/approve`);
// Manifests
export const listManifests = (rulesetId: string) => apiList<ManifestDto>(`/api/rulesets/${enc(rulesetId)}/manifests${query(all)}`);
export const getLatestManifest = (rulesetId: string) => apiGet<ManifestDto | null>(`/api/rulesets/${enc(rulesetId)}/manifests/latest`);
export const getManifest = (id: string) => apiGet<ManifestDto>(`/api/ruleset-manifests/${enc(id)}`);
export const getEffectiveComposition = (id: string) => apiGet<ResolutionDto[]>(`/api/ruleset-manifests/${enc(id)}/effective`);
export const resolveEntity = (manifestId: string, entityId: string) =>
  apiGet<{ resolution: ResolutionDto | null }>(`/api/ruleset-manifests/${enc(manifestId)}/resolve/${enc(entityId)}`);
export const createManifest = (rulesetId: string, body: { parentManifestId?: string | null; entries: Array<{ entityId: string; entityVersionId: string }> }) =>
  apiPost<ManifestDto>(`/api/rulesets/${enc(rulesetId)}/manifests`, body);
// Canon policies
export const listPolicies = (rulesetId: string) => apiList<PolicyDto>(`/api/rulesets/${enc(rulesetId)}/canon-policies${query(all)}`);
export const getLatestPolicy = (rulesetId: string) => apiGet<PolicyDto | null>(`/api/rulesets/${enc(rulesetId)}/canon-policies/latest`);
export const getPolicy = (id: string) => apiGet<PolicyDto>(`/api/canon-policies/${enc(id)}`);
export const listAuthorityRecords = (id: string) => apiList<AuthorityRecordDto>(`/api/canon-policies/${enc(id)}/source-authorities${query(all)}`);
export const resolveAuthority = (policyId: string, sourceDocumentId: string, scopeKey: string) =>
  apiGet<AuthorityResolutionDto>(`/api/canon-policies/${enc(policyId)}/source-authority/resolve${query({ sourceDocumentId, scopeKey })}`);
export const createPolicy = (rulesetId: string, body: Record<string, unknown>) => apiPost<PolicyDto>(`/api/rulesets/${enc(rulesetId)}/canon-policies`, body);
// Conflicts and decisions
export const listConflicts = (rulesetId: string, f: { status?: string; severity?: string; conflictType?: string; entityId?: string } = {}) =>
  apiList<ConflictDto>(`/api/rulesets/${enc(rulesetId)}/rule-conflicts${query({ ...all, ...f })}`);
export const getConflict = (id: string) => apiGet<ConflictDto>(`/api/rule-conflicts/${enc(id)}`);
export const createConflict = (rulesetId: string, body: Record<string, unknown>) => apiPost<ConflictDto>(`/api/rulesets/${enc(rulesetId)}/rule-conflicts`, body);
export const listConflictDecisions = (conflictId: string) => apiList<DecisionDto>(`/api/rule-conflicts/${enc(conflictId)}/canon-decisions${query(all)}`);
export const createDecision = (conflictId: string, body: Record<string, unknown>) => apiPost<DecisionDto>(`/api/rule-conflicts/${enc(conflictId)}/canon-decisions`, body);
export const getDecision = (id: string) => apiGet<DecisionDto>(`/api/canon-decisions/${enc(id)}`);
export const listDecisions = (rulesetId: string, f: { decisionType?: string; conflictDisposition?: string } = {}) =>
  apiList<DecisionDto>(`/api/rulesets/${enc(rulesetId)}/canon-decisions${query({ ...all, ...f })}`);
export const proposeChangeSet = (decisionId: string, body: { targetManifestId?: string | null; name: string; description?: string | null }) =>
  apiPost<ChangeSetDto>(`/api/canon-decisions/${enc(decisionId)}/propose-change-set`, body);
// ChangeSets
export const listChangeSets = (rulesetId: string, f: { status?: string; canonDecisionId?: string } = {}) =>
  apiList<ChangeSetDto>(`/api/rulesets/${enc(rulesetId)}/change-sets${query({ ...all, ...f })}`);
export const getChangeSet = (id: string) => apiGet<ChangeSetDto>(`/api/change-sets/${enc(id)}`);
export const createChangeSet = (rulesetId: string, body: Record<string, unknown>) => apiPost<ChangeSetDto>(`/api/rulesets/${enc(rulesetId)}/change-sets`, body);
export const getImpact = (id: string) => apiGet<ImpactReportDto>(`/api/change-sets/${enc(id)}/impact`);
export const submitChangeSetForReview = (id: string) => apiPost<ChangeSetDto>(`/api/change-sets/${enc(id)}/submit-review`);
export const approveChangeSet = (id: string) => apiPost<ChangeSetDto>(`/api/change-sets/${enc(id)}/approve`);
export const rejectChangeSet = (id: string) => apiPost<ChangeSetDto>(`/api/change-sets/${enc(id)}/reject`);
// Releases
export const listReleases = (rulesetId: string) => apiList<ReleaseDto>(`/api/rulesets/${enc(rulesetId)}/releases${query(all)}`);
export const getLatestRelease = (rulesetId: string) => apiGet<ReleaseDto | null>(`/api/rulesets/${enc(rulesetId)}/releases/latest`);
export const getRelease = (id: string) => apiGet<ReleaseDto>(`/api/ruleset-releases/${enc(id)}`);
export const verifyReleaseHash = (id: string) => apiGet<HashVerificationDto>(`/api/ruleset-releases/${enc(id)}/verify-manifest-hash`);
export const compareReleases = (a: string, b: string) => apiGet<ReleaseDiffDto>(`/api/ruleset-releases/${enc(a)}/compare/${enc(b)}`);
export const publishRelease = (rulesetId: string, body: Record<string, unknown>) => apiPost<ReleaseDto>(`/api/rulesets/${enc(rulesetId)}/releases`, body);
// M1 lookups used by the pickers
/**
 * Entity lookup for the pickers. M1's `search` matches aliases and Version display names; canonical keys are
 * matched only by the EXACT `canonicalKey` filter — so both M1 queries run and their distinct results merge.
 */
export const searchEntities = async (term: string) => {
  const [byName, byKey] = await Promise.all([
    apiList<{ entity: EntityDto }>(`/api/entities${query({ search: term, pageSize: 20 })}`),
    apiList<{ entity: EntityDto }>(`/api/entities${query({ canonicalKey: term, pageSize: 20 })}`),
  ]);
  const seen = new Map<string, EntityDto>();
  for (const { entity } of [...byKey.items, ...byName.items]) if (!seen.has(entity.id)) seen.set(entity.id, entity);
  return [...seen.values()];
};
export const getEntity = (id: string) => apiGet<EntityDto>(`/api/entities/${enc(id)}`);
export const listEntityVersions = async (entityId: string) => (await apiList<EntityVersionDto>(`/api/entities/${enc(entityId)}/versions`)).items;
export const getEntityVersion = (id: string) => apiGet<EntityVersionDto>(`/api/entity-versions/${enc(id)}`);
export const listSourceDocuments = async () => (await apiList<SourceDocumentDto>(`/api/source-documents`)).items;
export const listVersionSources = async (versionId: string) => (await apiList<SourceReferenceDto>(`/api/entity-versions/${enc(versionId)}/sources`)).items;
