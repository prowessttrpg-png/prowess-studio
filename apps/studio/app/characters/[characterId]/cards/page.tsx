"use client";

import Link from "next/link";
import { use } from "react";
import { CardLibrary } from "../../_components/cards/CardLibrary";

/** /characters/:characterId/cards — the Character Card Library and full Card Viewer (PAS-10 M6-WO9 Phase C). */
export default function CharacterCardsPage({ params, searchParams }: { params: Promise<{ characterId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { characterId } = use(params);
  const q = use(searchParams);
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const id = encodeURIComponent(characterId);
  return (
    <div className="prowess-character" data-testid="cards-page">
      <nav className="gov-crumbs" aria-label="Breadcrumb">
        <Link href="/characters">Characters</Link> / <Link href={`/characters/${id}`}>Character</Link> / <span aria-current="page">Cards</span>
      </nav>
      <h1>Card Library</h1>
      <CardLibrary key={characterId} characterId={characterId} query={{ card: one(q.card), ability: one(q.ability), attack: one(q.attack), hand: one(q.hand), mode: one(q.mode), category: one(q.category) }} />
    </div>
  );
}
