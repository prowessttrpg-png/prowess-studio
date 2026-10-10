"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useState } from "react";
import { createImportBatch, getSourceOutline, listImportBatches, listManifests, listRulesets, type ManifestDto, type SourceOutlineDto } from "../../../../src/api-client";
import { ManifestSelect } from "../../rulesets/_components/pickers";
import { EmptyNote, Field, Loading, Resource, useResource, useUnsavedWarning } from "../../rulesets/_components/primitives";
import { BatchStatusBadge, ImportError } from "../_components/common";
import { EXTRACTORS, extractorTitle, formatDate, sectionPath } from "../_lib/presentation";
import { loadRegisteredSnapshots } from "../_lib/use-snapshots";

const int = (v: string | null) => (v !== null && /^\d+$/.test(v) ? Number(v) : 1);

/** Guided Create Batch (§11–§16): only WO7-accepted fields; never a generated one. */
function CreateBatchForm({ initialSnapshot }: { initialSnapshot: string }) {
  const id = useId();
  const router = useRouter();
  const snapshots = useResource(loadRegisteredSnapshots, []);
  const rulesets = useResource(() => listRulesets(), []);
  const [form, setForm] = useState({ snapshotId: initialSnapshot, scope: "SNAPSHOT" as "SNAPSHOT" | "SECTION_SUBTREE", sectionId: "", extractor: "", label: "", description: "", rulesetId: "", manifestId: "" });
  const [outline, setOutline] = useState<SourceOutlineDto | null>(null);
  const [manifests, setManifests] = useState<ManifestDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useUnsavedWarning(form.label !== "" && !busy);
  useEffect(() => {
    if (!form.snapshotId) return;
    let cancelled = false;
    getSourceOutline(form.snapshotId).then((o) => !cancelled && setOutline(o), () => !cancelled && setOutline(null));
    return () => {
      cancelled = true;
    };
  }, [form.snapshotId]);
  useEffect(() => {
    if (!form.rulesetId) return;
    let cancelled = false;
    listManifests(form.rulesetId).then((r) => !cancelled && setManifests(r.items), () => !cancelled && setManifests([]));
    return () => {
      cancelled = true;
    };
  }, [form.rulesetId]);
  const sections = outline && outline.snapshot.id === form.snapshotId ? outline.sections : [];
  const extractor = EXTRACTORS.find((e) => `${e.key}@${e.version}` === form.extractor);

  const submit = async () => {
    setProblem(null);
    if (!form.snapshotId) return setProblem("Choose a Source Snapshot.");
    if (!extractor) return setProblem("Choose an extractor.");
    if (form.label.trim() === "") return setProblem("Give the Batch a label.");
    if (form.scope === "SECTION_SUBTREE" && !form.sectionId) return setProblem("Choose the root Section of the subtree.");
    if (form.manifestId && !form.rulesetId) return setProblem("A comparison Manifest needs its Ruleset.");
    setBusy(true);
    setError(null);
    try {
      const { batch, created } = await createImportBatch({
        sourceSnapshotId: form.snapshotId,
        label: form.label,
        ...(form.description.trim() ? { description: form.description } : {}),
        scope: form.scope === "SNAPSHOT" ? { type: "SNAPSHOT" } : { type: "SECTION_SUBTREE", sectionId: form.sectionId },
        ...(form.rulesetId ? { reviewRulesetId: form.rulesetId } : {}),
        ...(form.manifestId ? { comparisonManifestId: form.manifestId } : {}),
        extractorKey: extractor.key,
        extractorVersion: extractor.version,
      });
      router.push(`/developer/import/batches/${batch.id}${created ? "" : "?existing=1"}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={`${id}-heading`} id="create-batch" className="gov-card">
      <h2 id={`${id}-heading`}>Create Import Batch</h2>
      <Resource state={snapshots}>
        {(items) =>
          items.length === 0 ? (
            <EmptyNote title="No registered sources to import from." />
          ) : (
            <Field label="Source Snapshot" htmlFor={`${id}-snapshot`}>
              <select id={`${id}-snapshot`} value={form.snapshotId} onChange={(e) => setForm({ ...form, snapshotId: e.target.value, sectionId: "" })}>
                <option value="">Choose a Source Snapshot…</option>
                {items.map(({ document, snapshot }) => (
                  <option key={snapshot.id} value={snapshot.id}>
                    {document.title} — {snapshot.label}
                  </option>
                ))}
              </select>
            </Field>
          )
        }
      </Resource>
      <fieldset>
        <legend>Scope</legend>
        <label className="imp-radio">
          <input type="radio" name={`${id}-scope`} checked={form.scope === "SNAPSHOT"} onChange={() => setForm({ ...form, scope: "SNAPSHOT", sectionId: "" })} /> Whole Snapshot
        </label>
        <label className="imp-radio">
          <input type="radio" name={`${id}-scope`} checked={form.scope === "SECTION_SUBTREE"} onChange={() => setForm({ ...form, scope: "SECTION_SUBTREE" })} /> Section Subtree
        </label>
        {form.scope === "SECTION_SUBTREE" ? (
          <Field label="Root Section" htmlFor={`${id}-section`} hint={form.sectionId ? `Selected: ${sectionPath(form.sectionId, sections)}` : "Choose from the source outline."}>
            <select id={`${id}-section`} value={form.sectionId} onChange={(e) => setForm({ ...form, sectionId: e.target.value })}>
              <option value="">Choose a Section…</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {sectionPath(s.id, sections)}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </fieldset>
      <fieldset>
        <legend>Extractor</legend>
        {EXTRACTORS.map((e) => (
          <label key={e.key} className="imp-radio imp-extractor">
            <input type="radio" name={`${id}-extractor`} value={`${e.key}@${e.version}`} checked={form.extractor === `${e.key}@${e.version}`} onChange={(ev) => setForm({ ...form, extractor: ev.target.value })} />{" "}
            <strong>{e.title}</strong> <code>{`${e.key}@${e.version}`}</code>
            <span className="gov-muted"> — {e.description}</span>
          </label>
        ))}
      </fieldset>
      <Field label="Label" htmlFor={`${id}-label`}>
        <input id={`${id}-label`} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
      </Field>
      <Field label="Description (optional)" htmlFor={`${id}-description`}>
        <textarea id={`${id}-description`} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <details>
        <summary>Optional review context (exact Ruleset / comparison Manifest)</summary>
        <Resource state={rulesets}>
          {({ items }) => (
            <Field label="Review Ruleset" htmlFor={`${id}-ruleset`}>
              <select id={`${id}-ruleset`} value={form.rulesetId} onChange={(e) => setForm({ ...form, rulesetId: e.target.value, manifestId: "" })}>
                <option value="">None</option>
                {items.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.canonicalKey})
                  </option>
                ))}
              </select>
            </Field>
          )}
        </Resource>
        {form.rulesetId ? <ManifestSelect manifests={manifests} value={form.manifestId} onChange={(m) => setForm({ ...form, manifestId: m })} label="Comparison Manifest" allowNone /> : null}
      </details>
      {problem ? (
        <p className="gov-field__error" role="alert">
          {problem}
        </p>
      ) : null}
      {error ? <ImportError error={error} title="Batch not created" /> : null}
      <button type="button" className="gov-button gov-button--primary" onClick={() => void submit()} disabled={busy} aria-busy={busy}>
        {busy ? "Creating…" : "Create Batch"}
      </button>
    </section>
  );
}

function BatchesView() {
  const search = useSearchParams();
  const router = useRouter();
  const page = int(search.get("page"));
  const batches = useResource(() => listImportBatches({ page, pageSize: 25 }), [page]);
  return (
    <section aria-labelledby="batches-heading">
      <h1 id="batches-heading">Import Batches</h1>
      <Resource state={batches}>
        {({ items, pagination }) =>
          items.length === 0 ? (
            <EmptyNote title="No Import Batches yet.">
              <p>Create one below from a registered Source Snapshot.</p>
            </EmptyNote>
          ) : (
            <>
              <table className="imp-grid-table" aria-label="Import Batches">
                <thead>
                  <tr>
                    <th scope="col">Batch</th>
                    <th scope="col">Status</th>
                    <th scope="col">Extractor</th>
                    <th scope="col">Scope</th>
                    <th scope="col">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <Link href={`/developer/import/batches/${b.id}`}>{b.label}</Link>
                      </td>
                      <td>
                        <BatchStatusBadge status={b.status} />
                      </td>
                      <td>
                        {extractorTitle(b.extractorKey, b.extractorVersion)} <code>{`${b.extractorKey}@${b.extractorVersion}`}</code>
                      </td>
                      <td>{b.scopeType === "SNAPSHOT" ? "Whole Snapshot" : "Section Subtree"}</td>
                      <td>{formatDate(b.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pagination && pagination.totalPages > 1 ? (
                <nav aria-label="Batch pages" className="gov-actions">
                  <button type="button" className="gov-button" disabled={page <= 1} onClick={() => router.push(`/developer/import/batches?page=${page - 1}`)}>
                    Previous page
                  </button>
                  <span>
                    Page {page} of {pagination.totalPages}
                  </span>
                  <button type="button" className="gov-button" disabled={page >= pagination.totalPages} onClick={() => router.push(`/developer/import/batches?page=${page + 1}`)}>
                    Next page
                  </button>
                </nav>
              ) : null}
            </>
          )
        }
      </Resource>
      <CreateBatchForm initialSnapshot={search.get("snapshot") ?? ""} />
    </section>
  );
}

export default function BatchesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <BatchesView />
    </Suspense>
  );
}
