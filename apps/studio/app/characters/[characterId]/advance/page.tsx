"use client";

import { use } from "react";
import { AdvancementWizard } from "../../_components/AdvancementWizard";

/** /characters/:characterId/advance — advance a completed Character one Level (PAS-10 M6-WO4 §69–§77). */
export default function CharacterAdvancePage({ params }: { params: Promise<{ characterId: string }> }) {
  const { characterId } = use(params);
  return <AdvancementWizard key={characterId} characterId={characterId} />;
}
