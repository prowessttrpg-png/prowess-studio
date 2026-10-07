"use client";

import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { getRuleset } from "../../../../src/api-client";
import { Resource, useResource } from "../_components/primitives";
import { WorkspaceContext, WorkspaceHeader, WorkspaceTabs } from "../_components/workspace";

/** The Ruleset workspace (§3): one header + section tabs; each section is its own URL. */
export default function RulesetWorkspaceLayout({ children }: { children: ReactNode }) {
  const { rulesetId } = useParams<{ rulesetId: string }>();
  const ruleset = useResource(() => getRuleset(rulesetId), [rulesetId]);
  return (
    <div className="gov-workspace">
      <Resource state={ruleset}>
        {(data) => (
          <WorkspaceContext.Provider value={{ ruleset: data, reloadRuleset: ruleset.reload }}>
            <WorkspaceHeader ruleset={data} />
            <WorkspaceTabs rulesetId={data.id} />
            <div className="gov-workspace__body">{children}</div>
          </WorkspaceContext.Provider>
        )}
      </Resource>
    </div>
  );
}
