"use client";

import Link from "next/link";
import { listImportBatches } from "../../../src/api-client";
import { EmptyNote, Resource, useResource } from "../rulesets/_components/primitives";
import { BatchStatusBadge, BoundaryNote } from "./_components/common";
import { extractorTitle, formatBytes, formatDate, shortHash } from "./_lib/presentation";
import { loadRegisteredSnapshots } from "./_lib/use-snapshots";

/** Import landing (§4): registered sources, recent Batches, and the next obvious actions. */
export default function ImportHomePage() {
  const snapshots = useResource(loadRegisteredSnapshots, []);
  const batches = useResource(() => listImportBatches({ pageSize: 10 }), []);
  return (
    <section aria-labelledby="import-heading">
      <h1 id="import-heading">Import Studio</h1>
      <BoundaryNote>Extraction is not Canon. Approved for Import is not Canon. Review Complete is not published content.</BoundaryNote>
      <div className="gov-actions">
        <Link className="gov-button" href="/developer/import/sources">
          Browse Sources
        </Link>
        <Link className="gov-button gov-button--primary" href="/developer/import/batches#create-batch">
          Create Import Batch
        </Link>
        <Link className="gov-button" href="/developer/import/batches">
          Continue Review
        </Link>
      </div>
      <h2>Registered Source Snapshots</h2>
      <Resource state={snapshots}>
        {(items) =>
          items.length === 0 ? (
            <EmptyNote title="No registered sources.">
              <p>Document upload is not yet available in the Phase 1 Studio. Registered source snapshots and structures can be reviewed here.</p>
            </EmptyNote>
          ) : (
            <ul className="gov-list" aria-label="Registered Source Snapshots">
              {items.map(({ document, snapshot }) => (
                <li key={snapshot.id} className="gov-card">
                  <Link href={`/developer/import/sources/${snapshot.id}`}>{document.title} — {snapshot.label}</Link>
                  <p className="gov-muted">
                    {snapshot.originalFilename} · {formatBytes(snapshot.byteSize)} · hash {shortHash(snapshot.contentHash)} · {formatDate(snapshot.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )
        }
      </Resource>
      <h2>Recent Import Batches</h2>
      <Resource state={batches}>
        {({ items, pagination }) =>
          items.length === 0 ? (
            <EmptyNote title="No Import Batches yet.">
              <p>Create a Batch from a registered Source Snapshot to start extraction and review.</p>
            </EmptyNote>
          ) : (
            <>
              <ul className="gov-list" aria-label="Recent Import Batches">
                {items.map((b) => (
                  <li key={b.id} className="gov-card">
                    <Link href={`/developer/import/batches/${b.id}`}>{b.label}</Link> <BatchStatusBadge status={b.status} />
                    <p className="gov-muted">
                      {extractorTitle(b.extractorKey, b.extractorVersion)} · <code>{b.extractorKey}@{b.extractorVersion}</code> · {formatDate(b.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
              {pagination && pagination.total > items.length ? <Link href="/developer/import/batches">All {pagination.total} Batches</Link> : null}
            </>
          )
        }
      </Resource>
    </section>
  );
}
