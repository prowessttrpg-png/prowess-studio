"use client";

import { Suspense, use } from "react";
import { LoadingState } from "../../../../../../_components/LoadingState";
import { SectionBrowser } from "../../../../../_components/SectionBrowser";

/** /compendium/rulesets/:rulesetId/releases/:releaseId/sections/:section — one topic of one exact Release (PRE-M7-WO1). */
export default function SectionPage({ params }: { params: Promise<{ rulesetId: string; releaseId: string; section: string }> }) {
  const { rulesetId, releaseId, section } = use(params);
  return (
    <Suspense fallback={<LoadingState label="Loading topic…" />}>
      <SectionBrowser key={`${rulesetId}/${releaseId}/${section}`} rulesetId={rulesetId} releaseId={releaseId} sectionKey={section} />
    </Suspense>
  );
}
