"use client";

import Link from "next/link";
import { use } from "react";
import { AbilitiesPanel } from "../../_components/spells/AbilitiesPanel";

/** /characters/:characterId/abilities — the Character's Signature Abilities (PAS-10 M6-WO7 §19–§20, §93). */
export default function CharacterAbilitiesPage({ params }: { params: Promise<{ characterId: string }> }) {
  const { characterId } = use(params);
  const id = encodeURIComponent(characterId);
  return (
    <div className="prowess-character" data-testid="abilities-page">
      <nav className="gov-crumbs" aria-label="Breadcrumb">
        <Link href="/characters">Characters</Link> / <Link href={`/characters/${id}?view=abilities`}>Character</Link> / <span aria-current="page">Abilities</span>
      </nav>
      <h1>Abilities</h1>
      <AbilitiesPanel key={characterId} characterId={characterId} />
    </div>
  );
}
