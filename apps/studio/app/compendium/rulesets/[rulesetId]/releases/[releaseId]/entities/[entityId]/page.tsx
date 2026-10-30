"use client";

import { use } from "react";
import { EntryDetailView } from "../../../../../_components/EntryDetailView";

/** /compendium/rulesets/:rulesetId/releases/:releaseId/entities/:entityId — one Entity as this Release pins it (M6-WO2). */
export default function ReferenceEntryPage({ params }: { params: Promise<{ rulesetId: string; releaseId: string; entityId: string }> }) {
  const { rulesetId, releaseId, entityId } = use(params);
  return <EntryDetailView key={`${releaseId}/${entityId}`} rulesetId={rulesetId} releaseId={releaseId} entityId={entityId} />;
}
