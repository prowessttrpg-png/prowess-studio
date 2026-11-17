"use client";

import { use } from "react";
import { SectionsOverview } from "../../../../_components/SectionBrowser";

/** /compendium/rulesets/:rulesetId/releases/:releaseId/sections — topic sections of one exact Release (PRE-M7-WO1). */
export default function SectionsPage({ params }: { params: Promise<{ rulesetId: string; releaseId: string }> }) {
  const { rulesetId, releaseId } = use(params);
  return <SectionsOverview key={`${rulesetId}/${releaseId}`} rulesetId={rulesetId} releaseId={releaseId} />;
}
