"use client";

import { EntityTypeBadge, VersionStatusBadge } from "@prowess/ui";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorState } from "../../_components/ErrorState";
import { LoadingState } from "../../_components/LoadingState";
import { getEntry, ReferenceApiError, type DefinitionReferenceDto, type EntryCardDto, type EntryDetailDto } from "../_lib/reference-client";
import {
  adminEntityHref,
  entryHref,
  libraryComparisonHref,
  libraryRevisionHref,
  readableToken,
  releaseHref,
  releaseName,
  rulesReferenceHref,
  rulesetReferenceHref,
} from "../_lib/reference-urls";
import { DefinitionPresenter } from "./DefinitionPresenter";
import { EntryCard } from "./EntryCard";

/**
 * One Entity AS ONE RELEASE PINS IT (PAS-10 M6-WO2). Everything on this page is the exact revision the Release's
 * manifest pins; the Entity's latest revision appears only as an indicator ("This Release uses Revision 3. Latest
 * Entity Revision is 5."), never as content. Links to other entries keep this Release. There are no edit controls —
 * "Open in Compendium Admin" hands off to the authoring workspace.
 */
export function EntryDetailView({ rulesetId, releaseId, entityId }: { rulesetId: string; releaseId: string; entityId: string }) {
  const [detail, setDetail] = useState<EntryDetailDto | null>(null);
  const [error, setError] = useState<ReferenceApiError | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetail(await getEntry(rulesetId, releaseId, entityId));
    } catch (e) {
      setError(e instanceof ReferenceApiError ? e : new ReferenceApiError("UNKNOWN_ERROR", "Something went wrong loading this entry.", 0));
    }
  }, [rulesetId, releaseId, entityId]);

  useEffect(() => {
    // Fetch-on-dependency-change: loading the entry IS the synchronization this effect performs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error !== null) {
    if (error.code === "COMPENDIUM_REFERENCE.ENTITY_NOT_IN_RELEASE") {
      return (
        <div className="prowess-reference" data-testid="reference-not-in-release">
          <h1>Not part of this Release</h1>
          <p role="alert">{error.message}</p>
          <p>
            The Rules Reference shows only what a Release pins. <Link href={releaseHref(rulesetId, releaseId)}>Back to this Release</Link> ·{" "}
            <Link href={`/compendium/entities/${encodeURIComponent(entityId)}`}>Open in the Entity Library (all revisions)</Link>
          </p>
        </div>
      );
    }
    return <ErrorState message={`${error.message}${error.code !== "UNKNOWN_ERROR" ? ` (${error.code})` : ""}`} onRetry={() => void load()} />;
  }
  if (detail === null) return <LoadingState label="Loading entry…" />;

  const pinned = detail.pinnedRevision;
  const refsByPath = new Map(detail.references.map((r) => [r.path, r] as const));
  const renderReference = (path: string) => {
    const r = refsByPath.get(path);
    return r === undefined ? null : <ReferenceLink reference={r} rulesetId={rulesetId} releaseId={releaseId} />;
  };
  const keywords = [
    ...detail.keywords.structured.map((k) => ({ key: k.canonicalKey, name: k.keyword?.name ?? null, unknown: k.keyword === null })),
    ...detail.keywords.assigned.filter((a) => !detail.keywords.structured.some((s) => s.canonicalKey === a.keyword.canonicalKey)).map((a) => ({ key: a.keyword.canonicalKey, name: a.keyword.name, unknown: false })),
  ];
  const outgoing = detail.relationships.filter((r) => r.direction === "OUTGOING");
  const incoming = detail.relationships.filter((r) => r.direction === "INCOMING");

  return (
    <article className="prowess-reference" data-testid="reference-entry">
      <nav className="gov-crumbs" aria-label="Breadcrumb">
        <Link href={rulesReferenceHref()}>Rules Reference</Link> / <Link href={rulesetReferenceHref(rulesetId)}>{detail.ruleset.name}</Link> /{" "}
        <Link href={releaseHref(rulesetId, releaseId)}>{releaseName(detail.release)}</Link> / <span aria-current="page">{pinned.displayName}</span>
      </nav>

      <header className="prowess-reference__header">
        <p className="gov-eyebrow">Rules Reference — {releaseName(detail.release)}</p>
        <h1>{pinned.displayName}</h1>
        <p className="gov-meta" data-testid="reference-entry-header">
          {detail.kind ? <span className="gov-badge">{readableToken(detail.kind.definitionKind)}</span> : <span className="gov-badge">Generic / non-Prowess Entity</span>}
          {detail.kind ? (
            <span className="gov-tag">
              {readableToken(detail.kind.systemFamily)}
              {detail.kind.branch && detail.kind.branch !== detail.kind.systemFamily ? ` / ${readableToken(detail.kind.branch)}` : ""}
            </span>
          ) : null}
          <EntityTypeBadge entityType={detail.entity.entityType} />
          <VersionStatusBadge status={pinned.status} />
          <span className="gov-tag">Pinned Revision {pinned.revisionNumber}</span>
        </p>
        <dl className="gov-dl">
          <dt>Canonical key</dt>
          <dd>
            <code>{detail.entity.canonicalKey}</code>
          </dd>
          <dt>Release</dt>
          <dd>{releaseName(detail.release)}</dd>
          <dt>Ruleset</dt>
          <dd>{detail.ruleset.name}</dd>
          <dt>Keywords</dt>
          <dd>
            {keywords.length === 0 ? (
              <span className="gov-muted">none</span>
            ) : (
              <ul className="prowess-reference__chips" aria-label="Keywords of this revision">
                {keywords.map((k) => (
                  <li key={k.key} className="prowess-keyword-chip">
                    {k.name ?? k.key}
                    {k.unknown ? " (not in the Keyword vocabulary)" : ""}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </dl>
        <p className="prowess-reference__pin" data-testid="reference-pin-indicator">
          {detail.latestRevisionNumber !== null && detail.latestRevisionNumber !== pinned.revisionNumber
            ? `This Release uses Revision ${pinned.revisionNumber}. Latest Entity Revision is ${detail.latestRevisionNumber}.`
            : `This Release uses Revision ${pinned.revisionNumber}, which is also the Entity's latest revision.`}{" "}
          <Link href={libraryRevisionHref(detail.entity.id, pinned.revisionNumber)}>View Revision History</Link>
        </p>
        <p className="gov-actions">
          <Link className="gov-button" href={adminEntityHref(detail.entity.id)}>
            Open in Compendium Admin
          </Link>
        </p>
      </header>

      {pinned.shortDescription ? <p className="prowess-reference__summary">{pinned.shortDescription}</p> : null}

      <section className="gov-panel prowess-reference__rules-text" aria-labelledby="ref-rules-text">
        <h2 id="ref-rules-text">Rules Text</h2>
        {pinned.rulesText ? <p className="prowess-detail-fields__rules-text">{pinned.rulesText}</p> : <p className="gov-muted">No Rules Text authored for this revision.</p>}
        <p className="gov-muted">Rules Text is prose for readers. The mechanics are the structured data below — nothing is derived from this text.</p>
      </section>

      <DefinitionPresenter detail={detail} renderReference={renderReference} />

      <section className="gov-panel" aria-labelledby="ref-referenced">
        <h2 id="ref-referenced">Referenced Definitions</h2>
        {detail.references.length === 0 ? <p className="gov-muted">This revision references no other Definition.</p> : null}
        <ul className="gov-list" aria-label="Referenced Definitions">
          {detail.references.map((r) => (
            <li key={r.path} className="gov-card gov-card--compact" data-testid="reference-definition">
              <p className="gov-muted">
                <code>{r.path}</code>
              </p>
              <ReferenceLink reference={r} rulesetId={rulesetId} releaseId={releaseId} />
            </li>
          ))}
        </ul>
        {detail.referencesTruncated ? <p className="gov-muted">Only the first references are listed — see Developer details for the full payload.</p> : null}
      </section>

      <section className="gov-panel" aria-labelledby="ref-referenced-by">
        <h2 id="ref-referenced-by">Referenced By (in this Release)</h2>
        {detail.referencedBy.length === 0 ? <p className="gov-muted">No other entry in this Release references this Entity.</p> : null}
        <CardList cards={detail.referencedBy} rulesetId={rulesetId} releaseId={releaseId} label="Referenced By" />
        {detail.referencedByTruncated ? <p className="gov-muted">More entries reference this Entity; the list is bounded.</p> : null}
      </section>

      <section className="gov-panel" aria-labelledby="ref-relationships">
        <h2 id="ref-relationships">Relationships</h2>
        <p className="gov-muted">Entity-level relationships, exactly as stored (not revision-pinned). No inverse is inferred.</p>
        {detail.relationships.length === 0 ? <p className="gov-muted">No relationships.</p> : null}
        {outgoing.length > 0 ? (
          <ul className="gov-list" aria-label="Outgoing relationships">
            {outgoing.map((r) => (
              <li key={r.relationship.id}>
                This Entity — <strong>{readableToken(r.relationship.relationshipType)}</strong> → <Counterpart rel={r} rulesetId={rulesetId} releaseId={releaseId} />
              </li>
            ))}
          </ul>
        ) : null}
        {incoming.length > 0 ? (
          <ul className="gov-list" aria-label="Incoming relationships">
            {incoming.map((r) => (
              <li key={r.relationship.id}>
                <Counterpart rel={r} rulesetId={rulesetId} releaseId={releaseId} /> — <strong>{readableToken(r.relationship.relationshipType)}</strong> → this Entity
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="gov-panel" aria-labelledby="ref-related-keyword">
        <h2 id="ref-related-keyword">Related by Keyword</h2>
        <p className="gov-muted">Other entries in this Release that share a structured Keyword. Sharing a Keyword is not a rules relationship.</p>
        {detail.relatedByKeyword.length === 0 ? <p className="gov-muted">None.</p> : null}
        <CardList cards={detail.relatedByKeyword} rulesetId={rulesetId} releaseId={releaseId} label="Related by Keyword" />
      </section>

      <section className="gov-panel" aria-labelledby="ref-sources">
        <h2 id="ref-sources">Sources &amp; Provenance</h2>
        <p className="gov-muted">Where this revision&apos;s content came from. Source authority describes provenance; it never changes which revision this Release pins.</p>
        {detail.sources.length === 0 ? <p className="gov-muted">No sources recorded for this revision.</p> : null}
        <ul className="gov-list" aria-label="Sources">
          {detail.sources.map((s) => (
            <li key={s.reference.id}>
              <strong>{s.document?.title ?? "Unknown source document"}</strong>
              {s.document?.versionLabel ? ` (${s.document.versionLabel})` : ""}
              {s.reference.sectionLabel ? ` — ${s.reference.sectionLabel}` : ""}
              {s.reference.pageReference ? `, p. ${s.reference.pageReference}` : ""}
              {s.document?.authorityStatus ? <span className="gov-tag">Authority: {readableToken(s.document.authorityStatus)}</span> : null}
              {s.reference.sourceExcerptNote ? <p className="gov-muted">{s.reference.sourceExcerptNote}</p> : null}
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}

/** An exact Definition reference: as authored, next to this Release's pin; never rewritten. */
function ReferenceLink({ reference: r, rulesetId, releaseId }: { reference: DefinitionReferenceDto; rulesetId: string; releaseId: string }) {
  const authored = r.authoredRevisionNumber !== null ? `Revision ${r.authoredRevisionNumber}` : "an unknown revision";
  if (!r.inRelease || r.pinned === null) {
    return (
      <span className="prowess-reference__ref prowess-reference__ref--absent" data-testid="reference-absent">
        <code>{r.authored.canonicalKey}</code> ({authored}) — Referenced Definition is not part of this Release.
      </span>
    );
  }
  return (
    <span className="prowess-reference__ref">
      <Link href={entryHref(rulesetId, releaseId, r.authored.entityId)}>{r.pinned.displayName}</Link> <code>{r.authored.canonicalKey}</code>
      {r.matchesPin ? (
        <span className="gov-tag">Revision {r.pinned.revisionNumber} (matches this Release)</span>
      ) : (
        <span className="gov-badge gov-badge--critical" data-testid="reference-mismatch">
          Version mismatch: the authored reference names {authored}; this Release pins Revision {r.pinned.revisionNumber}.
          {r.authoredRevisionNumber !== null ? (
            <>
              {" "}
              <Link href={libraryComparisonHref(r.authored.entityId, Math.min(r.authoredRevisionNumber, r.pinned.revisionNumber), Math.max(r.authoredRevisionNumber, r.pinned.revisionNumber))}>Compare revisions</Link>
            </>
          ) : null}
        </span>
      )}
    </span>
  );
}

function Counterpart({ rel, rulesetId, releaseId }: { rel: EntryDetailDto["relationships"][number]; rulesetId: string; releaseId: string }) {
  if (rel.counterpartPin === null) {
    return (
      <span>
        <code>{rel.counterpart.canonicalKey}</code> <span className="gov-muted">(not part of this Release)</span>
      </span>
    );
  }
  return (
    <span>
      <Link href={entryHref(rulesetId, releaseId, rel.counterpart.id)}>{rel.counterpartPin.displayName}</Link> <code>{rel.counterpart.canonicalKey}</code>
    </span>
  );
}

function CardList({ cards, rulesetId, releaseId, label }: { cards: EntryCardDto[]; rulesetId: string; releaseId: string; label: string }) {
  if (cards.length === 0) return null;
  return (
    <ul className="prowess-reference__cards" aria-label={label}>
      {cards.map((c) => (
        <EntryCard key={c.entityId} card={c} href={entryHref(rulesetId, releaseId, c.entityId)} />
      ))}
    </ul>
  );
}
