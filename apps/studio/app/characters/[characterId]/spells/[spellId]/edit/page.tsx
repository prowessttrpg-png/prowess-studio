"use client";

import { use } from "react";
import { SpellBuilder } from "../../../../_components/spells/SpellBuilder";

/** /characters/:characterId/spells/:spellId/edit — the Signature Spell Builder (PAS-10 M6-WO7 §19, §21). */
export default function SignatureSpellBuilderPage({ params }: { params: Promise<{ characterId: string; spellId: string }> }) {
  const { characterId, spellId } = use(params);
  return <SpellBuilder key={`${characterId}/${spellId}`} characterId={characterId} spellId={spellId} />;
}
