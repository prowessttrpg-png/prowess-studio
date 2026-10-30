"use client";

import { use } from "react";
import { CharacterWizard } from "../../_components/CharacterWizard";

/** /characters/:characterId/create — the core creation wizard (PAS-10 M6-WO3 §56–§69). */
export default function CharacterCreationPage({ params }: { params: Promise<{ characterId: string }> }) {
  const { characterId } = use(params);
  return <CharacterWizard key={characterId} characterId={characterId} />;
}
