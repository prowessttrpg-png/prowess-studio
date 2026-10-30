"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { resolveLatestRelease, ReferenceApiError, type ReleaseDetailDto, type ReleaseSummaryDto } from "../_lib/reference-client";
import { comparisonHref, formatDate, readableToken, releaseHref, releaseName } from "../_lib/reference-urls";

/**
 * Release selection (PAS-10 M6-WO2). Choosing a Release navigates to that Release's exact URL; nothing is remembered
 * as a "current" Release. "View Latest Release" is an explicit action: it asks the server which exact Release is the
 * highest-numbered and navigates to THAT Release's URL — the resulting page is pinned to it, not to "latest".
 */
export const releaseOptionLabel = (r: ReleaseSummaryDto) => `${releaseName(r)} · ${readableToken(r.channel)} · ${formatDate(r.publishedAt)}`;

export function ReleaseSelector({ rulesetId, releaseId, releases }: { rulesetId: string; releaseId: string; releases: ReleaseSummaryDto[] }) {
  const router = useRouter();
  return (
    <label className="gov-field">
      <span>Release</span>
      <select value={releaseId} onChange={(e) => router.push(releaseHref(rulesetId, e.target.value))}>
        {[...releases].reverse().map((r) => (
          <option key={r.id} value={r.id}>
            {releaseOptionLabel(r)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ViewLatestReleaseButton({ rulesetId }: { rulesetId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <span>
      <button
        type="button"
        className="gov-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage(null);
          try {
            const { release } = await resolveLatestRelease(rulesetId);
            if (release === null) setMessage("This Ruleset has no Releases yet.");
            else router.push(releaseHref(rulesetId, release.id));
          } catch (e) {
            setMessage(e instanceof ReferenceApiError ? e.message : "Could not resolve the Latest Release.");
          } finally {
            setBusy(false);
          }
        }}
      >
        View Latest Release
      </button>
      {message ? (
        <span role="status" className="gov-muted">
          {" "}
          {message}
        </span>
      ) : null}
    </span>
  );
}

export function CompareWithSelector({ rulesetId, releaseId, releases }: { rulesetId: string; releaseId: string; releases: ReleaseSummaryDto[] }) {
  const router = useRouter();
  const others = [...releases].reverse().filter((r) => r.id !== releaseId);
  if (others.length === 0) return null;
  return (
    <label className="gov-field">
      <span>Compare with</span>
      <select value="" onChange={(e) => e.target.value && router.push(comparisonHref(rulesetId, releaseId, e.target.value))}>
        <option value="">Choose a Release…</option>
        {others.map((r) => (
          <option key={r.id} value={r.id}>
            {releaseName(r)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The server's manifest verification (M2), shown — never recomputed here. A failure is a serious warning. */
export function IntegrityNotice({ release }: { release: ReleaseDetailDto }) {
  return (
    <>
      {release.verification.valid ? (
        <p className="gov-ok" data-testid="reference-integrity">
          Manifest verified: the stored hash matches the Release&apos;s exact pins.
        </p>
      ) : (
        <div className="gov-bad" role="alert" data-testid="reference-integrity">
          <strong>Integrity warning: this Release&apos;s manifest does not match its stored hash.</strong> The server recomputed the hash from the Release&apos;s pins and it differs from the hash
          recorded at publication. Do not rely on this Release until the Canon Manager team has investigated.
        </div>
      )}
      <details className="prowess-reference__developer">
        <summary>Release details</summary>
        <dl className="gov-dl">
          <dt>Release</dt>
          <dd>{releaseName(release)}</dd>
          <dt>Channel</dt>
          <dd>{readableToken(release.channel)}</dd>
          <dt>Published</dt>
          <dd>{formatDate(release.publishedAt)}</dd>
          <dt>Pinned entries</dt>
          <dd>{release.compositionSize}</dd>
          <dt>Manifest hash (stored)</dt>
          <dd>
            <code className="gov-hash">{release.manifestHash}</code>
          </dd>
          <dt>Manifest hash (recomputed by the server)</dt>
          <dd>
            <code className="gov-hash">{release.verification.computedHash}</code>
          </dd>
          <dt>Release id</dt>
          <dd className="gov-id">{release.id}</dd>
        </dl>
      </details>
    </>
  );
}
