"use client";

import Link from "next/link";
import { EmptyNote, Resource, useResource } from "../../rulesets/_components/primitives";
import { BoundaryNote } from "../_components/common";
import { formatBytes, formatDate, shortHash } from "../_lib/presentation";
import { loadRegisteredSnapshots } from "../_lib/use-snapshots";

/** Source Snapshot list (§5, §6). Metadata only — the original bytes are not stored and cannot be downloaded. */
export default function SourcesPage() {
  const state = useResource(loadRegisteredSnapshots, []);
  return (
    <section aria-labelledby="sources-heading">
      <h1 id="sources-heading">Source Snapshots</h1>
      <BoundaryNote>Document upload is not yet available in the Phase 1 Studio. Registered source snapshots and structures can be reviewed here.</BoundaryNote>
      <Resource state={state}>
        {(items) =>
          items.length === 0 ? (
            <EmptyNote title="No registered sources." />
          ) : (
            <table className="imp-grid-table" aria-label="Source Snapshots">
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Snapshot</th>
                  <th scope="col">File</th>
                  <th scope="col">Size</th>
                  <th scope="col">Content hash</th>
                  <th scope="col">Registered</th>
                </tr>
              </thead>
              <tbody>
                {items.map(({ document, snapshot }) => (
                  <tr key={snapshot.id}>
                    <td>{document.title}</td>
                    <td>
                      <Link href={`/developer/import/sources/${snapshot.id}`}>{snapshot.label}</Link>
                      {snapshot.declaredVersion ? <span className="gov-muted"> · declared {snapshot.declaredVersion}</span> : null}
                    </td>
                    <td>{snapshot.originalFilename}</td>
                    <td>{formatBytes(snapshot.byteSize)}</td>
                    <td>
                      <code title={snapshot.contentHash}>{shortHash(snapshot.contentHash)}</code>
                    </td>
                    <td>{formatDate(snapshot.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Resource>
    </section>
  );
}
