"use client";

import { use } from "react";
import { CharacterSheet } from "../../_components/sheet/CharacterSheet";

/**
 * /characters/:characterId/print — the fixed two-page Prowess Field Manual sheet for printing / PDF (PAS-10 M6-WO5
 * §75–§76): no controls, links or inputs; a supplemental page appears only when text or possessions overflow.
 */
export default function CharacterPrintPage({ params }: { params: Promise<{ characterId: string }> }) {
  const { characterId } = use(params);
  return (
    <div className="sheet-print-root">
      <p className="sheet-print-bar">
        Print this page (Ctrl / ⌘ + P) for the two-page Character Sheet. <a href={`/characters/${encodeURIComponent(characterId)}`}>Back to the Character</a>
      </p>
      <CharacterSheet characterId={characterId} mode="print" />
    </div>
  );
}
