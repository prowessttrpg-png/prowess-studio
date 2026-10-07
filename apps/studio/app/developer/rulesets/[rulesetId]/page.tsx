"use client";

import Link from "next/link";
import { useState } from "react";
import { approveRuleset, getRuleset, listChangeSets, listConflicts, listDecisions, listManifests, listPolicies, listReleases, submitRulesetForReview } from "../../../../src/api-client";
import { ConfirmButton, ErrorPanel, ImmutableNote, Resource, StatusBadge, useResource } from "../_components/primitives";
import { SectionCrumbs, sectionHref, useWorkspace } from "../_components/workspace";
import { canPublish, rulesetCommands } from "../_lib/presentation";

/** Overview (§9–§11): identity, counts from the list endpoints' totals, and only the valid named commands. */
export default function RulesetOverviewPage() {
  const { ruleset, reloadRuleset } = useWorkspace();
  const [error, setError] = useState<unknown>(null);
  const parent = useResource(() => (ruleset.parentRulesetId ? getRuleset(ruleset.parentRulesetId) : Promise.resolve(null)), [ruleset.parentRulesetId]);
  const counts = useResource(async () => {
    const total = async (p: Promise<{ items: unknown[]; pagination: { total: number } | null }>) => {
      const r = await p;
      return r.pagination?.total ?? r.items.length;
    };
    const [manifests, policies, openConflicts, decisions, changeSets, releases] = await Promise.all([
      total(listManifests(ruleset.id)),
      total(listPolicies(ruleset.id)),
      total(listConflicts(ruleset.id, { status: "OPEN" })),
      total(listDecisions(ruleset.id)),
      total(listChangeSets(ruleset.id)),
      total(listReleases(ruleset.id)),
    ]);
    return { manifests, policies, openConflicts, decisions, changeSets, releases };
  }, [ruleset.id]);
  const run = async (command: string) => {
    setError(null);
    try {
      if (command === "submit-review") await submitRulesetForReview(ruleset.id);
      else await approveRuleset(ruleset.id);
      reloadRuleset();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <section aria-labelledby="overview-heading">
      <SectionCrumbs />
      <h2 id="overview-heading">Overview</h2>
      <dl className="gov-dl">
        <dt>Name</dt>
        <dd>{ruleset.name}</dd>
        <dt>Canonical key</dt>
        <dd>
          <code>{ruleset.canonicalKey}</code>
        </dd>
        <dt>Description</dt>
        <dd>{ruleset.description ?? "—"}</dd>
        <dt>Status</dt>
        <dd>
          <StatusBadge value={ruleset.status} kind="ruleset-status" />
        </dd>
        <dt>Channel</dt>
        <dd>
          <StatusBadge value={ruleset.channel} kind="channel" />
        </dd>
        <dt>Version label</dt>
        <dd>{ruleset.versionLabel ?? "—"}</dd>
        <dt>Parent Ruleset</dt>
        <dd>{ruleset.parentRulesetId ? <Link href={sectionHref(ruleset.parentRulesetId, "")}>{parent.data?.name ?? ruleset.parentRulesetId}</Link> : "—"}</dd>
      </dl>

      <Resource state={counts}>
        {(c) => (
          <ul className="gov-counts" aria-label="Ruleset summary">
            <li><Link href={sectionHref(ruleset.id, "manifests")}>{c.manifests} Manifests</Link></li>
            <li><Link href={sectionHref(ruleset.id, "policies")}>{c.policies} Canon Policies</Link></li>
            <li><Link href={sectionHref(ruleset.id, "conflicts")}>{c.openConflicts} open Conflicts</Link></li>
            <li><Link href={sectionHref(ruleset.id, "decisions")}>{c.decisions} Decisions</Link></li>
            <li><Link href={sectionHref(ruleset.id, "change-sets")}>{c.changeSets} ChangeSets</Link></li>
            <li><Link href={sectionHref(ruleset.id, "releases")}>{c.releases} Releases</Link></li>
          </ul>
        )}
      </Resource>

      <h3>Lifecycle</h3>
      <div className="gov-actions" data-testid="ruleset-commands">
        {rulesetCommands(ruleset.status).map((cmd) => (
          <ConfirmButton key={cmd.command} label={cmd.label} confirm={cmd.confirm} tone={cmd.tone} onConfirm={() => run(cmd.command)} />
        ))}
        {canPublish(ruleset.status) ? (
          <p>
            This Ruleset can publish Releases. <Link href={sectionHref(ruleset.id, "releases")}>Go to Releases</Link>
          </p>
        ) : null}
        {ruleset.status === "DEPRECATED" || ruleset.status === "ARCHIVED" ? <ImmutableNote>No review commands are available for this status.</ImmutableNote> : null}
      </div>
      {error ? <ErrorPanel error={error} title="Lifecycle command failed" /> : null}
    </section>
  );
}
