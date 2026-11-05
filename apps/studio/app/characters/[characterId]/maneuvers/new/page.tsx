"use client";

import { use } from "react";
import { NewManeuverForm } from "../../../_components/maneuvers/NewManeuverForm";

/** /characters/:characterId/maneuvers/new — start a Signature Maneuver draft (PAS-10 M6-WO8 §19). */
export default function NewSignatureManeuverPage({ params }: { params: Promise<{ characterId: string }> }) {
  const { characterId } = use(params);
  return <NewManeuverForm key={characterId} characterId={characterId} />;
}
