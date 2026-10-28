"use client";

import { use } from "react";
import { EntityWorkspace } from "../../_components/EntityWorkspace";

/** /compendium/admin/entities/:entityId — manage an existing Entity (PAS-10 M6-WO1 §4). */
export default function AuthoringEntityPage({ params }: { params: Promise<{ entityId: string }> }) {
  const { entityId } = use(params);
  return <EntityWorkspace key={entityId} entityId={entityId} />;
}
