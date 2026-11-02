"use client";

import { use } from "react";
import { WeaponDetail } from "../../../../../_components/WeaponLibrary";

/** /compendium/rulesets/:rulesetId/releases/:releaseId/weapons/:entityId — one Weapon as THIS Release pins it (§90). */
export default function WeaponDetailPage({ params }: { params: Promise<{ rulesetId: string; releaseId: string; entityId: string }> }) {
  const { rulesetId, releaseId, entityId } = use(params);
  return <WeaponDetail key={`${releaseId}/${entityId}`} rulesetId={rulesetId} releaseId={releaseId} entityId={entityId} />;
}
