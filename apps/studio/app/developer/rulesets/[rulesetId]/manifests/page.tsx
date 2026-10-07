"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createManifest, listManifests } from "../../../../../src/api-client";
import { EntityVersionPicker, ManifestSelect, VersionLabel, EntityLabel } from "../../_components/pickers";
import { EmptyNote, ErrorPanel, IdLine, Resource, useResource, useUnsavedWarning } from "../../_components/primitives";
import { SectionCrumbs, sectionHref, useWorkspace } from "../../_components/workspace";
import { formatDate } from "../../_lib/presentation";

/** Manifests (§12–§15): immutable snapshots, and a builder that pins EXACT Versions chosen by the operator. */
export default function ManifestsPage() {
  const { ruleset } = useWorkspace();
  const router = useRouter();
  const manifests = useResource(() => listManifests(ruleset.id), [ruleset.id]);
  const [parentManifestId, setParent] = useState("");
  const [entries, setEntries] = useState<Array<{ entityId: string; entityVersionId: string }>>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useUnsavedWarning(entries.length > 0);

  return (
    <section aria-labelledby="manifests-heading">
      <SectionCrumbs section={{ label: "Manifests", slug: "manifests" }} />
      <h2 id="manifests-heading">Manifests</h2>
      <p className="gov-muted">Each Manifest is an immutable snapshot of explicit pins. Open one to compare its explicit entries with its effective composition.</p>
      <Resource state={manifests}>
        {({ items }) =>
          items.length === 0 ? (
            <EmptyNote title="No Manifests yet." />
          ) : (
            <ul className="gov-list" aria-label="Manifests">
              {[...items].reverse().map((m) => (
                <li key={m.id} className="gov-card">
                  <h3 className="gov-card__title">
                    <Link href={sectionHref(ruleset.id, "manifests", m.id)}>Manifest v{m.manifestVersion}</Link>
                  </h3>
                  <p className="gov-meta">
                    {m.parentManifestId ? <>Inherits from <code>{m.parentManifestId.slice(0, 8)}</code> · </> : "No parent · "}
                    {formatDate(m.createdAt)}
                  </p>
                  <IdLine label="Manifest ID" id={m.id} />
                </li>
              ))}
            </ul>
          )
        }
      </Resource>

      <form
        className="gov-form"
        aria-labelledby="create-manifest-heading"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const created = await createManifest(ruleset.id, { parentManifestId: parentManifestId || null, entries });
            setEntries([]);
            router.push(sectionHref(ruleset.id, "manifests", created.id));
          } catch (err) {
            setError(err);
            setBusy(false);
          }
        }}
      >
        <h3 id="create-manifest-heading">Create Manifest</h3>
        <ManifestSelect
          label="Parent Manifest (optional)"
          manifests={manifests.data?.items ?? []}
          value={parentManifestId}
          onChange={setParent}
          allowNone
          noneLabel="No parent"
        />
        {entries.length === 0 ? (
          <p className="gov-muted" data-testid="empty-manifest-note">
            No explicit pins. This Manifest may still inherit from its pinned parent Manifest; with no parent either, its effective composition is empty.
          </p>
        ) : null}
        <ol className="gov-rows" aria-label="Explicit entries">
          {entries.map((entry, i) => (
            <li key={i} className="gov-row">
              <EntityVersionPicker value={entry} onChange={(v) => setEntries(entries.map((x, j) => (j === i ? v : x)))} />
              {entry.entityId && entry.entityVersionId ? (
                <p className="gov-muted">
                  Pins <EntityLabel id={entry.entityId} /> → <VersionLabel id={entry.entityVersionId} />
                </p>
              ) : null}
              <button type="button" className="gov-link-button" onClick={() => setEntries(entries.filter((_, j) => j !== i))}>
                Remove entry {i + 1}
              </button>
            </li>
          ))}
        </ol>
        <button type="button" className="gov-button" onClick={() => setEntries([...entries, { entityId: "", entityVersionId: "" }])}>
          Add entry
        </button>
        {error ? <ErrorPanel error={error} title="Could not create the Manifest" /> : null}
        <button type="submit" className="gov-button gov-button--primary" disabled={busy || entries.some((e) => !e.entityVersionId)}>
          Create Manifest
        </button>
      </form>
    </section>
  );
}
