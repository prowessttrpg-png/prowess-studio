import { EmptyState, VersionStatusBadge } from "@prowess/ui";
import Link from "next/link";
import type { EntityVersionDto } from "../_lib/api-client";
import type { ParentLineage } from "../_lib/revision-selection";
import { StructuredDataViewer } from "./StructuredDataViewer";

/**
 * The revision content area (PAS-10 M1-WO10 §2, §5). Generalizes M1-WO9's
 * "Latest Revision" section: when `isLatest` it is titled exactly "Latest
 * Revision"; when a deliberately-selected older revision is shown it is
 * titled "Selected Revision — Revision N" and offers an explicit "Return
 * to Latest Revision" link (the page never silently snaps back).
 *
 * "Latest" means only the highest revision number — no revision is
 * automatically authoritative. A CANON status appears solely as the
 * literal lifecycle-status badge.
 *
 * Parent lineage comes from the real `parentVersionId` (via `parent`), not
 * from `revisionNumber - 1`. There is no lifecycle-event history here: the
 * database stores each Version's current status, not a transition log, so
 * no "approved on…" timestamps are shown or invented.
 */
export function RevisionSection({
  version,
  versionCount,
  isLatest,
  latestHref,
  parent = { kind: "none" },
  parentHref,
}: {
  version: EntityVersionDto | null;
  versionCount: number;
  isLatest: boolean;
  latestHref?: string;
  parent?: ParentLineage;
  parentHref?: (revisionNumber: number) => string;
}) {
  const showAsLatest = version === null || isLatest;
  const headingId = showAsLatest ? "latest-revision-heading" : "selected-revision-heading";
  const heading = showAsLatest
    ? "Latest Revision"
    : `Selected Revision — Revision ${version.revisionNumber}`;

  return (
    <section
      aria-labelledby={headingId}
      data-testid={showAsLatest ? "latest-revision-section" : "selected-revision-section"}
    >
      <h2 id={headingId}>{heading}</h2>
      <p className="prowess-detail-versions-count">Versions: {versionCount}</p>

      {!showAsLatest && latestHref ? (
        <p>
          <Link href={latestHref} className="prowess-return-to-latest">
            Return to Latest Revision
          </Link>
        </p>
      ) : null}

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
            <dt>Parent</dt>
            <dd data-testid="revision-parent">
              {parent.kind === "none" ? (
                <span className="prowess-detail-fields__empty">None (no parent revision)</span>
              ) : null}
              {parent.kind === "found" ? (
                parentHref ? (
                  <Link href={parentHref(parent.parent.revisionNumber)}>
                    Revision {parent.parent.revisionNumber}
                  </Link>
                ) : (
                  <>Revision {parent.parent.revisionNumber}</>
                )
              ) : null}
              {parent.kind === "missing" ? (
                <span className="prowess-detail-fields__empty">
                  Unavailable (not among this Entity&rsquo;s revisions)
                </span>
              ) : null}
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
              <StructuredDataViewer
                data={version.structuredData}
                emptyLabel="No structured data"
                label={`Structured data, Revision ${version.revisionNumber}`}
              />
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
