"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  CompendiumApiError,
  getEntity,
  getEntityRelationships,
  listEntityAliases,
  listEntityKeywords,
  listEntityVersions,
  type EntityAliasDto,
  type EntityDto,
  type EntityRelationshipsResult,
  type EntityVersionDto,
  type KeywordAssignmentDto,
} from "../_lib/api-client";
import { buildDetailHref } from "../_lib/detail-url";
import {
  findLatestVersion,
  findVersionByRevision,
  resolveParentLineage,
  resolveRevisionSelection,
} from "../_lib/revision-selection";
import { useVersionDetails } from "../_lib/use-version-details";
import { AliasList } from "./AliasList";
import { ComparisonControls } from "./ComparisonControls";
import { ErrorState } from "./ErrorState";
import { IdentitySection } from "./IdentitySection";
import { KeywordSection } from "./KeywordSection";
import { LoadingState } from "./LoadingState";
import { RelationshipSection } from "./RelationshipSection";
import { RevisionComparison } from "./RevisionComparison";
import { RevisionSection } from "./RevisionSection";
import { SourceReferenceSection } from "./SourceReferenceSection";
import { VersionHistoryList } from "./VersionHistoryList";
import { VersionScopedSection } from "./VersionScopedSection";

interface StableData {
  entity: EntityDto;
  versions: EntityVersionDto[];
  aliases: EntityAliasDto[];
  entityKeywords: KeywordAssignmentDto[];
  relationships: EntityRelationshipsResult;
}

const NO_VERSIONS: EntityVersionDto[] = [];

/**
 * The Entity detail workspace (PAS-10 M1-WO9 §15–27, M1-WO10).
 *
 * Two data scopes are kept strictly apart:
 *  - STABLE, Entity-level data (identity, the Version list, aliases, Entity
 *    Keywords, relationships) loads ONCE per Entity and is never refetched
 *    when the selected revision changes;
 *  - VERSION-SCOPED data (a revision's Keywords and Sources) loads per
 *    selected revision via `useVersionDetails`, with its own local loading
 *    and error states, so a failure there never erases the Entity.
 *
 * The selected revision lives in the URL (`?revision=N`), so refresh,
 * back/forward and direct links all work. An unknown `?revision=` renders a
 * clear not-found state rather than silently falling back to the Latest
 * Revision. The Version content itself comes from the Entity's Version
 * list (which already returns full snapshots), so selecting a revision
 * costs no extra request for its content.
 *
 * Read-only: nothing here edits, transitions, creates, or deletes.
 */
export function EntityDetailView({ entityId }: { entityId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [stable, setStable] = useState<StableData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");

  async function loadStable() {
    setStatus("loading");
    try {
      const [entity, versions, aliases, entityKeywords, relationships] = await Promise.all([
        getEntity(entityId),
        listEntityVersions(entityId),
        listEntityAliases(entityId),
        listEntityKeywords(entityId),
        getEntityRelationships(entityId),
      ]);
      setStable({ entity, versions, aliases, entityKeywords, relationships });
      setStatus("ready");
    } catch (error) {
      setErrorMessage(
        error instanceof CompendiumApiError
          ? error.message
          : "Something went wrong loading this Entity.",
      );
      setStatus("error");
    }
  }

  useEffect(() => {
    // Same data-fetch-on-dependency-change pattern as the Compendium list
    // page — see its own comment on the equivalent effect for the full
    // justification. Keyed on entityId only: changing the selected
    // revision must NOT reload stable Entity-level data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  const versions = stable?.versions ?? NO_VERSIONS;
  const revisionParam = searchParams.get("revision");
  const compareAParam = searchParams.get("compareA") ?? "";
  const compareBParam = searchParams.get("compareB") ?? "";

  const selection = useMemo(
    () => resolveRevisionSelection(versions, revisionParam),
    [versions, revisionParam],
  );
  const latest = useMemo(() => findLatestVersion(versions), [versions]);
  const versionA = useMemo(
    () => (compareAParam === "" ? null : findVersionByRevision(versions, compareAParam)),
    [versions, compareAParam],
  );
  const versionB = useMemo(
    () => (compareBParam === "" ? null : findVersionByRevision(versions, compareBParam)),
    [versions, compareBParam],
  );

  const idsToLoad = useMemo(() => {
    const ids = new Set<string>();
    if (selection.kind === "ok") ids.add(selection.version.id);
    if (versionA) ids.add(versionA.id);
    if (versionB) ids.add(versionB.id);
    return [...ids];
  }, [selection, versionA, versionB]);
  const details = useVersionDetails(idsToLoad);

  if (status === "loading" && stable === null) {
    return <LoadingState label="Loading Entity…" />;
  }
  if (status === "error" || stable === null) {
    return <ErrorState message={errorMessage} onRetry={() => void loadStable()} />;
  }

  const hrefForRevision = (revisionNumber: number) =>
    buildDetailHref(entityId, searchParams, { revision: String(revisionNumber) });
  const latestHref = buildDetailHref(entityId, searchParams, { revision: null });

  function updateCompare(a: string, b: string) {
    router.push(buildDetailHref(entityId, searchParams, { compareA: a || null, compareB: b || null }));
  }

  function renderComparison() {
    if (compareAParam === "" && compareBParam === "") {
      return null;
    }
    const missing = [
      compareAParam !== "" && versionA === null ? compareAParam : null,
      compareBParam !== "" && versionB === null ? compareBParam : null,
    ].filter((value): value is string => value !== null);
    if (missing.length > 0) {
      return (
        <p role="alert" data-testid="comparison-invalid">
          Revision {missing.join(" and ")} {missing.length === 1 ? "was" : "were"} not found among this
          Entity&rsquo;s revisions.
        </p>
      );
    }
    if (versionA === null || versionB === null) {
      return <p role="status">Select both Revision A and Revision B to compare them.</p>;
    }
    if (versionA.id === versionB.id) {
      return <p role="status">Choose two different revisions to compare.</p>;
    }
    const stateA = details.get(versionA.id);
    const stateB = details.get(versionB.id);
    return (
      <RevisionComparison
        a={{ version: versionA, keywords: stateA.keywords, sources: stateA.sources }}
        b={{ version: versionB, keywords: stateB.keywords, sources: stateB.sources }}
      />
    );
  }

  const selectedVersion = selection.kind === "ok" ? selection.version : null;
  const selectedState = selectedVersion ? details.get(selectedVersion.id) : null;
  const isLatest = selection.kind === "ok" && selection.isLatest;
  const revisionLabel = selectedVersion ? `Revision ${selectedVersion.revisionNumber}` : "";

  return (
    <div className="prowess-entity-detail">
      <p className="prowess-entity-detail__back">
        <Link href="/compendium">&larr; Back to Compendium</Link>
      </p>

      <IdentitySection entity={stable.entity} />

      {versions.length === 0 ? (
        <RevisionSection version={null} versionCount={0} isLatest />
      ) : (
        <div className="prowess-history-layout">
          <VersionHistoryList
            versions={versions}
            selectedId={selectedVersion?.id ?? null}
            latestId={latest?.id ?? null}
            hrefForRevision={hrefForRevision}
          />

          <div className="prowess-selected-revision" data-testid="selected-revision-group">
            {selection.kind === "not-found" ? (
              <section
                aria-labelledby="revision-not-found-heading"
                role="alert"
                data-testid="revision-not-found"
              >
                <h2 id="revision-not-found-heading">Revision not found</h2>
                <p>
                  Revision {selection.requested} does not exist for this Entity, so no revision is
                  selected. The page has not substituted another revision in its place.
                </p>
                <p>
                  <Link href={latestHref} className="prowess-return-to-latest">
                    Return to Latest Revision
                  </Link>
                </p>
              </section>
            ) : null}

            {selectedVersion && selectedState ? (
              <>
                <RevisionSection
                  version={selectedVersion}
                  versionCount={versions.length}
                  isLatest={isLatest}
                  latestHref={latestHref}
                  parent={resolveParentLineage(selectedVersion, versions)}
                  parentHref={hrefForRevision}
                />

                <VersionScopedSection
                  heading={isLatest ? "Latest Revision Keywords" : `Version Keywords — ${revisionLabel}`}
                  headingId={isLatest ? "latest-revision-keywords-heading" : "selected-revision-keywords-heading"}
                  state={selectedState.keywords}
                  loadingLabel="Loading Keywords…"
                  onRetry={() => details.retry(selectedVersion.id, "keywords")}
                >
                  {(assignments) => (
                    <KeywordSection
                      heading={isLatest ? "Latest Revision Keywords" : `Version Keywords — ${revisionLabel}`}
                      headingId={isLatest ? "latest-revision-keywords-heading" : "selected-revision-keywords-heading"}
                      assignments={assignments}
                      emptyLabel={isLatest ? "No Latest Revision Keywords" : `No Keywords on ${revisionLabel}`}
                      testId="version-keyword-section"
                    />
                  )}
                </VersionScopedSection>

                <VersionScopedSection
                  heading={isLatest ? "Sources for Latest Revision" : `Sources for ${revisionLabel}`}
                  headingId="sources-heading"
                  state={selectedState.sources}
                  loadingLabel="Loading Sources…"
                  onRetry={() => details.retry(selectedVersion.id, "sources")}
                >
                  {(sources) => (
                    <SourceReferenceSection
                      references={sources.references}
                      documents={sources.documents}
                      heading={isLatest ? "Sources for Latest Revision" : `Sources for ${revisionLabel}`}
                    />
                  )}
                </VersionScopedSection>
              </>
            ) : null}
          </div>
        </div>
      )}

      {versions.length > 0 ? (
        <>
          <ComparisonControls
            versions={versions}
            revisionA={compareAParam}
            revisionB={compareBParam}
            onChange={updateCompare}
            onClear={() => updateCompare("", "")}
          />
          {renderComparison()}
        </>
      ) : null}

      <div className="prowess-stable-group" data-testid="stable-entity-sections">
        <p className="prowess-stable-group__note">
          The sections below belong to the Entity itself and stay the same whichever revision is
          selected.
        </p>

        <AliasList aliases={stable.aliases} />

        <KeywordSection
          heading="Entity Keywords"
          headingId="entity-keywords-heading"
          assignments={stable.entityKeywords}
          emptyLabel="No Entity Keywords"
        />

        <RelationshipSection
          heading="Outgoing Relationships"
          headingId="outgoing-relationships-heading"
          relationships={stable.relationships.outgoing}
          emptyLabel="No outgoing relationships"
        />

        <RelationshipSection
          heading="Incoming Relationships"
          headingId="incoming-relationships-heading"
          relationships={stable.relationships.incoming}
          emptyLabel="No incoming relationships"
        />
      </div>
    </div>
  );
}
