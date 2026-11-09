import { apiGet, apiPost } from "./http";
import type { EntityVersionDto } from "./types";

/**
 * PAS-10 M6-WO12 — the reviewer's revision approval (gap fix). A ChangeSet that pins a revision still IN_REVIEW can never
 * be published (`MUTABLE_VERSION_PINNED`), and before WO12 no Studio screen could move a reviewed revision to APPROVED.
 * This is the existing M1 lifecycle endpoint (`POST /api/entity-versions/:id/status`, validated by
 * `transitionEntityVersionStatus` on the server) — the same endpoint Compendium Admin already uses for "Return to Draft".
 * Kept out of `governance.ts`, whose named-command list is pinned by the M2 static audit.
 */
export const readRevisionForReview = (id: string) => apiGet<EntityVersionDto>(`/api/entity-versions/${encodeURIComponent(id)}`);
export const approveReviewedRevision = (id: string) => apiPost<EntityVersionDto>(`/api/entity-versions/${encodeURIComponent(id)}/status`, { status: "APPROVED" });
