"use client";

import { use } from "react";
import { StatImpactPage } from "../../../../../_components/StatImpactPage";

/** /compendium/rulesets/:rulesetId/releases/:releaseId/stats/:stat — "What this affects" in one exact Release (PRE-M7-WO1). */
export default function StatPage({ params }: { params: Promise<{ rulesetId: string; releaseId: string; stat: string }> }) {
  const { rulesetId, releaseId, stat } = use(params);
  return <StatImpactPage key={`${rulesetId}/${releaseId}/${stat}`} rulesetId={rulesetId} releaseId={releaseId} stat={decodeURIComponent(stat)} />;
}
