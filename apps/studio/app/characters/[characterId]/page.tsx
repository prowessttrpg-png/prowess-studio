"use client";

import { use } from "react";
import { CharacterSheetSummary } from "../_components/CharacterSheetSummary";

/** /characters/:characterId — the Character, resolved against its exact Release (PAS-10 M6-WO3 §69, §74). */
export default function CharacterPage({ params }: { params: Promise<{ characterId: string }> }) {
  const { characterId } = use(params);
  return <CharacterSheetSummary key={characterId} characterId={characterId} />;
}
