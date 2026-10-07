"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { listChangeSets, listManifests, listPolicies, listReleases, publishRelease } from "../../../../../src/api-client";
import { ManifestSelect, PolicySelect } from "../../_components/pickers";
import { ConfirmButton, EmptyNote, ErrorPanel, Field, ImmutableNote, Resource, StatusBadge, useResource } from "../../_components/primitives";
import { SectionCrumbs, sectionHref, useWorkspace } from "../../_components/workspace";
import { canPublish, formatDate, shortHash } from "../../_lib/presentation";

/** Releases (§39–§42): immutable published history and the explicit, confirmed Publish action. */
export default function ReleasesPage() {
  const { ruleset, reloadRuleset } = useWorkspace();
  const router = useRouter();
  const releases = useResource(() => listReleases(ruleset.id), [ruleset.id]);
  const manifests = useResource(() => listManifests(ruleset.id), [ruleset.id]);
  const policies = useResource(() => listPolicies(ruleset.id), [ruleset.id]);
  const approved = useResource(() => listChangeSets(ruleset.id, { status: "APPROVED" }), [ruleset.id]);
  const [form, setForm] = useState({ baseManifestId: "", canonPolicyId: "", changeSetId: "", versionLabel: "", releaseNotes: "" });
  const [error, setError] = useState<unknown>(null);
  const ready = form.baseManifestId && form.canonPolicyId && form.versionLabel.trim();
  const label = (id: string, list: Array<{ id: string }> | undefined, fmt: (x: never) => string) => {
    const found = list?.find((x) => x.id === id);
    return found ? fmt(found as never) : "—";
  };
  return (
    <section aria-labelledby="releases-heading">
      <SectionCrumbs section={{ label: "Releases", slug: "releases" }} />
      <h2 id="releases-heading">Releases</h2>
      <Resource state={releases}>
        {({ items }) =>
          items.length === 0 ? <EmptyNote title="No Releases have been published." /> : (
            <ul className="gov-list" aria-label="Releases">
              {[...items].reverse().map((r) => (
                <li key={r.id} className="gov-card">
                  <h3 className="gov-card__title"><Link href={sectionHref(ruleset.id, "releases", r.id)}>Release {r.releaseNumber} — {r.versionLabel}</Link></h3>
                  <p className="gov-meta"><StatusBadge value={r.channel} kind="channel" /> · {formatDate(r.publishedAt)} · hash <code>{shortHash(r.manifestHash)}</code>{r.changeSetId ? " · with ChangeSet" : ""}</p>
                </li>
              ))}
            </ul>
          )
        }
      </Resource>
      {canPublish(ruleset.status) ? (
        <form className="gov-form" aria-labelledby="publish-heading" onSubmit={(e) => e.preventDefault()}>
          <h3 id="publish-heading">Publish Release</h3>
          <ManifestSelect label="Base Manifest" manifests={manifests.data?.items ?? []} value={form.baseManifestId} onChange={(baseManifestId) => setForm({ ...form, baseManifestId })} />
          <PolicySelect policies={policies.data?.items ?? []} value={form.canonPolicyId} onChange={(canonPolicyId) => setForm({ ...form, canonPolicyId })} />
          <Field label="Approved ChangeSet (optional)" htmlFor="pub-cs">
            <select id="pub-cs" value={form.changeSetId} onChange={(e) => setForm({ ...form, changeSetId: e.target.value })}>
              <option value="">None</option>
              {(approved.data?.items ?? []).map((c) => <option key={c.id} value={c.id}>{`${c.name} · ${c.id.slice(0, 8)}`}</option>)}
            </select>
          </Field>
          <Field label="Version label" htmlFor="pub-label">
            <input id="pub-label" required value={form.versionLabel} onChange={(e) => setForm({ ...form, versionLabel: e.target.value })} />
          </Field>
          <Field label="Release notes" htmlFor="pub-notes">
            <textarea id="pub-notes" value={form.releaseNotes} onChange={(e) => setForm({ ...form, releaseNotes: e.target.value })} />
          </Field>
          {error ? <ErrorPanel error={error} title="Publication failed" /> : null}
          {ready ? (
            <ConfirmButton
              label="Publish Release"
              tone="consequential"
              confirm="Publishing creates a new immutable Release and Manifest snapshot. Historical Manifests are not modified."
              details={
                <dl className="gov-dl" data-testid="publish-summary">
                  <dt>Ruleset</dt><dd>{ruleset.name}</dd>
                  <dt>Base Manifest</dt><dd>{label(form.baseManifestId, manifests.data?.items, (m: { manifestVersion: number }) => `Manifest v${m.manifestVersion}`)}</dd>
                  <dt>Policy</dt><dd>{label(form.canonPolicyId, policies.data?.items, (p: { policyVersion: number; name: string }) => `v${p.policyVersion} — ${p.name}`)}</dd>
                  <dt>ChangeSet</dt><dd>{form.changeSetId ? label(form.changeSetId, approved.data?.items, (c: { name: string }) => c.name) : "None"}</dd>
                  <dt>Version label</dt><dd>{form.versionLabel.trim()}</dd>
                </dl>
              }
              confirmLabel="Publish"
              onConfirm={async () => {
                setError(null);
                try {
                  const release = await publishRelease(ruleset.id, {
                    baseManifestId: form.baseManifestId,
                    canonPolicyId: form.canonPolicyId,
                    changeSetId: form.changeSetId || null,
                    versionLabel: form.versionLabel.trim(),
                    releaseNotes: form.releaseNotes.trim() || null,
                  });
                  reloadRuleset();
                  router.push(sectionHref(ruleset.id, "releases", release.id));
                } catch (err) {
                  setError(err);
                }
              }}
            />
          ) : (
            <p className="gov-muted">Choose a base Manifest, a Canon Policy and a version label to publish.</p>
          )}
        </form>
      ) : (
        <ImmutableNote>Publishing requires an APPROVED or PUBLISHED Ruleset (currently {ruleset.status}).</ImmutableNote>
      )}
    </section>
  );
}
