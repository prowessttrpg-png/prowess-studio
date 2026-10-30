"use client";

import { EntityTypeBadge } from "@prowess/ui";
import Link from "next/link";
import type { EntryCardDto } from "../_lib/reference-client";
import { readableToken } from "../_lib/reference-urls";

/**
 * A compact Rules Reference card (PAS-10 M6-WO2), computed at read time from the PINNED revision the server returned —
 * no stored card data. Generic content is labelled generic; no Definition kind is guessed from its name or text.
 */
export function EntryCard({ card, href }: { card: EntryCardDto; href: string }) {
  return (
    <li className="gov-card gov-card--compact prowess-reference__card" data-testid="reference-card">
      <p className="prowess-reference__card-title">
        <Link href={href}>{card.displayName}</Link>
      </p>
      <p className="gov-meta">
        {card.kind ? <span className="gov-badge">{readableToken(card.kind.definitionKind)}</span> : card.definitionKind ? <span className="gov-badge">{card.definitionKind} (unrecognized kind)</span> : <span className="gov-badge">Generic / non-Prowess Entity</span>}
        <EntityTypeBadge entityType={card.entityType} />
        <span className="gov-tag">Revision {card.revisionNumber}</span>
      </p>
      <p className="gov-muted">
        <code>{card.canonicalKey}</code>
      </p>
      {card.shortDescription ? <p>{card.shortDescription}</p> : null}
      {card.keywords.length > 0 ? (
        <p className="gov-muted">
          Keywords:{" "}
          {card.keywords.map((k) => (
            <code key={k} className="prowess-keyword-chip">
              {k}
            </code>
          ))}
        </p>
      ) : null}
    </li>
  );
}
