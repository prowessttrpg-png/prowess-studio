"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { getPolicy, resolveAuthority, type AuthorityResolutionDto } from "../../../../../../src/api-client";
import { SourceDocumentSelect } from "../../../_components/pickers";
import { EmptyNote, ErrorPanel, Field, IdLine, ImmutableNote, Resource, StatusBadge, useResource } from "../../../_components/primitives";
import { SectionCrumbs } from "../../../_components/workspace";
import { formatDate } from "../../../_lib/presentation";

/** Policy detail (§21): exact records and a READ-ONLY authority resolution tester. Nothing is ranked or chosen here. */
export default function PolicyDetailPage() {
  const { policyId } = useParams<{ policyId: string }>();
  const policy = useResource(() => getPolicy(policyId), [policyId]);
  const [sourceDocumentId, setSource] = useState("");
  const [scopeKey, setScope] = useState("global");
  const [result, setResult] = useState<AuthorityResolutionDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  return (
    <section aria-labelledby="policy-heading">
      <Resource state={policy}>
        {(p) => (
          <>
            <SectionCrumbs section={{ label: "Canon Policy", slug: "policies" }} record={`Policy v${p.policyVersion}`} />
            <h2 id="policy-heading">
              Policy v{p.policyVersion} — {p.name}
            </h2>
            <ImmutableNote />
            <p className="gov-meta">{formatDate(p.createdAt)}</p>
            {p.description ? <p>{p.description}</p> : null}
            <IdLine label="Policy ID" id={p.id} />
            <h3>Source authority records</h3>
            {(p.authorities ?? []).length === 0 ? (
              <EmptyNote title="This policy declares no source authority." />
            ) : (
              <ul className="gov-list" aria-label="Authority records">
                {(p.authorities ?? []).map((a) => (
                  <li key={a.id} className="gov-card gov-card--compact">
                    <StatusBadge value={a.authorityStatus} kind="authority" /> scope <code>{a.scopeKey}</code> · source <code>{a.sourceDocumentId.slice(0, 8)}</code>
                    {a.rationale ? <span className="gov-muted"> — {a.rationale}</span> : null}
                  </li>
                ))}
              </ul>
            )}
            <form
              className="gov-panel"
              aria-labelledby="resolver-heading"
              onSubmit={async (e) => {
                e.preventDefault();
                setError(null);
                try {
                  setResult(await resolveAuthority(p.id, sourceDocumentId, scopeKey));
                } catch (err) {
                  setError(err);
                }
              }}
            >
              <h3 id="resolver-heading">Authority resolution tester (read-only)</h3>
              <SourceDocumentSelect value={sourceDocumentId} onChange={setSource} />
              <Field label="Scope key" htmlFor="resolve-scope">
                <input id="resolve-scope" value={scopeKey} onChange={(e) => setScope(e.target.value)} />
              </Field>
              <button type="submit" className="gov-button" disabled={!sourceDocumentId || !scopeKey}>
                Resolve
              </button>
              {error ? <ErrorPanel error={error} /> : null}
              {result ? (
                <dl className="gov-dl" data-testid="authority-result">
                  <dt>Requested scope</dt>
                  <dd><code>{result.requestedScopeKey}</code></dd>
                  <dt>Resolved scope</dt>
                  <dd>{result.resolvedScopeKey ? <code>{result.resolvedScopeKey}</code> : "—"}</dd>
                  <dt>Authority status</dt>
                  <dd><StatusBadge value={result.authorityStatus} kind="authority" /></dd>
                  <dt>Resolution</dt>
                  <dd><StatusBadge value={result.source} kind="authority-source" /></dd>
                </dl>
              ) : null}
            </form>
          </>
        )}
      </Resource>
    </section>
  );
}
