import { EmptyState, EntityTypeBadge, formatEnumLabel } from "@prowess/ui";
import Link from "next/link";
import type { RelationshipWithCounterpartDto } from "../_lib/api-client";
import { StructuredDataViewer } from "./StructuredDataViewer";

/**
 * One direction's relationship list (PAS-10 M1-WO9 §22–23). Rendered
 * twice on the detail page — "Outgoing Relationships" and "Incoming
 * Relationships" — never merged, and never inventing an inverse row: each
 * list shows exactly what `getOutgoingRelationships`/
 * `getIncomingRelationships` (M1-WO6) returned. The counterpart Entity
 * links to its own detail page using a real `<Link>`. `relationshipType`
 * values like `MODIFIES`/`REQUIRES`/`USES` are rendered as plain labels —
 * never interpreted as automatic game mechanics.
 */
export function RelationshipSection({
  heading,
  headingId,
  relationships,
  emptyLabel,
}: {
  heading: string;
  headingId: string;
  relationships: RelationshipWithCounterpartDto[];
  emptyLabel: string;
}) {
  return (
    <section aria-labelledby={headingId} data-testid="relationship-section">
      <h2 id={headingId}>{heading}</h2>
      {relationships.length === 0 ? (
        <EmptyState title={emptyLabel} />
      ) : (
        <ul className="prowess-relationship-list">
          {relationships.map(({ relationship, counterpart }) => (
            <li key={relationship.id} className="prowess-relationship-list__item">
              <span className="prowess-relationship-list__type">
                {formatEnumLabel(relationship.relationshipType)}
              </span>
              <Link
                href={`/compendium/entities/${counterpart.id}`}
                className="prowess-relationship-list__counterpart"
              >
                {counterpart.canonicalKey}
              </Link>
              <EntityTypeBadge entityType={counterpart.entityType} />
              {Object.keys(relationship.metadata ?? {}).length > 0 ? (
                <StructuredDataViewer data={relationship.metadata} emptyLabel="" />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
