"use client";

import { formatEnumLabel } from "@prowess/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createRevision, getStatImpacts, type StatImpactRowDto, type StatImpactsDto } from "../../admin/_lib/authoring-client";
import { ErrorState } from "../../_components/ErrorState";
import { LoadingState } from "../../_components/LoadingState";
import { RulePreviewPanel } from "../../_components/RulePreviewPanel";
import { entryHref, releaseHref, revisionWorkspaceHref, releaseName, rulesReferenceHref, sectionHref, sectionsHref, statHref } from "../_lib/reference-urls";

/**
 * PRE-M7-WO1 — Stats → <Stat> → "What this affects", for ONE exact Release.
 *
 * Every row comes from the server's rule graph of the pinned Definitions (formula variable sources and structured
 * statistic fields), direct and indirect. Nothing here is a copy of a rule: "Edit this rule" opens (or creates) a Draft
 * revision of the Definition that OWNS the calculation, in the normal governed authoring workspace; publication still
 * goes through review and a new Release. The preview evaluates open Drafts without saving anything.
 */
const messageOf = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

const ROLE_LABEL: Record<StatImpactRowDto["role"], string> = {
  STAT: "Stat",
  DERIVED_STAT: "Calculated value",
  CORE_RESOLUTION: "Core procedure",
  DEFINITION: "Rule",
};

function ImpactRow({ row, rulesetId, releaseId, stat }: { row: StatImpactRowDto; rulesetId: string; releaseId: string; stat: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const def = row.definition;
  const editable = def !== null && (row.role === "DERIVED_STAT" || row.role === "CORE_RESOLUTION");
  async function edit() {
    if (def === null) return;
    setBusy(true);
    setError("");
    try {
      const created = await createRevision(def.entityId, { baseVersionId: def.entityVersionId, changeSummary: `Change how ${stat} contributes to ${formatEnumLabel(row.token)}` });
      router.push(revisionWorkspaceHref(def.entityId, created.id, releaseId, statHref(rulesetId, releaseId, stat)));
    } catch (e) {
      setError(messageOf(e, "Could not start a Draft of this rule."));
      setBusy(false);
    }
  }
  return (
    <li className="prowess-impact" data-testid={`impact-${row.token}`} data-direct={row.direct ? "true" : "false"}>
      <p>
        <strong>{def?.displayName ?? formatEnumLabel(row.token)}</strong> <span className="gov-tag">{ROLE_LABEL[row.role]}</span>{" "}
        {row.direct ? <span className="gov-tag">Reads {stat} directly</span> : <span className="gov-tag">Through {row.through.map((t) => t.displayName ?? formatEnumLabel(t.token)).join(" → ")}</span>}
      </p>
      {row.reads.map((r, i) => (
        <p key={i} className="gov-muted">
          {r.via === "CHOSEN_STAT" ? (
            <>Uses whichever Stat the player chooses for the roll (any Stat, including {stat}).</>
          ) : r.via === "STRUCTURED_FIELD" ? (
            <>
              Names this value in <code>{r.path}</code>.
            </>
          ) : (
            <>
              Formula: <code className="prowess-impact__formula">{r.expression}</code>
              {r.variable ? (
                <>
                  {" "}
                  — <code>{r.variable}</code> is {formatEnumLabel(r.from.split(":")[1] ?? r.from)}
                </>
              ) : null}
            </>
          )}
        </p>
      ))}
      <div className="gov-actions">
        {def !== null ? <Link href={entryHref(rulesetId, releaseId, def.entityId)}>View rule (revision {def.revisionNumber})</Link> : null}
        {editable && def !== null ? (
          def.openDraft !== null ? (
            <Link className="gov-button" href={revisionWorkspaceHref(def.entityId, def.openDraft.entityVersionId, releaseId, statHref(rulesetId, releaseId, stat))} data-testid={`impact-continue-${row.token}`}>
              Continue the open Draft (revision {def.openDraft.revisionNumber}, {formatEnumLabel(def.openDraft.status)})
            </Link>
          ) : (
            <button type="button" className="gov-button" onClick={() => void edit()} disabled={busy} data-testid={`impact-edit-${row.token}`}>
              {busy ? "Starting a Draft…" : "Edit this rule"}
            </button>
          )
        ) : null}
      </div>
      {error ? (
        <p className="gov-error" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function StatImpactPage({ rulesetId, releaseId, stat }: { rulesetId: string; releaseId: string; stat: string }) {
  const [data, setData] = useState<StatImpactsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await getStatImpacts(releaseId, stat));
    } catch (e) {
      setError(messageOf(e, "Could not load what this Stat affects."));
    }
  }, [releaseId, stat]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-dependency-change
    void load();
  }, [load]);

  if (error !== null) return <ErrorState message={error} onRetry={() => void load()} />;
  if (data === null) return <LoadingState label={`Loading ${stat}…`} />;
  const direct = data.impacts.filter((i) => i.direct);
  const indirect = data.impacts.filter((i) => !i.direct);
  const drafts = [...new Set(data.impacts.flatMap((i) => (i.definition?.openDraft ? [i.definition.openDraft.entityVersionId] : [])))];
  const range = data.payload as { minimum?: number; maximum?: number } | null;
  return (
    <div className="prowess-reference" data-testid="stat-impacts" data-stat={stat}>
      <nav className="gov-crumbs" aria-label="Breadcrumb">
        <Link href={rulesReferenceHref()}>Rules Reference</Link> / <Link href={releaseHref(rulesetId, releaseId)}>{releaseName(data.release)}</Link> /{" "}
        <Link href={sectionsHref(rulesetId, releaseId)}>Topics</Link> / <Link href={sectionHref(rulesetId, releaseId, "stats")}>Stats</Link> / <span aria-current="page">{data.definition?.displayName ?? stat}</span>
      </nav>
      <header className="prowess-reference__header">
        <p className="gov-eyebrow">Stats — {releaseName(data.release)}</p>
        <h1>{data.definition?.displayName ?? stat}</h1>
        {data.shortDescription ? <p>{data.shortDescription}</p> : null}
        <p className="gov-meta">
          <span className="gov-tag">{stat}</span>
          {range && typeof range.minimum === "number" ? (
            <span className="gov-tag">
              Range {range.minimum}–{range.maximum}
            </span>
          ) : null}
          {data.definition ? <Link href={entryHref(rulesetId, releaseId, data.definition.entityId)}>View the Stat rule</Link> : null}
        </p>
        <p>
          <Link href={sectionHref(rulesetId, releaseId, "stats")} data-testid="stat-back">
            ← Stats
          </Link>
        </p>
      </header>

      <section aria-labelledby="affects-heading" data-testid="stat-affects">
        <h2 id="affects-heading">What this affects</h2>
        <p className="gov-muted">Built from the rules pinned in this Release. To change a contribution, edit the rule that owns it — the change becomes a Draft and reaches play only after review and a new Release.</p>
        {data.impacts.length === 0 ? <p data-testid="stat-affects-none">No rule in this Release reads {stat}.</p> : null}
        {direct.length > 0 ? (
          <>
            <h3>Directly</h3>
            <ul className="prowess-impacts" data-testid="stat-affects-direct">
              {direct.map((r) => (
                <ImpactRow key={`${r.role}:${r.token}`} row={r} rulesetId={rulesetId} releaseId={releaseId} stat={stat} />
              ))}
            </ul>
          </>
        ) : null}
        {indirect.length > 0 ? (
          <>
            <h3>Through other values</h3>
            <ul className="prowess-impacts" data-testid="stat-affects-indirect">
              {indirect.map((r) => (
                <ImpactRow key={`${r.role}:${r.token}`} row={r} rulesetId={rulesetId} releaseId={releaseId} stat={stat} />
              ))}
            </ul>
          </>
        ) : null}
        <details>
          <summary>What this list does not include</summary>
          <ul>
            {data.limits.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </details>
      </section>

      <section aria-label="Add a contribution" className="gov-card gov-card--compact">
        <h2>Make {stat} affect something new</h2>
        <p>Open the calculated value that should use {stat} — for example from Rules &amp; Calculations — and add {stat} as a contribution in its formula. It will then appear in this list.</p>
        <Link href={sectionHref(rulesetId, releaseId, "rules-calculations")}>Go to Rules &amp; Calculations</Link>
      </section>

      <RulePreviewPanel releaseId={releaseId} drafts={drafts} vary={stat} title={drafts.length === 0 ? "Preview (no open Drafts)" : "Preview the open Drafts"} />
    </div>
  );
}
