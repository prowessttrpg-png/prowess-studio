"use client";

import Link from "next/link";
import { use } from "react";
import { PlayWorkspace } from "../../_components/play/PlayWorkspace";

/** /characters/:characterId/play — the Character Play Workspace (PAS-10 M6-WO10). */
export default function CharacterPlayPage({ params }: { params: Promise<{ characterId: string }> }) {
  const { characterId } = use(params);
  const id = encodeURIComponent(characterId);
  return (
    <div className="prowess-character" data-testid="play-page">
      <nav className="gov-crumbs" aria-label="Breadcrumb">
        <Link href="/characters">Characters</Link> / <Link href={`/characters/${id}`}>Character</Link> / <span aria-current="page">Play</span>
      </nav>
      <PlayWorkspace key={characterId} characterId={characterId} />
    </div>
  );
}
