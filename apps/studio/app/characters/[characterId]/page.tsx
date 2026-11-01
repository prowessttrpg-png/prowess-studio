"use client";

import { Suspense, use } from "react";
import { CharacterSheetSummary } from "../_components/CharacterSheetSummary";

/**
 * /characters/:characterId — the Character, resolved against its exact Release (PAS-10 M6-WO3 §69, §74). A completed
 * Character opens on its Digital Character Sheet (M6-WO5); `?view=` selects the Advancement / Rules / History views.
 */
export default function CharacterPage({ params }: { params: Promise<{ characterId: string }> }) {
  const { characterId } = use(params);
  return (
    <Suspense fallback={<p role="status">Loading Character…</p>}>
      <CharacterSheetSummary key={characterId} characterId={characterId} />
    </Suspense>
  );
}
