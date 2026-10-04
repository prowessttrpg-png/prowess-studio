"use client";

import { Suspense, use } from "react";
import { EntityDetailView } from "../../_components/EntityDetailView";
import { LoadingState } from "../../_components/LoadingState";

/**
 * Entity detail route. All behavior lives in `EntityDetailView` (so it can
 * be unit-tested without Next's async `params` plumbing); this file only
 * unwraps the route param. Keyed by `entityId` so navigating to a different
 * Entity (e.g. via a relationship link) starts from a clean state instead of
 * carrying one Entity's loaded data or per-revision cache into another.
 */
export default function EntityDetailPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = use(params);
  // EntityDetailView reads the URL via useSearchParams(); keep it inside a
  // Suspense boundary (required by Next whenever a page could be pre-rendered —
  // this route is dynamic today, so this is a guard, not a response to a failure).
  return (
    <Suspense fallback={<LoadingState label="Loading Entity…" />}>
      <EntityDetailView key={entityId} entityId={entityId} />
    </Suspense>
  );
}
