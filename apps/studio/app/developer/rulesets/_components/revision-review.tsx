"use client";

import { useEffect, useState } from "react";
import { approveReviewedRevision, readRevisionForReview } from "../../../../src/api-client/review";
import type { EntityVersionDto } from "../../../../src/api-client";
import { ConfirmButton, ErrorPanel } from "./primitives";

/**
 * PAS-10 M6-WO12 — the proposed revision's review state on a ChangeSet operation (gap fix). Publication refuses a pinned
 * revision that is still DRAFT or IN_REVIEW, so a reviewer must be able to approve the exact revision the ChangeSet
 * proposes. Only an IN_REVIEW revision offers "Approve revision"; the server's lifecycle check decides. The status is
 * read fresh (never from the label cache) and re-read after the command. Approval changes no ChangeSet and publishes
 * nothing.
 */
export function RevisionReview({ versionId, onChanged }: { versionId: string; onChanged?: () => void }) {
  const [version, setVersion] = useState<EntityVersionDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    readRevisionForReview(versionId).then((v) => live && setVersion(v), (e: unknown) => live && setError(e));
    return () => {
      live = false;
    };
  }, [versionId, tick]);
  if (version === null) return error ? <ErrorPanel error={error} title="Could not read the proposed revision" /> : null;
  return (
    <div className="gov-actions" data-testid="revision-review" data-status={version.status} data-version={version.id}>
      <span>
        Proposed revision status: <strong data-testid="revision-review-status">{version.status}</strong>
      </span>
      {version.status === "IN_REVIEW" ? (
        <ConfirmButton
          label={`Approve revision r${String(version.revisionNumber)}`}
          confirm={`Approve r${String(version.revisionNumber)} — ${version.displayName}? An approved revision can no longer be edited. Approval publishes nothing.`}
          tone="consequential"
          onConfirm={async () => {
            setError(null);
            try {
              await approveReviewedRevision(version.id);
            } catch (e) {
              setError(e);
            }
            setTick((t) => t + 1);
            onChanged?.();
          }}
        />
      ) : null}
      {version.status === "DRAFT" ? <span className="gov-muted">Still a Draft — submit it for review in Compendium Admin first.</span> : null}
      {error ? <ErrorPanel error={error} title="Approval failed" /> : null}
    </div>
  );
}
