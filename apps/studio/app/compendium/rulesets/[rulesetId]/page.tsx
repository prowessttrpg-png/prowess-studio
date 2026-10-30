"use client";

import { use } from "react";
import { RulesetReference } from "../_components/RulesetReference";

/** /compendium/rulesets/:rulesetId — a Ruleset's Release History (PAS-10 M6-WO2). */
export default function RulesetReferencePage({ params }: { params: Promise<{ rulesetId: string }> }) {
  const { rulesetId } = use(params);
  return <RulesetReference key={rulesetId} rulesetId={rulesetId} />;
}
