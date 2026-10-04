import { EmptyState, VersionStatusBadge } from "@prowess/ui";
import type { EntityVersionDto } from "../_lib/api-client";
import { StructuredDataViewer } from "./StructuredDataViewer";

/**
 * "Latest Revision" (PAS-10 M1-WO9 §16) — deliberately never titled
 * "Current" or "Canon." This is the EntityVersion with the highest
 * `revisionNumber`, the same deterministic convention established by the
 * M1-WO8 API — a list-display convenience, not a claim about Ruleset
 * authority. See `docs/architecture/compendium-ui.md` for the full
 * explanation this page assumes the reader already understands.
 */
export function LatestRevisionSection({
  version,
  versionCount,
}: {
  version: EntityVersionDto | null;
  versionCount: number;
}) {
  return (
    <section aria-labelledby="latest-revision-heading" data-testid="latest-revision-section">
      <h2 id="latest-revision-heading">Latest Revision</h2>
      <p className="prowess-detail-versions-count">
        Versions: {versionCount}
      </p>

      {version === null ? (
        <EmptyState
          title="No revisions"
          description="This Entity has no EntityVersions yet. Its identity exists, but no content has been authored."
        />
      ) : (
        <dl className="prowess-detail-fields">
          <div className="prowess-detail-fields__row">
            <dt>Revision number</dt>
            <dd>{version.revisionNumber}</dd>
          </div>
          <div className="prowess-detail-fields__row">
            <dt>Status</dt>
            <dd>
              <VersionStatusBadge status={version.status} />
            </dd>
          </div>
          <div className="prowess-detail-fields__row">
            <dt>Display name</dt>
            <dd>{version.displayName}</dd>
          </div>
          <div className="prowess-detail-fields__row">
            <dt>Short description</dt>
            <dd>{version.shortDescription ?? <span className="prowess-detail-fields__empty">None</span>}</dd>
          </div>
          <div className="prowess-detail-fields__row">
            <dt>Rules text</dt>
            <dd className="prowess-detail-fields__rules-text">
              {version.rulesText ?? <span className="prowess-detail-fields__empty">None</span>}
            </dd>
          </div>
          <div className="prowess-detail-fields__row">
            <dt>Structured data</dt>
            <dd>
              <StructuredDataViewer data={version.structuredData} emptyLabel="No structured data" />
            </dd>
          </div>
          <div className="prowess-detail-fields__row">
            <dt>Change type</dt>
            <dd>{version.changeType ?? <span className="prowess-detail-fields__empty">None</span>}</dd>
          </div>
          <div className="prowess-detail-fields__row">
            <dt>Change summary</dt>
            <dd>{version.changeSummary ?? <span className="prowess-detail-fields__empty">None</span>}</dd>
          </div>
          <div className="prowess-detail-fields__row">
            <dt>Created</dt>
            <dd>{new Date(version.createdAt).toLocaleString()}</dd>
          </div>
          <div className="prowess-detail-fields__row">
            <dt>Updated</dt>
            <dd>{new Date(version.updatedAt).toLocaleString()}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
