"use client";

import { Suspense, use } from "react";
import { LoadingState } from "../../../../_components/LoadingState";
import { ReleaseBrowser } from "../../../_components/ReleaseBrowser";

/** /compendium/rulesets/:rulesetId/releases/:releaseId — browse exactly one Release (PAS-10 M6-WO2). */
export default function ReleaseReferencePage({ params }: { params: Promise<{ rulesetId: string; releaseId: string }> }) {
  const { rulesetId, releaseId } = use(params);
  return (
    <Suspense fallback={<LoadingState label="Loading Release…" />}>
      <ReleaseBrowser key={`${rulesetId}/${releaseId}`} rulesetId={rulesetId} releaseId={releaseId} />
    </Suspense>
  );
}
