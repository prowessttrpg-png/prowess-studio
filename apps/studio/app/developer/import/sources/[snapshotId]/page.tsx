"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { getSourceOutline, listSectionContents } from "../../../../../src/api-client";
import { EmptyNote, Loading, Resource, useResource } from "../../../rulesets/_components/primitives";
import { BoundaryNote, TechnicalDetails } from "../../_components/common";
import { SectionOutline, SourceNodeView } from "../../_components/source";
import { formatBytes, formatDate, sectionPath, shortHash } from "../../_lib/presentation";

const int = (v: string | null) => (v !== null && /^\d+$/.test(v) ? Number(v) : null);

/** Source Inspector (§7–§10): immutable outline, verbatim section content, tables and asset provenance. */
function SourceInspector() {
  const { snapshotId } = useParams<{ snapshotId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const outline = useResource(() => getSourceOutline(snapshotId), [snapshotId]);
  const sectionParam = search.get("section");
  const page = int(search.get("page")) ?? 1;
  const highlight = search.get("node") ? { nodeId: search.get("node") as string, start: int(search.get("start")), end: int(search.get("end")), row: int(search.get("row")), column: int(search.get("col")) } : null;
  const selected = sectionParam ?? outline.data?.sections[0]?.id ?? null;
  const contents = useResource(() => (selected ? listSectionContents(selected, { page, pageSize: 50 }) : Promise.resolve(null)), [selected, page]);
  const go = (params: Record<string, string>) => router.replace(`/developer/import/sources/${snapshotId}?${new URLSearchParams(params).toString()}`, { scroll: false });

  return (
    <section aria-labelledby="source-heading">
      <Resource state={outline}>
        {(o) => (
          <>
            <h1 id="source-heading">{o.snapshot.label}</h1>
            <p className="gov-muted">
              {o.snapshot.originalFilename} · {formatBytes(o.snapshot.byteSize)} · registered {formatDate(o.snapshot.createdAt)}
              {o.snapshot.declaredVersion ? ` · declared ${o.snapshot.declaredVersion}` : ""}
            </p>
            <p data-testid="ingestion-state">
              {o.ingestion ? `Structure ingested (${o.ingestion.parserName}@${o.ingestion.parserVersion}) · ${o.sections.length} sections · ${o.contentNodeCount} content nodes · ${o.assetCount} assets` : "Not structurally ingested — nothing to inspect or extract yet."}
            </p>
            <BoundaryNote>Immutable source evidence. Text is shown verbatim; the original file bytes are not stored by the Studio.</BoundaryNote>
            <TechnicalDetails
              rows={[
                ["Snapshot id", o.snapshot.id],
                ["Content hash", o.snapshot.contentHash],
                ["Structure hash", o.ingestion?.structureHash ?? "—"],
              ]}
            />
            {o.ingestion ? (
              <Link className="gov-button" href={`/developer/import/batches?snapshot=${o.snapshot.id}#create-batch`}>
                Create Import Batch from this source
              </Link>
            ) : null}
            <div className="imp-source-layout">
              <SectionOutline sections={o.sections} selectedId={selected} onSelect={(id) => go({ section: id })} />
              <div className="imp-source-content" aria-live="polite">
                {selected ? (
                  <h2 data-testid="selected-section">{sectionPath(selected, o.sections)}</h2>
                ) : (
                  <EmptyNote title="No section selected." />
                )}
                {contents.loading && !contents.data ? <Loading label="Loading section content…" /> : null}
                {contents.data ? (
                  contents.data.items.length === 0 ? (
                    <EmptyNote title="This section has no direct content." />
                  ) : (
                    <>
                      {contents.data.items.map((n) => (
                        <SourceNodeView key={n.id} node={n} highlight={highlight} />
                      ))}
                      {contents.data.pagination && contents.data.pagination.totalPages > 1 ? (
                        <nav aria-label="Section content pages" className="gov-actions">
                          <button type="button" className="gov-button" disabled={page <= 1} onClick={() => go({ section: selected as string, page: String(page - 1) })}>
                            Previous page
                          </button>
                          <span>
                            Page {page} of {contents.data.pagination.totalPages}
                          </span>
                          <button type="button" className="gov-button" disabled={page >= contents.data.pagination.totalPages} onClick={() => go({ section: selected as string, page: String(page + 1) })}>
                            Next page
                          </button>
                        </nav>
                      ) : null}
                    </>
                  )
                ) : null}
              </div>
            </div>
            <p className="gov-muted">Content hash {shortHash(o.snapshot.contentHash)}</p>
          </>
        )}
      </Resource>
    </section>
  );
}

export default function SourceInspectorPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SourceInspector />
    </Suspense>
  );
}
