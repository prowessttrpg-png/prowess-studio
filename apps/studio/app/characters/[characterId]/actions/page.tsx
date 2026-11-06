"use client";

import Link from "next/link";
import { use } from "react";
import { ActionDirectory } from "../../_components/cards/ActionDirectory";

/** /characters/:characterId/actions — the General Action Directory for the Character's pinned Release (PAS-10 M6-WO9). */
export default function CharacterActionsPage({ params, searchParams }: { params: Promise<{ characterId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { characterId } = use(params);
  const q = use(searchParams);
  const id = encodeURIComponent(characterId);
  return (
    <div className="prowess-character" data-testid="actions-page">
      <nav className="gov-crumbs" aria-label="Breadcrumb">
        <Link href="/characters">Characters</Link> / <Link href={`/characters/${id}`}>Character</Link> / <Link href={`/characters/${id}/cards`}>Cards</Link> / <span aria-current="page">Action Directory</span>
      </nav>
      <h1>Action Directory</h1>
      <ActionDirectory key={characterId} characterId={characterId} initialAction={typeof q.action === "string" ? q.action : null} />
    </div>
  );
}
