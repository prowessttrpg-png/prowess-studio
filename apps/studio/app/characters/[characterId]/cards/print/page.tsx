"use client";

import { use } from "react";
import { CardPrintSheet } from "../../../_components/cards/CardPrintSheet";

/**
 * /characters/:characterId/cards/print — printable Prowess Field Manual cards (PAS-10 M6-WO9 Phase C): `card` (repeatable)
 * names exact card keys; `layout=combined` places fronts and backs side by side on Letter. No controls print.
 */
export default function CharacterCardPrintPage({ params, searchParams }: { params: Promise<{ characterId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { characterId } = use(params);
  const q = use(searchParams);
  const cards = q.card === undefined ? [] : Array.isArray(q.card) ? q.card : [q.card];
  return <CardPrintSheet key={characterId} characterId={characterId} cardKeys={cards} layout={q.layout === "combined" ? "combined" : "card"} />;
}
