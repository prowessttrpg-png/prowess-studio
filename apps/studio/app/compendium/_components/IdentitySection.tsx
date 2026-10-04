import { EntityTypeBadge } from "@prowess/ui";
import type { EntityDto } from "../_lib/api-client";

/**
 * "Entity Identity" (PAS-10 M1-WO9 §15) — stable identity fields only,
 * rendered as a section distinct from "Latest Revision" below it. The
 * UUID is shown in a developer-oriented secondary presentation (smaller,
 * monospace, less visually prominent than the canonical key) since it's
 * rarely what a person scanning this page actually wants first.
 */
export function IdentitySection({ entity }: { entity: EntityDto }) {
  return (
    <section aria-labelledby="entity-identity-heading" data-testid="identity-section">
      <h2 id="entity-identity-heading">Entity Identity</h2>
      <dl className="prowess-detail-fields">
        <div className="prowess-detail-fields__row">
          <dt>Canonical key</dt>
          <dd>{entity.canonicalKey}</dd>
        </div>
        <div className="prowess-detail-fields__row">
          <dt>Entity type</dt>
          <dd>
            <EntityTypeBadge entityType={entity.entityType} />
          </dd>
        </div>
        <div className="prowess-detail-fields__row">
          <dt>Created</dt>
          <dd>{new Date(entity.createdAt).toLocaleString()}</dd>
        </div>
        <div className="prowess-detail-fields__row">
          <dt>Updated</dt>
          <dd>{new Date(entity.updatedAt).toLocaleString()}</dd>
        </div>
        <div className="prowess-detail-fields__row">
          <dt>UUID</dt>
          <dd className="prowess-detail-fields__uuid">{entity.id}</dd>
        </div>
      </dl>
    </section>
  );
}
