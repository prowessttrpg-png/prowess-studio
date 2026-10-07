"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { getEffectiveComposition, getManifest, resolveEntity, type ResolutionDto } from "../../../../../../src/api-client";
import { EntityLabel, EntityPicker, VersionLabel } from "../../../_components/pickers";
import { EmptyNote, ErrorPanel, IdLine, ImmutableNote, Resource, StatusBadge, useResource } from "../../../_components/primitives";
import { SectionCrumbs, sectionHref, useWorkspace } from "../../../_components/workspace";
import { formatDate } from "../../../_lib/presentation";

/**
 * Manifest detail (§16, §17): EXPLICIT entries (what this Manifest itself pins) and EFFECTIVE composition (what
 * `/effective` returns) side by side, plus a single-Entity resolution inspector. Provenance is rendered exactly as
 * the API returned it — nothing is traversed or resolved in the browser.
 */
export default function ManifestDetailPage() {
  const { ruleset } = useWorkspace();
  const { manifestId } = useParams<{ manifestId: string }>();
  const manifest = useResource(() => getManifest(manifestId), [manifestId]);
  const effective = useResource(() => getEffectiveComposition(manifestId), [manifestId]);
  const [entityId, setEntityId] = useState("");
  const [trace, setTrace] = useState<{ resolution: ResolutionDto | null } | null>(null);
  const [traceError, setTraceError] = useState<unknown>(null);

  return (
    <section aria-labelledby="manifest-heading">
      <Resource state={manifest}>
        {(m) => (
          <>
            <SectionCrumbs section={{ label: "Manifests", slug: "manifests" }} record={`Manifest v${m.manifestVersion}`} />
            <h2 id="manifest-heading">Manifest v{m.manifestVersion}</h2>
            <ImmutableNote />
            <p className="gov-meta">
              {formatDate(m.createdAt)} ·{" "}
              {m.parentManifestId ? (
                <>
                  Parent: <Link href={sectionHref(ruleset.id, "manifests", m.parentManifestId)}>{m.parentManifestId.slice(0, 8)}</Link>
                </>
              ) : (
                "No parent"
              )}
            </p>
            <IdLine label="Manifest ID" id={m.id} />
            <div className="gov-columns">
              <div>
                <h3>Explicit Entries</h3>
                <p className="gov-muted">What this Manifest itself pins.</p>
                {(m.entries ?? []).length === 0 ? (
                  <EmptyNote title="No explicit pins." />
                ) : (
                  <ul className="gov-list" aria-label="Explicit entries" data-testid="explicit-entries">
                    {(m.entries ?? []).map((e) => (
                      <li key={e.id} className="gov-card gov-card--compact">
                        <EntityLabel id={e.entityId} /> → <VersionLabel id={e.entityVersionId} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3>Effective Composition</h3>
                <p className="gov-muted">Derived by the server through inheritance. Never stored.</p>
                <Resource state={effective}>
                  {(rows) =>
                    rows.length === 0 ? (
                      <EmptyNote title="The effective composition is empty." />
                    ) : (
                      <ul className="gov-list" aria-label="Effective composition" data-testid="effective-entries">
                        {rows.map((r) => (
                          <li key={r.entityId} className="gov-card gov-card--compact" data-source={r.source}>
                            <EntityLabel id={r.entityId} /> → <VersionLabel id={r.entityVersionId} /> <StatusBadge value={r.source} kind="resolution-source" />{" "}
                            <span className="gov-muted">
                              depth {r.resolutionDepth} · from <Link href={sectionHref(ruleset.id, "manifests", r.resolvedFromManifestId)}>{r.resolvedFromManifestId.slice(0, 8)}</Link>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )
                  }
                </Resource>
              </div>
            </div>

            <div className="gov-panel" aria-labelledby="inspector-heading">
              <h3 id="inspector-heading">Resolution inspector</h3>
              <EntityPicker value={entityId} onChange={(id) => { setEntityId(id); setTrace(null); }} label="Entity to resolve" />
              <button
                type="button"
                className="gov-button"
                disabled={!entityId}
                onClick={async () => {
                  setTraceError(null);
                  try {
                    setTrace(await resolveEntity(m.id, entityId));
                  } catch (err) {
                    setTraceError(err);
                  }
                }}
              >
                Resolve
              </button>
              {traceError ? <ErrorPanel error={traceError} /> : null}
              {trace ? (
                trace.resolution === null ? (
                  <p data-testid="resolution-trace">No resolution: nothing in this Manifest&apos;s inheritance chain pins that Entity.</p>
                ) : (
                  <ol className="gov-trace" data-testid="resolution-trace" aria-label="Resolution trace">
                    <li>Requested Manifest <code>{trace.resolution.requestedManifestId.slice(0, 8)}</code></li>
                    {trace.resolution.resolutionDepth > 0 ? <li>↓ {trace.resolution.resolutionDepth} parent step(s)</li> : null}
                    <li>Resolved from Manifest <code>{trace.resolution.resolvedFromManifestId.slice(0, 8)}</code> (<StatusBadge value={trace.resolution.source} kind="resolution-source" />)</li>
                    <li>↓ <VersionLabel id={trace.resolution.entityVersionId} /></li>
                  </ol>
                )
              ) : null}
            </div>
          </>
        )}
      </Resource>
    </section>
  );
}
