"use client";

import { EmptyState } from "@prowess/ui";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { canonManagerRulesetHref } from "../../../../src/navigation";
import { listAllRulesets } from "../../../../src/api-client/governance";
import type { RulesetDto } from "../../../../src/api-client/types";
import { ErrorState } from "../../_components/ErrorState";
import { LoadingState } from "../../_components/LoadingState";
import { listReleases, ReferenceApiError, type ReleaseSummaryDto, type RulesetSummaryDto } from "../_lib/reference-client";
import { formatDate, readableToken, releaseHref, releaseName, rulesReferenceHref, rulesetReferenceHref } from "../_lib/reference-urls";
import { ViewLatestReleaseButton } from "./ReleaseControls";

const errorText = (e: unknown) => (e instanceof ReferenceApiError ? `${e.message} (${e.code})` : "Something went wrong.");

/** /compendium/rulesets — choose a Ruleset to read. Every page of Rulesets is followed (no silent truncation). */
export function RulesReferenceHome() {
  const [rulesets, setRulesets] = useState<RulesetDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setRulesets(await listAllRulesets());
    } catch {
      setError("Could not load Rulesets.");
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void load();
  }, [load]);
  return (
    <div className="prowess-reference" data-testid="rules-reference-home">
      <header className="prowess-reference__header">
        <p className="gov-eyebrow">Compendium</p>
        <h1>Rules Reference</h1>
        <p>Read the rules exactly as a published Release defines them. Choose a Ruleset, then a Release.</p>
      </header>
      {error !== null ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {rulesets === null && error === null ? <LoadingState label="Loading Rulesets…" /> : null}
      {rulesets !== null && rulesets.length === 0 ? <EmptyState title="No Rulesets exist" description="Rulesets are created in the Canon Manager." /> : null}
      {rulesets !== null && rulesets.length > 0 ? (
        <ul className="gov-list" aria-label="Rulesets">
          {rulesets.map((r) => (
            <li key={r.id} className="gov-card gov-card--compact">
              <Link href={rulesetReferenceHref(r.id)}>{r.name}</Link> <code className="gov-muted">{r.canonicalKey}</code>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * /compendium/rulesets/:rulesetId — a Ruleset's Release History (PAS-10 M6-WO2). A Ruleset with no Release says so
 * explicitly and links to the Canon Manager and the Entity Library: the Rules Reference never falls back to unreleased
 * content.
 */
export function RulesetReference({ rulesetId }: { rulesetId: string }) {
  const [data, setData] = useState<{ ruleset: RulesetSummaryDto; releases: ReleaseSummaryDto[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await listReleases(rulesetId));
    } catch (e) {
      setError(errorText(e));
    }
  }, [rulesetId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-dependency-change
    void load();
  }, [load]);
  if (error !== null) return <ErrorState message={error} onRetry={() => void load()} />;
  if (data === null) return <LoadingState label="Loading Releases…" />;
  return (
    <div className="prowess-reference" data-testid="reference-ruleset">
      <nav className="gov-crumbs" aria-label="Breadcrumb">
        <Link href={rulesReferenceHref()}>Rules Reference</Link> / <span aria-current="page">{data.ruleset.name}</span>
      </nav>
      <header className="prowess-reference__header">
        <p className="gov-eyebrow">Rules Reference</p>
        <h1>{data.ruleset.name}</h1>
      </header>
      {data.releases.length === 0 ? (
        <div className="gov-panel" data-testid="reference-no-releases">
          <h2>No Releases yet</h2>
          <p>
            This Ruleset has not published a Release, so there is nothing to show in the Rules Reference. The Rules Reference shows published Releases only — it never shows unreleased content in
            their place.
          </p>
          <p className="gov-actions">
            <Link href={canonManagerRulesetHref(rulesetId)}>Open this Ruleset in the Canon Manager</Link>
            <Link href="/compendium">Browse the Entity Library</Link>
          </p>
        </div>
      ) : (
        <section className="gov-panel" aria-labelledby="ref-history">
          <h2 id="ref-history">Release History</h2>
          <p className="gov-actions">
            <ViewLatestReleaseButton rulesetId={rulesetId} />
          </p>
          <ol className="gov-list" aria-label="Release History" reversed>
            {[...data.releases].reverse().map((r) => (
              <li key={r.id} className="gov-card gov-card--compact" data-testid="reference-release-row">
                <Link href={releaseHref(rulesetId, r.id)}>{releaseName(r)}</Link>
                <p className="gov-meta">
                  <span className="gov-tag">{readableToken(r.channel)}</span>
                  <span className="gov-tag">Published {formatDate(r.publishedAt)}</span>
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
