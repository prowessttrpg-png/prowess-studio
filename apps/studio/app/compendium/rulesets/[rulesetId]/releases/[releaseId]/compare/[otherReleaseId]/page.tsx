"use client";

import { Suspense, use } from "react";
import { LoadingState } from "../../../../../../_components/LoadingState";
import { ComparisonView } from "../../../../../_components/ComparisonView";

/** /compendium/rulesets/:rulesetId/releases/:releaseId/compare/:otherReleaseId — Release Comparison (PAS-10 M6-WO2). */
export default function ReleaseComparisonPage({ params }: { params: Promise<{ rulesetId: string; releaseId: string; otherReleaseId: string }> }) {
  const { rulesetId, releaseId, otherReleaseId } = use(params);
  return (
    <Suspense fallback={<LoadingState label="Comparing Releases…" />}>
      <ComparisonView key={`${releaseId}/${otherReleaseId}`} rulesetId={rulesetId} releaseId={releaseId} otherReleaseId={otherReleaseId} />
    </Suspense>
  );
}
