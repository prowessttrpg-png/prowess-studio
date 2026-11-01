"use client";

import { use } from "react";
import { AttackDetail } from "../../../../../_components/WeaponLibrary";

/** /compendium/rulesets/:rulesetId/releases/:releaseId/attacks/:entityId — one Attack as THIS Release pins it (§91). */
export default function AttackDetailPage({ params }: { params: Promise<{ rulesetId: string; releaseId: string; entityId: string }> }) {
  const { rulesetId, releaseId, entityId } = use(params);
  return <AttackDetail key={`${releaseId}/${entityId}`} rulesetId={rulesetId} releaseId={releaseId} entityId={entityId} />;
}
