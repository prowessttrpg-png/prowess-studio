"use client";

import { use } from "react";
import { ManeuverDetail } from "../../../_components/maneuvers/ManeuverDetail";

/** /characters/:characterId/maneuvers/:maneuverId — a Signature Maneuver with its revision history (PAS-10 M6-WO8 §96, §133). */
export default function SignatureManeuverPage({ params }: { params: Promise<{ characterId: string; maneuverId: string }> }) {
  const { characterId, maneuverId } = use(params);
  return <ManeuverDetail key={`${characterId}/${maneuverId}`} characterId={characterId} maneuverId={maneuverId} />;
}
