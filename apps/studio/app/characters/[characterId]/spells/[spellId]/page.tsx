"use client";

import { use } from "react";
import { SpellDetail } from "../../../_components/spells/SpellDetail";

/** /characters/:characterId/spells/:spellId — a Signature Spell with its revision history (PAS-10 M6-WO7 §96, §133). */
export default function SignatureSpellPage({ params }: { params: Promise<{ characterId: string; spellId: string }> }) {
  const { characterId, spellId } = use(params);
  return <SpellDetail key={`${characterId}/${spellId}`} characterId={characterId} spellId={spellId} />;
}
