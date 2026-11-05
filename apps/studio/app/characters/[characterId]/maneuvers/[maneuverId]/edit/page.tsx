"use client";

import { use } from "react";
import { ManeuverBuilder } from "../../../../_components/maneuvers/ManeuverBuilder";

/** /characters/:characterId/maneuvers/:maneuverId/edit — the Signature Maneuver Builder (PAS-10 M6-WO8 §19, §21). */
export default function SignatureManeuverBuilderPage({ params }: { params: Promise<{ characterId: string; maneuverId: string }> }) {
  const { characterId, maneuverId } = use(params);
  return <ManeuverBuilder key={`${characterId}/${maneuverId}`} characterId={characterId} maneuverId={maneuverId} />;
}
