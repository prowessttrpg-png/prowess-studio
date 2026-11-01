"use client";

import { use } from "react";
import { WeaponLibrary } from "../../../../_components/WeaponLibrary";

/** /compendium/rulesets/:rulesetId/releases/:releaseId/weapons — the exact Release's Weapon Library (PAS-10 M6-WO6 §89). */
export default function WeaponLibraryPage({ params }: { params: Promise<{ rulesetId: string; releaseId: string }> }) {
  const { rulesetId, releaseId } = use(params);
  return <WeaponLibrary key={`${rulesetId}/${releaseId}`} rulesetId={rulesetId} releaseId={releaseId} />;
}
