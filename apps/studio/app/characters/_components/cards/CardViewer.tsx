"use client";

import Link from "next/link";
import { useState } from "react";
import type { CardDto } from "../../_lib/card-types";
import { ENTRY_STATE_LABELS, directoryHref, type LibraryEntry } from "../../_lib/card-format";
import { CardBack, CardFront } from "./CardFace";
import { PrintCardPages } from "./PrintCard";
import { ProgressionDrawer } from "./ProgressionDrawer";

/**
 * The full Card Viewer (PAS-10 M6-WO9 Phase C): five presentation modes over ONE Card Presentation Contract —
 * Illustrated, Tactical, Front / Back (flippable), Combined and Print (the non-interactive physical pages). Changing the
 * mode never changes the card: the exact card key (Character, Release, Ability revision) is kept in the URL by the caller.
 */
export const VIEW_MODES = [
  { key: "illustrated", label: "Illustrated" },
  { key: "tactical", label: "Tactical" },
  { key: "flip", label: "Front / Back" },
  { key: "combined", label: "Combined" },
  { key: "print", label: "Print" },
] as const;
export type ViewMode = (typeof VIEW_MODES)[number]["key"];
export const isViewMode = (v: string | null): v is ViewMode => VIEW_MODES.some((m) => m.key === v);

export function CardViewer({
  entry,
  card,
  names,
  release,
  characterId,
  mode,
  onMode,
  revisions,
  onOpen,
}: {
  entry: LibraryEntry;
  card: CardDto;
  names: Record<string, string>;
  release: string | null;
  characterId: string;
  mode: ViewMode;
  onMode: (m: ViewMode) => void;
  revisions: readonly LibraryEntry[];
  onOpen: (key: string) => void;
}) {
  const [back, setBack] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const s = card.section;
  const improvements = s.kind === "GENERAL_ACTION" ? s.improvements : [];
  return (
    <section className="fcard-viewer" aria-labelledby="fcard-viewer-title" data-testid="card-viewer" data-card={card.cardKey} data-mode={mode}>
      <h2 id="fcard-viewer-title" className="fcard-sr">
        {card.name} — card viewer
      </h2>
      <p className="fcard-state" data-testid="viewer-state" data-state={entry.state}>
        {ENTRY_STATE_LABELS[entry.state]}
        {entry.state === "HISTORICAL" || entry.state === "RETIRED" || entry.state === "DRAFT" ? " · shown with its own revision and provenance; it is not a usable current card." : ""}
      </p>
      <div className="fcard-modes" role="group" aria-label="Card view">
        {VIEW_MODES.map((m) => (
          <button key={m.key} type="button" className="fcard-button" aria-pressed={mode === m.key} onClick={() => onMode(m.key)} data-testid={`mode-${m.key}`}>
            {m.label}
          </button>
        ))}
      </div>
      {s.kind === "GENERAL_ACTION" ? (
        <p>
          <button type="button" className="fcard-button" onClick={() => setDrawer(true)} data-testid="progression-open" aria-haspopup="dialog">
            Progression ({improvements.length} improvement{improvements.length === 1 ? "" : "s"})
          </button>
        </p>
      ) : null}
      <div className="fcard-stage">
        {mode === "illustrated" ? <CardFront card={card} names={names} variant="illustrated" /> : null}
        {mode === "tactical" ? <CardFront card={card} names={names} variant="tactical" /> : null}
        {mode === "flip" ? (
          <div className="fcard-flip" data-face={back ? "back" : "front"}>
            <button type="button" className="fcard-button fcard-flip__button" aria-pressed={back} onClick={() => setBack(!back)} data-testid="card-flip">
              {back ? "Show front" : "Show back"}
            </button>
            <p className="fcard-sr" aria-live="polite">
              {back ? "Showing the back of the card" : "Showing the front of the card"}
            </p>
            <div className="fcard-flip__face" key={back ? "back" : "front"}>
              {back ? <CardBack card={card} names={names} release={release} /> : <CardFront card={card} names={names} variant="tactical" />}
            </div>
          </div>
        ) : null}
        {mode === "combined" ? (
          <div className="fcard-combined" data-testid="card-combined">
            <CardFront card={card} names={names} variant="tactical" />
            <CardBack card={card} names={names} release={release} />
          </div>
        ) : null}
        {mode === "print" ? (
          <div className="fcard-print-preview" data-testid="card-print-preview">
            <p>
              <Link className="fcard-button" href={`/characters/${encodeURIComponent(characterId)}/cards/print?card=${encodeURIComponent(card.cardKey)}`} target="_blank" rel="noopener" data-testid="card-print-link">
                Open printable pages
              </Link>
            </p>
            <PrintCardPages card={card} names={names} release={release} layout="card" />
          </div>
        ) : null}
      </div>
      {revisions.length > 1 ? (
        <nav className="fcard-revisions" aria-label="Revisions of this Ability" data-testid="card-revisions">
          <h3>Revisions</h3>
          <ul>
            {revisions.map((r) => (
              <li key={r.key}>
                {r.key === entry.key ? (
                  <span aria-current="true">
                    {r.revisionNumber === null ? "Draft" : `Revision ${r.revisionNumber}`} — {ENTRY_STATE_LABELS[r.state]}
                  </span>
                ) : (
                  <button type="button" className="fcard-link" onClick={() => onOpen(r.key)} disabled={r.card === null} data-testid="card-revision-link">
                    {r.revisionNumber === null ? "Draft" : `Revision ${r.revisionNumber}`} — {ENTRY_STATE_LABELS[r.state]}
                    {r.card === null && r.reason ? ` (${r.reason})` : ""}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {s.kind === "GENERAL_ACTION" ? <ProgressionDrawer open={drawer} onClose={() => setDrawer(false)} actionName={card.name} improvements={improvements} names={names} directoryHref={directoryHref(characterId, s.actionKey)} /> : null}
    </section>
  );
}
