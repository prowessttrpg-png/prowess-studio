import { VersionStatusBadge, formatEnumLabel } from "@prowess/ui";
import Link from "next/link";
import type { EntityVersionDto } from "../_lib/api-client";

/**
 * Complete revision history (PAS-10 M1-WO10 §6). **Newest first** — chosen
 * deliberately: the Latest Revision (the default selection) sits at the top,
 * and the list reads like a changelog. Every revision is listed; none is
 * hidden or collapsed.
 *
 * The selected entry is communicated three ways that are not color: the
 * visible word "Selected", `aria-current="page"` on its link, and a heavier
 * border. The Latest entry carries the visible word "Latest Revision".
 * Each entry is a real link addressing `?revision=N`.
 *
 * Only the lifecycle status each Version currently has is shown; no
 * transition events are reconstructed (none are stored).
 */
export function VersionHistoryList({
  versions,
  selectedId,
  latestId,
  hrefForRevision,
}: {
  versions: EntityVersionDto[];
  selectedId: string | null;
  latestId: string | null;
  hrefForRevision: (revisionNumber: number) => string;
}) {
  const ordered = [...versions].sort((a, b) => b.revisionNumber - a.revisionNumber);

  return (
    <nav aria-label="Version History" className="prowess-version-history" data-testid="version-history">
      <h2 className="prowess-version-history__heading">Version History</h2>
      <ol className="prowess-version-history__list">
        {ordered.map((version) => {
          const selected = version.id === selectedId;
          const latest = version.id === latestId;
          return (
            <li
              key={version.id}
              className={`prowess-version-history__item${selected ? " prowess-version-history__item--selected" : ""}`}
              data-testid="history-entry"
              data-revision={version.revisionNumber}
              data-selected={selected}
            >
              <Link
                href={hrefForRevision(version.revisionNumber)}
                className="prowess-version-history__link"
                aria-current={selected ? "page" : undefined}
                data-testid={`history-link-${version.revisionNumber}`}
              >
                <span className="prowess-version-history__title">
                  Revision {version.revisionNumber}
                </span>
                {latest ? <span className="prowess-version-history__tag">Latest Revision</span> : null}
                {selected ? (
                  <span className="prowess-version-history__tag prowess-version-history__tag--selected">
                    Selected
                  </span>
                ) : null}
                <span className="prowess-version-history__name">{version.displayName}</span>
                <span className="prowess-version-history__meta">
                  <VersionStatusBadge status={version.status} />
                  <span>{new Date(version.createdAt).toLocaleDateString()}</span>
                  {version.changeType ? <span>{formatEnumLabel(version.changeType)}</span> : null}
                </span>
                {version.changeSummary ? (
                  <span className="prowess-version-history__summary">{version.changeSummary}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
