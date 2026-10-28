"use client";

import { Suspense, use } from "react";
import { RevisionWorkspace } from "../../../../_components/RevisionWorkspace";

/** /compendium/admin/entities/:entityId/revisions/:versionId — edit / validate one revision (PAS-10 M6-WO1 §4). */
export default function AuthoringRevisionPage({ params }: { params: Promise<{ entityId: string; versionId: string }> }) {
  const { entityId, versionId } = use(params);
  return (
    <Suspense fallback={<p role="status">Loading revision…</p>}>
      <RevisionWorkspace key={versionId} entityId={entityId} versionId={versionId} />
    </Suspense>
  );
}
