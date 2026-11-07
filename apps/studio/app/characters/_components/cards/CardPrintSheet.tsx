"use client";

import { useEffect, useState } from "react";
import type { CardDto, CardLibraryDto } from "../../_lib/card-types";
import { USABLE_STATES, libraryEntries } from "../../_lib/card-format";
import { CharacterApiError, getCardLibrary } from "../../_lib/character-client";
import { releaseLabel } from "../CharacterReview";
import { PrintCardPages, type PrintLayout } from "./PrintCard";
import "./cards.css";

/**
 * Printable cards (PAS-10 M6-WO9 Phase C): the requested exact card keys — or, when none are named, every card usable
 * now — paginated from the same Card Presentation Contract as the viewer. Screen-only instructions never print.
 */
export function CardPrintSheet({ characterId, cardKeys, layout }: { characterId: string; cardKeys: readonly string[]; layout: PrintLayout }) {
  const [lib, setLib] = useState<CardLibraryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getCardLibrary(characterId).then(setLib, (e: unknown) => setError(e instanceof CharacterApiError ? `${e.message} (${e.code})` : "Could not load the cards."));
  }, [characterId]);
  if (error !== null)
    return (
      <p className="gov-error" role="alert">
        {error}
      </p>
    );
  if (lib === null) return <p role="status">Loading the cards…</p>;
  const entries = libraryEntries(lib);
  const chosen: CardDto[] =
    cardKeys.length > 0
      ? cardKeys.flatMap((k) => entries.filter((e) => e.key === k && e.card !== null).map((e) => e.card as CardDto))
      : entries.filter((e) => e.card !== null && USABLE_STATES.includes(e.state)).map((e) => e.card as CardDto);
  const missing = cardKeys.filter((k) => !entries.some((e) => e.key === k && e.card !== null));
  const release = releaseLabel(lib.release);
  return (
    <div className={`fcard-scope fprint-root fprint-root--${layout}`} data-testid="card-print-sheet" data-layout={layout}>
      <div className="fprint-bar">
        <p>
          Print this page (Ctrl / ⌘ + P). Card pages are 4 × 6 in (provisional); use duplex “flip on long edge” for fronts and backs. {chosen.length} card{chosen.length === 1 ? "" : "s"}.{" "}
          <a href={`?${new URLSearchParams([...cardKeys.map((k) => ["card", k]), ["layout", layout === "card" ? "combined" : "card"]]).toString()}`} data-testid="print-layout-toggle">
            {layout === "card" ? "Combined view (front and back side by side on Letter)" : "4 × 6 card pages"}
          </a>
        </p>
        {missing.length > 0 ? (
          <p className="sheet-error" role="alert" data-testid="print-missing">
            Not in this Character&apos;s library: {missing.join(", ")}
          </p>
        ) : null}
      </div>
      {chosen.length === 0 ? <p className="fcard-empty">No cards to print.</p> : chosen.map((c) => <PrintCardPages key={c.cardKey} card={c} names={lib.names} release={release} layout={layout} />)}
    </div>
  );
}
