"use client";

import { Suspense, use } from "react";
import { EntityWorkspace } from "../../_components/EntityWorkspace";

/** /compendium/admin/entities/:entityId — manage an existing Entity (PAS-10 M6-WO1 §4; PRE-M7-WO1 reads its Release context). */
export default function AuthoringEntityPage({ params }: { params: Promise<{ entityId: string }> }) {
  const { entityId } = use(params);
  return (
    <Suspense fallback={<p role="status">Loading Entity…</p>}>
      <EntityWorkspace key={entityId} entityId={entityId} />
    </Suspense>
  );
}
