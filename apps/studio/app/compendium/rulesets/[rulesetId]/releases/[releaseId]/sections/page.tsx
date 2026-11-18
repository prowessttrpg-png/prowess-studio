"use client";

import { Suspense, use } from "react";
import { LoadingState } from "../../../../../_components/LoadingState";
import { SectionsOverview } from "../../../../_components/SectionBrowser";

/** /compendium/rulesets/:rulesetId/releases/:releaseId/sections — topic sections of one exact Release (PRE-M7-WO1). */
export default function SectionsPage({ params }: { params: Promise<{ rulesetId: string; releaseId: string }> }) {
  const { rulesetId, releaseId } = use(params);
  return (
    <Suspense fallback={<LoadingState label="Loading topics…" />}>
      <SectionsOverview key={`${rulesetId}/${releaseId}`} rulesetId={rulesetId} releaseId={releaseId} />
    </Suspense>
  );
}
