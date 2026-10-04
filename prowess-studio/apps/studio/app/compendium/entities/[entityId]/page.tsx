"use client";

import { use } from "react";
import { EntityDetailView } from "../../_components/EntityDetailView";

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
  return <EntityDetailView key={entityId} entityId={entityId} />;
}
