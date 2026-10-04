import { EntityTypeBadge, VersionStatusBadge } from "@prowess/ui";
import Link from "next/link";
import type { EntityListItemDto } from "../_lib/api-client";

/**
 * One Entity result (PAS-10 M1-WO9 §9). Shows the display label from
 * `latestRevision` when one exists; otherwise the canonical key serves as
 * the primary identifier — never a fabricated name (§9's explicit
 * instruction). "No revisions" is shown as an intentional state, not left
 * blank or hidden.
 *
 * A real `<Link>` (not a click handler on a non-semantic container) so
 * open-in-new-tab, browser history, and keyboard navigation all work for
 * free (PAS-10 M1-WO9 §11).
 */
export function EntityListRow({ item }: { item: EntityListItemDto }) {
  const { entity, latestRevision } = item;
  const href = `/compendium/entities/${entity.id}`;

  return (
    <li className="prowess-entity-row" data-testid="entity-row">
      <Link href={href} className="prowess-entity-row__link">
        <div className="prowess-entity-row__primary">
          <span className="prowess-entity-row__label">
            {latestRevision ? latestRevision.displayName : entity.canonicalKey}
          </span>
          <span className="prowess-entity-row__canonical-key">{entity.canonicalKey}</span>
        </div>
        <div className="prowess-entity-row__meta">
          <EntityTypeBadge entityType={entity.entityType} />
          {latestRevision ? (
            <>
              <span className="prowess-entity-row__revision">
                Latest Revision {latestRevision.revisionNumber}
              </span>
              <VersionStatusBadge status={latestRevision.status} />
            </>
          ) : (
            <span className="prowess-entity-row__no-revisions" data-testid="no-revisions-label">
              No revisions
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}
