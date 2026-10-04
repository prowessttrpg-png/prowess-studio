"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { AliasList } from "../../_components/AliasList";
import { ErrorState } from "../../_components/ErrorState";
import { IdentitySection } from "../../_components/IdentitySection";
import { KeywordSection } from "../../_components/KeywordSection";
import { LatestRevisionSection } from "../../_components/LatestRevisionSection";
import { LoadingState } from "../../_components/LoadingState";
import { RelationshipSection } from "../../_components/RelationshipSection";
import { SourceReferenceSection } from "../../_components/SourceReferenceSection";
import {
  CompendiumApiError,
  getEntity,
  getEntityRelationships,
  listEntityAliases,
  listEntityKeywords,
  listEntityVersionKeywords,
  listEntityVersions,
  listEntityVersionSources,
  resolveSourceDocuments,
  type EntityDto,
  type EntityAliasDto,
  type EntityRelationshipsResult,
  type EntityVersionDto,
  type KeywordAssignmentDto,
  type SourceDocumentDto,
  type SourceReferenceDto,
} from "../../_lib/api-client";

interface DetailData {
  entity: EntityDto;
  versions: EntityVersionDto[];
  aliases: EntityAliasDto[];
  entityKeywords: KeywordAssignmentDto[];
  relationships: EntityRelationshipsResult;
  latestRevisionKeywords: KeywordAssignmentDto[];
  sources: SourceReferenceDto[];
  sourceDocuments: Map<string, SourceDocumentDto>;
}

/**
 * Entity detail page (PAS-10 M1-WO9 §15–27). Composes the existing
 * M1-WO8 endpoints rather than a single large "everything" endpoint
 * (§27): Entity identity, Versions, aliases, Entity Keywords, and
 * relationships load in parallel (none depends on another); once the
 * highest-`revisionNumber` Version (the "Latest Revision" — never
 * "current"/"Canon") is known from that result, its Version-level
 * Keywords and Sources load as a second parallel batch. SourceDocument
 * titles are then resolved for the (typically small) set of distinct
 * documents referenced — see `_lib/api-client.ts`'s
 * `resolveSourceDocuments` doc comment for why this stays a client-side
 * composition rather than a backend change.
 */
export default function EntityDetailPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = use(params);
  const [data, setData] = useState<DetailData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");

  async function load() {
    setStatus("loading");
    try {
      const [entity, versions, aliases, entityKeywords, relationships] = await Promise.all([
        getEntity(entityId),
        listEntityVersions(entityId),
        listEntityAliases(entityId),
        listEntityKeywords(entityId),
        getEntityRelationships(entityId),
      ]);

      // listEntityVersions is ordered revisionNumber ASC (M1-WO8) — the
      // last element is deterministically the highest revision, i.e. the
      // Latest Revision.
      const latestRevision = versions.at(-1) ?? null;

      const [latestRevisionKeywords, sources] = latestRevision
        ? await Promise.all([
            listEntityVersionKeywords(latestRevision.id),
            listEntityVersionSources(latestRevision.id),
          ])
        : [[], []];

      const sourceDocuments = await resolveSourceDocuments(sources);

      setData({
        entity,
        versions,
        aliases,
        entityKeywords,
        relationships,
        latestRevisionKeywords,
        sources,
        sourceDocuments,
      });
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
    // justification.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when entityId changes
  }, [entityId]);

  if (status === "loading") {
    return <LoadingState label="Loading Entity…" />;
  }

  if (status === "error") {
    return <ErrorState message={errorMessage} onRetry={() => void load()} />;
  }

  if (data === null) {
    return null;
  }

  const latestRevision = data.versions.at(-1) ?? null;

  return (
    <div className="prowess-entity-detail">
      <p className="prowess-entity-detail__back">
        <Link href="/compendium">&larr; Back to Compendium</Link>
      </p>

      <IdentitySection entity={data.entity} />

      <LatestRevisionSection version={latestRevision} versionCount={data.versions.length} />

      <AliasList aliases={data.aliases} />

      <KeywordSection
        heading="Entity Keywords"
        headingId="entity-keywords-heading"
        assignments={data.entityKeywords}
        emptyLabel="No Entity Keywords"
      />

      <KeywordSection
        heading="Latest Revision Keywords"
        headingId="latest-revision-keywords-heading"
        assignments={data.latestRevisionKeywords}
        emptyLabel="No Latest Revision Keywords"
      />

      <RelationshipSection
        heading="Outgoing Relationships"
        headingId="outgoing-relationships-heading"
        relationships={data.relationships.outgoing}
        emptyLabel="No outgoing relationships"
      />

      <RelationshipSection
        heading="Incoming Relationships"
        headingId="incoming-relationships-heading"
        relationships={data.relationships.incoming}
        emptyLabel="No incoming relationships"
      />

      <SourceReferenceSection references={data.sources} documents={data.sourceDocuments} />
    </div>
  );
}
