"use client";

import { use } from "react";
import { NewSpellForm } from "../../../_components/spells/NewSpellForm";

/** /characters/:characterId/spells/new — start a Signature Spell draft (PAS-10 M6-WO7 §19). */
export default function NewSignatureSpellPage({ params }: { params: Promise<{ characterId: string }> }) {
  const { characterId } = use(params);
  return <NewSpellForm key={characterId} characterId={characterId} />;
}
