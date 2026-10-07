"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { compareReleases, getRelease, listReleases, verifyReleaseHash, type HashVerificationDto, type ReleaseDiffDto } from "../../../../../../src/api-client";
import { EntityLabel, VersionLabel } from "../../../_components/pickers";
import { ErrorPanel, Field, IdLine, ImmutableNote, Resource, StatusBadge, useResource } from "../../../_components/primitives";
import { SectionCrumbs, sectionHref, useWorkspace } from "../../../_components/workspace";
import { formatDate } from "../../../_lib/presentation";

/** Release detail (§43–§45): published snapshot, read-only hash verification and composition comparison. */
export default function ReleaseDetailPage() {
  const { ruleset } = useWorkspace();
  const { releaseId } = useParams<{ releaseId: string }>();
  const release = useResource(() => getRelease(releaseId), [releaseId]);
  const others = useResource(() => listReleases(ruleset.id), [ruleset.id]);
  const [verification, setVerification] = useState<HashVerificationDto | null>(null);
  const [otherId, setOtherId] = useState("");
  const [diff, setDiff] = useState<ReleaseDiffDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  return (
    <section aria-labelledby="release-heading">
      <Resource state={release}>
        {(r) => (
          <>
            <SectionCrumbs section={{ label: "Releases", slug: "releases" }} record={`Release ${r.releaseNumber}`} />
            <h2 id="release-heading">Release {r.releaseNumber} — {r.versionLabel}</h2>
            <ImmutableNote>Published snapshot — Releases are immutable.</ImmutableNote>
            <dl className="gov-dl">
              <dt>Channel (at publication)</dt><dd><StatusBadge value={r.channel} kind="channel" /></dd>
              <dt>Published</dt><dd>{formatDate(r.publishedAt)}</dd>
              <dt>Release Manifest</dt><dd><Link href={sectionHref(ruleset.id, "manifests", r.manifestId)} data-testid="release-manifest-link">{r.manifestId}</Link></dd>
              <dt>Canon Policy</dt><dd><Link href={sectionHref(ruleset.id, "policies", r.canonPolicyId)}>{r.canonPolicyId}</Link></dd>
              <dt>ChangeSet</dt><dd>{r.changeSetId ? <Link href={sectionHref(ruleset.id, "change-sets", r.changeSetId)}>{r.changeSetId}</Link> : "None"}</dd>
              <dt>Manifest hash</dt><dd><code className="gov-hash">{r.manifestHash}</code></dd>
              <dt>Release notes</dt><dd>{r.releaseNotes ?? "—"}</dd>
            </dl>
            <IdLine label="Release ID" id={r.id} />
            <h3>Published composition</h3>
            <ul className="gov-list" aria-label="Published composition">
              {(r.composition ?? []).map((p) => <li key={p.entityId} className="gov-card gov-card--compact"><EntityLabel id={p.entityId} /> → <VersionLabel id={p.entityVersionId} /></li>)}
            </ul>

            <div className="gov-panel">
              <h3>Manifest hash verification</h3>
              <button type="button" className="gov-button" onClick={async () => { setError(null); try { setVerification(await verifyReleaseHash(r.id)); } catch (err) { setError(err); } }}>
                Verify Manifest Hash
              </button>
              {verification ? (
                <div data-testid="hash-result" data-valid={verification.valid}>
                  {verification.valid ? <p className="gov-ok">Verified ✓ — the published composition matches its stored hash.</p> : <p className="gov-bad" role="alert">HASH MISMATCH — the published composition no longer matches its stored hash.</p>}
                  <details>
                    <summary>Hash details</summary>
                    <p>Stored: <code className="gov-hash">{verification.storedHash}</code></p>
                    <p>Computed: <code className="gov-hash">{verification.computedHash}</code></p>
                  </details>
                </div>
              ) : null}
            </div>

            <div className="gov-panel">
              <h3>Compare with another Release</h3>
              <Field label="Other Release" htmlFor="compare-other">
                <select id="compare-other" value={otherId} onChange={(e) => setOtherId(e.target.value)}>
                  <option value="">Choose a Release…</option>
                  {(others.data?.items ?? []).filter((x) => x.id !== r.id).map((x) => <option key={x.id} value={x.id}>{`Release ${x.releaseNumber} — ${x.versionLabel}`}</option>)}
                </select>
              </Field>
              <button type="button" className="gov-button" disabled={!otherId} onClick={async () => { setError(null); try { setDiff(await compareReleases(otherId, r.id)); } catch (err) { setError(err); } }}>
                Compare
              </button>
              {diff ? (
                <div data-testid="release-diff">
                  <p className="gov-muted">From the chosen Release to this one. Unchanged: {diff.unchangedCount}.</p>
                  {diff.entries.length === 0 ? <p>No composition differences.</p> : (
                    <ul>
                      {diff.entries.map((d) => (
                        <li key={d.entityId}>
                          <StatusBadge value={d.type === "ADDED_ENTITY" ? "ADDED" : d.type === "REMOVED_ENTITY" ? "REMOVED" : "CHANGED_VERSION"} kind="diff" /> <EntityLabel id={d.entityId} />
                          {d.fromEntityVersionId ? <> · from <VersionLabel id={d.fromEntityVersionId} /></> : null}
                          {d.toEntityVersionId ? <> · to <VersionLabel id={d.toEntityVersionId} /></> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
            {error ? <ErrorPanel error={error} /> : null}
          </>
        )}
      </Resource>
    </section>
  );
}
