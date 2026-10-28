"use client";

import { CHANGE_TYPES } from "@prowess/model";
import { formatEnumLabel, VersionStatusBadge } from "@prowess/ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EntityDto, EntityVersionDto, SourceDocumentDto, SourceReferenceDto } from "../../_lib/api-client";
import {
  AuthoringApiError,
  assignVersionKeyword,
  attachSource,
  createRevision,
  getCatalog,
  getEntity,
  listManifests,
  getVersion,
  listAllRulesets,
  listSourceDocuments,
  listVersionKeywords,
  listVersionSources,
  proposeChangeSet,
  removeSource,
  removeVersionKeyword,
  returnToDraft,
  saveDraft,
  submitForReview,
  validateCandidate,
  validateStoredRevision,
  type AuthoringCatalogDto,
  type KeywordAssignmentDto,
  type RulesetOptionDto,
  type ValidationResultDto,
} from "../_lib/authoring-client";
import { isDirty, storedCandidate, type DefinitionCandidate } from "../_lib/definition-form";
import { descriptorFor } from "../_lib/descriptors";
import { useUnsavedChangesGuard } from "../_lib/use-navigation-guard";
import { canonManagerChangeSetHref } from "../../../../src/navigation";
import { DefinitionEditor } from "./DefinitionEditor";
import { DefinitionPreview } from "./DefinitionPreview";
import { KeywordPicker } from "./KeywordPicker";
import { ValidationPanel } from "./ValidationPanel";

/**
 * The revision workspace (PAS-10 M6-WO1 §4, §16–20, §25–27, §31–34, §42–47, §64–66).
 *
 *  - Only a DRAFT is editable. Every other lifecycle state renders read-only, with "Create New Revision" as the way to
 *    change it — history is never mutated (§17).
 *  - Save Draft is explicit (no autosave, §42) and updates THIS Draft (§43). The form tracks Saved Draft vs Unsaved
 *    Changes, protects navigation while dirty (§19) and sends `expectedUpdatedAt`, so newer work is never silently
 *    overwritten (§46).
 *  - Validate runs the server's M5 boundary without saving (§16); Preview is presentation only (§27).
 *  - The Canon / Ruleset hand-off needs an EXPLICITLY chosen Ruleset — the top-bar selector is only a viewing control
 *    (§34) — and creates an ordinary M2 ChangeSet proposal; publishing stays in the Canon Manager (§31–33).
 */
interface Snapshot {
  displayName: string;
  shortDescription: string;
  rulesText: string;
  changeType: string;
  changeSummary: string;
  candidate: DefinitionCandidate | null;
}

const snapshotOf = (v: EntityVersionDto): Snapshot => ({
  displayName: v.displayName,
  shortDescription: v.shortDescription ?? "",
  rulesText: v.rulesText ?? "",
  changeType: v.changeType ?? "",
  changeSummary: v.changeSummary ?? "",
  candidate: storedCandidate(v.structuredData),
});
const messageOf = (e: unknown, fallback: string) => (e instanceof AuthoringApiError ? { code: e.code, message: e.message } : { code: "UNKNOWN", message: fallback });

const SECTIONS = [
  ["rev-content", "Revision content"],
  ["rev-definition", "Prowess Definition"],
  ["rev-keywords", "Keywords"],
  ["rev-sources", "Sources / provenance"],
  ["rev-validation", "Validation"],
  ["rev-preview", "Preview"],
  ["rev-workflow", "Review and Canon hand-off"],
  ["rev-history", "History"],
] as const;

export function RevisionWorkspace({ entityId, versionId }: { entityId: string; versionId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const validationHeading = useRef<HTMLHeadingElement>(null);
  const [entity, setEntity] = useState<EntityDto | null>(null);
  const [version, setVersion] = useState<EntityVersionDto | null>(null);
  const [catalog, setCatalog] = useState<AuthoringCatalogDto | null>(null);
  const [saved, setSaved] = useState<Snapshot | null>(null);
  const [form, setForm] = useState<Snapshot | null>(null);
  const [keywords, setKeywords] = useState<KeywordAssignmentDto[]>([]);
  const [sources, setSources] = useState<SourceReferenceDto[]>([]);
  const [documents, setDocuments] = useState<SourceDocumentDto[]>([]);
  const [newSource, setNewSource] = useState({ sourceDocumentId: "", sectionLabel: "", pageReference: "", sourceExcerptNote: "" });
  const [validation, setValidation] = useState<{ result: ValidationResultDto; forCandidate: string } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(searchParams.get("created") === "1" ? "Definition created as Revision 1 (DRAFT)." : "");
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [rulesets, setRulesets] = useState<RulesetOptionDto[] | null>(null);
  const [handoff, setHandoff] = useState({ rulesetId: "", targetManifestId: "", name: "", description: "" });
  const [manifests, setManifests] = useState<Array<{ id: string; manifestVersion: number }>>([]);
  const [proposal, setProposal] = useState<{ id: string; rulesetId: string; name: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [e, v, c, k, s, d] = await Promise.all([getEntity(entityId), getVersion(versionId), getCatalog(), listVersionKeywords(versionId), listVersionSources(versionId), listSourceDocuments().catch(() => [] as SourceDocumentDto[])]);
      if (v.entityId !== e.id) throw new AuthoringApiError("NOT_FOUND", "This revision belongs to a different Entity.", 404);
      setEntity(e);
      setVersion(v);
      setCatalog(c);
      setKeywords(k);
      setSources(s);
      setDocuments(d);
      const snap = snapshotOf(v);
      setSaved(snap);
      setForm(snap);
      if (snap.candidate !== null) {
        validateStoredRevision(versionId).then((r) => setValidation({ result: r, forCandidate: JSON.stringify(snap.candidate) }), () => undefined);
      }
    } catch (err) {
      setLoadError(messageOf(err, "Could not load this revision.").message);
    }
  }, [entityId, versionId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the initial load IS the external-system sync
    void load();
  }, [load]);

  const editable = version?.status === "DRAFT";
  const dirty = editable && saved !== null && form !== null && isDirty(saved, form);
  useUnsavedChangesGuard(Boolean(dirty));

  const kind = useMemo(() => (catalog === null || form?.candidate == null ? null : (catalog.kinds.find((k) => k.definitionKind === form.candidate!.definitionKind) ?? null)), [catalog, form]);
  const descriptor = kind !== null && form?.candidate ? descriptorFor(kind, form.candidate.schemaVersion) : null;
  const staleValidation = validation !== null && form !== null && validation.forCandidate !== JSON.stringify(form.candidate);

  const refreshMetadata = async () => {
    const [k, s] = await Promise.all([listVersionKeywords(versionId), listVersionSources(versionId)]);
    setKeywords(k);
    setSources(s);
  };

  if (loadError) return <p className="gov-error" role="alert">{loadError}</p>;
  if (entity === null || version === null || catalog === null || form === null || saved === null) return <p role="status">Loading revision…</p>;

  const set = (patch: Partial<Snapshot>) => setForm({ ...form, ...patch });

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(messageOf(e, `${label} failed.`));
    } finally {
      setBusy("");
    }
  }

  const doValidate = () =>
    run("Validate", async () => {
      if (form.candidate === null) return;
      const result = await validateCandidate(form.candidate.definitionKind, form.candidate);
      setValidation({ result, forCandidate: JSON.stringify(form.candidate) });
      if (result.status === "FAIL") validationHeading.current?.focus();
    });

  const doSave = () =>
    run("Save Draft", async () => {
      const result = await saveDraft(versionId, {
        expectedUpdatedAt: version.updatedAt,
        displayName: form.displayName,
        shortDescription: form.shortDescription || null,
        rulesText: form.rulesText || null,
        changeType: form.changeType || null,
        changeSummary: form.changeSummary || null,
        ...(form.candidate === null ? {} : { prowessDefinition: form.candidate }),
      });
      setVersion(result.version);
      const snap = snapshotOf(result.version);
      setSaved(snap);
      setForm(snap);
      if (result.validation !== null) {
        setValidation({ result: result.validation, forCandidate: JSON.stringify(snap.candidate) });
        if (result.validation.status === "FAIL") validationHeading.current?.focus();
      }
      setNotice(`Draft saved${result.validation ? ` — validation ${result.validation.status}` : ""}.`);
    });

  const sources_title = (id: string) => documents.find((d) => d.id === id)?.title ?? "Source Document";

  return (
    <div className="prowess-authoring">
      <nav className="gov-crumbs" aria-label="Breadcrumb">
        <ol>
          <li>
            <Link href="/compendium/admin">Compendium Admin</Link>
          </li>
          <li>
            <Link href={`/compendium/admin/entities/${entity.id}`}>{entity.canonicalKey}</Link>
          </li>
          <li aria-current="page">Revision {version.revisionNumber}</li>
        </ol>
      </nav>
      <header>
        <p className="gov-eyebrow">{editable ? "Edit Draft" : "Revision (read-only)"}</p>
        <h1>
          {saved.displayName} — Revision {version.revisionNumber}
        </h1>
        <p className="gov-meta">
          <VersionStatusBadge status={version.status} />
          <span className="gov-badge">{saved.candidate?.definitionKind ?? "Generic / non-Prowess Entity"}</span>
          <code>{entity.canonicalKey}</code>
          {editable ? (
            <span className="prowess-authoring__save-state" role="status" data-dirty={dirty ? "true" : "false"}>
              {dirty ? "Unsaved changes" : "Saved Draft"}
            </span>
          ) : null}
        </p>
        {!editable ? (
          <div className="gov-immutable" role="note">
            Revision {version.revisionNumber} is {formatEnumLabel(version.status)} and immutable — historical content is never edited. To change it, create a new revision.
            <div className="gov-actions">
              <button
                type="button"
                className="gov-button gov-button--primary"
                disabled={busy !== ""}
                onClick={() =>
                  run("Create New Revision", async () => {
                    const created = await createRevision(entity.id, { baseVersionId: version.id });
                    router.push(`/compendium/admin/entities/${entity.id}/revisions/${created.id}`);
                  })
                }
              >
                Create New Revision from Revision {version.revisionNumber}
              </button>
            </div>
          </div>
        ) : null}
        {notice ? (
          <p className="gov-ok" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <div className="gov-error" role="alert">
            <strong>
              {error.code === "COMPENDIUM_AUTHORING.STALE_REVISION"
                ? "This Draft changed after you opened it"
                : error.code === "ENTITY_VERSION.IMMUTABLE" || error.code === "ENTITY_VERSION.INVALID_STATUS_TRANSITION"
                  ? "Lifecycle conflict"
                  : error.code.startsWith("COMPENDIUM_AUTHORING.DEFINITION")
                    ? "Definition problem"
                    : "The action failed"}
            </strong>
            <p>{error.message}</p>
            <p className="gov-muted">
              <code>{error.code}</code>
            </p>
            {error.code === "COMPENDIUM_AUTHORING.STALE_REVISION" ? (
              <button type="button" className="gov-button" onClick={() => void load()}>
                Reload the saved Draft (discards your unsaved edits)
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      <nav aria-label="Workspace sections" className="prowess-authoring__sections">
        <ul>
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} data-skip-unsaved-guard>
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <section id="rev-content" className="gov-panel" aria-labelledby="rev-content-h">
        <h2 id="rev-content-h">Revision content</h2>
        <fieldset disabled={!editable} className="prowess-authoring__groups">
          <legend className="prowess-visually-hidden">Revision content</legend>
          <label className="gov-field" htmlFor="rev-display-name">
            <span>Display Name (human-facing; never changes the Canonical Key)</span>
            <input id="rev-display-name" value={form.displayName} onChange={(e) => set({ displayName: e.target.value })} />
          </label>
          <label className="gov-field" htmlFor="rev-short">
            <span>Short description</span>
            <input id="rev-short" value={form.shortDescription} onChange={(e) => set({ shortDescription: e.target.value })} />
          </label>
          <label className="gov-field" htmlFor="rev-rules">
            <span>Rules Text (human-facing explanation — never parsed into mechanics)</span>
            <textarea id="rev-rules" rows={6} value={form.rulesText} onChange={(e) => set({ rulesText: e.target.value })} />
          </label>
          <label className="gov-field" htmlFor="rev-change-type">
            <span>Change type</span>
            <select id="rev-change-type" value={form.changeType} onChange={(e) => set({ changeType: e.target.value })}>
              <option value="">Not specified</option>
              {CHANGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {formatEnumLabel(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="gov-field" htmlFor="rev-change-summary">
            <span>Change summary (history metadata, e.g. &quot;Updated Radius scaling.&quot;)</span>
            <input id="rev-change-summary" value={form.changeSummary} onChange={(e) => set({ changeSummary: e.target.value })} />
          </label>
        </fieldset>
      </section>

      <section id="rev-definition" className="gov-panel" aria-labelledby="rev-definition-h">
        <h2 id="rev-definition-h">Prowess Definition</h2>
        {form.candidate !== null && kind !== null ? (
          <DefinitionEditor kind={kind} catalog={catalog} candidate={form.candidate} onChange={(candidate) => set({ candidate })} issues={staleValidation ? [] : (validation?.result.issues ?? [])} readOnly={!editable} />
        ) : form.candidate !== null ? (
          <p className="gov-bad">This revision declares Definition kind {form.candidate.definitionKind}, which is not in the M5 catalog. It cannot be edited here.</p>
        ) : (
          <p className="gov-muted">Generic / non-Prowess Entity: this revision holds no Prowess Definition, and none is inferred from its name or text. Its revision content can still be edited.</p>
        )}
      </section>

      {editable ? (
        <div className="gov-actions prowess-authoring__savebar">
          <button type="button" className="gov-button" disabled={busy !== "" || form.candidate === null} onClick={() => void doValidate()}>
            {busy === "Validate" ? "Validating…" : "Validate Definition"}
          </button>
          <button type="button" className="gov-button gov-button--primary" disabled={busy !== "" || !dirty} onClick={() => void doSave()}>
            {busy === "Save Draft" ? "Saving…" : "Save Draft"}
          </button>
          <span className="gov-muted">{dirty ? "Unsaved changes" : "Saved Draft"}</span>
        </div>
      ) : null}

      <section id="rev-keywords" className="gov-panel" aria-labelledby="rev-keywords-h">
        <h2 id="rev-keywords-h">Revision-level Keywords</h2>
        <p className="gov-muted">Keyword assignments for this revision only (Entity-level Keywords live on the Entity page). Separate from the Definition&apos;s structured Keywords. Saved immediately; only a Draft can change them.</p>
        <ul className="prowess-authoring__chips" aria-label="Revision-level Keywords">
          {keywords.map((k) => (
            <li key={k.keyword.id} className="prowess-keyword-chip">
              {k.keyword.name}{" "}
              {editable ? (
                <button type="button" className="gov-link-button" aria-label={`Remove revision-level Keyword ${k.keyword.name}`} onClick={() => run("Remove Keyword", async () => { await removeVersionKeyword(versionId, k.keyword.id); await refreshMetadata(); })}>
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {editable ? <KeywordPicker label="Assign a revision-level Keyword" exclude={keywords.map((k) => k.keyword.id)} onPick={(k) => void run("Assign Keyword", async () => { await assignVersionKeyword(versionId, k.id); await refreshMetadata(); })} /> : null}
      </section>

      <section id="rev-sources" className="gov-panel" aria-labelledby="rev-sources-h">
        <h2 id="rev-sources-h">Sources / provenance</h2>
        <p className="gov-muted">File references are opaque labels: Studio never fetches a stored file reference. Saved immediately.</p>
        {sources.length === 0 ? <p className="gov-muted">No sources attached.</p> : null}
        <ul className="gov-list" aria-label="Attached sources">
          {sources.map((s) => {
            const doc = documents.find((d) => d.id === s.sourceDocumentId);
            return (
              <li key={s.id} className="gov-card gov-card--compact">
                <strong>{sources_title(s.sourceDocumentId)}</strong>
                {doc?.versionLabel ? <span className="gov-tag"> · version {doc.versionLabel}</span> : null}
                <dl className="gov-dl">
                  <dt>Section</dt>
                  <dd>{s.sectionLabel ?? "—"}</dd>
                  <dt>Page reference</dt>
                  <dd>{s.pageReference ?? "—"}</dd>
                  <dt>Excerpt note</dt>
                  <dd>{s.sourceExcerptNote ?? "—"}</dd>
                  {doc?.fileReference ? (
                    <>
                      <dt>File reference</dt>
                      <dd>
                        <code>{doc.fileReference}</code> <span className="gov-muted">(opaque label)</span>
                      </dd>
                    </>
                  ) : null}
                </dl>
                {editable ? (
                  <button type="button" className="gov-button" aria-label={`Remove source ${sources_title(s.sourceDocumentId)}`} onClick={() => run("Remove source", async () => { await removeSource(s.id); await refreshMetadata(); })}>
                    Remove
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
        {editable ? (
          <form
            className="gov-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run("Attach source", async () => {
                await attachSource(versionId, { sourceDocumentId: newSource.sourceDocumentId, sectionLabel: newSource.sectionLabel || null, pageReference: newSource.pageReference || null, sourceExcerptNote: newSource.sourceExcerptNote || null });
                setNewSource({ sourceDocumentId: "", sectionLabel: "", pageReference: "", sourceExcerptNote: "" });
                await refreshMetadata();
              });
            }}
          >
            <h3>Attach a Source Document</h3>
            <label className="gov-field" htmlFor="rev-source-doc">
              <span>Source Document</span>
              <select id="rev-source-doc" value={newSource.sourceDocumentId} onChange={(e) => setNewSource({ ...newSource, sourceDocumentId: e.target.value })}>
                <option value="">Choose…</option>
                {documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                    {d.versionLabel ? ` (${d.versionLabel})` : ""}
                  </option>
                ))}
              </select>
            </label>
            {(["sectionLabel", "pageReference", "sourceExcerptNote"] as const).map((f) => (
              <label key={f} className="gov-field" htmlFor={`rev-source-${f}`}>
                <span>{f === "sectionLabel" ? "Section" : f === "pageReference" ? "Page reference" : "Excerpt note"}</span>
                <input id={`rev-source-${f}`} value={newSource[f]} onChange={(e) => setNewSource({ ...newSource, [f]: e.target.value })} />
              </label>
            ))}
            <button type="submit" className="gov-button" disabled={newSource.sourceDocumentId === "" || busy !== ""}>
              Attach source
            </button>
          </form>
        ) : null}
      </section>

      <section id="rev-validation" className="gov-panel">
        {descriptor !== null ? (
          <ValidationPanel ref={validationHeading} result={validation?.result ?? null} stale={staleValidation} fields={descriptor.fields} />
        ) : (
          <p className="gov-muted">Validation applies to Prowess Definitions only.</p>
        )}
      </section>

      <section id="rev-preview" className="gov-panel" aria-labelledby="rev-preview-h">
        <h2 id="rev-preview-h">Preview</h2>
        <DefinitionPreview
          content={{
            displayName: form.displayName,
            shortDescription: form.shortDescription,
            rulesText: form.rulesText,
            status: version.status,
            revisionNumber: version.revisionNumber,
            sources: sources.map((s) => ({ title: sources_title(s.sourceDocumentId), sectionLabel: s.sectionLabel, pageReference: s.pageReference })),
          }}
          candidate={form.candidate}
          validation={staleValidation ? null : (validation?.result ?? null)}
        />
      </section>

      <section id="rev-workflow" className="gov-panel" aria-labelledby="rev-workflow-h">
        <h2 id="rev-workflow-h">Review and Canon hand-off</h2>
        <p className="gov-muted">
          A saved Draft is content; a published Ruleset Release is authority. Nothing here publishes. Review status is the revision&apos;s own lifecycle; Ruleset membership is decided in the Canon Manager through ChangeSets
          and Releases.
        </p>
        <div className="gov-actions">
          {version.status === "DRAFT" ? (
            <button type="button" className="gov-button" disabled={busy !== "" || dirty} onClick={() => run("Submit for review", async () => { const v = await submitForReview(versionId); setNotice("Submitted for review."); await load(); setVersion(v); })}>
              Submit for review
            </button>
          ) : null}
          {version.status === "IN_REVIEW" ? (
            <button type="button" className="gov-button" disabled={busy !== ""} onClick={() => run("Return to Draft", async () => { await returnToDraft(versionId); setNotice("Returned to Draft."); await load(); })}>
              Return to Draft
            </button>
          ) : null}
          {dirty ? <span className="gov-muted">Save the Draft before submitting it.</span> : null}
        </div>

        {saved.candidate !== null ? (
          <div className="gov-form">
            <h3>Propose to a Ruleset (Canon Manager)</h3>
            <p className="gov-muted">Creates a DRAFT ChangeSet in the Ruleset you choose here, proposing to pin exactly this revision. Review, approval, Manifests and publication continue in the Canon Manager. Only a revision that passes validation can be proposed.</p>
            {rulesets === null ? (
              <button type="button" className="gov-button" onClick={() => run("Load Rulesets", async () => setRulesets(await listAllRulesets()))}>
                Choose a Ruleset…
              </button>
            ) : (
              <>
                <label className="gov-field" htmlFor="rev-handoff-ruleset">
                  <span>Ruleset (explicit authoring context)</span>
                  <select
                    id="rev-handoff-ruleset"
                    value={handoff.rulesetId}
                    onChange={(e) => {
                      const rulesetId = e.target.value;
                      setHandoff({ ...handoff, rulesetId, targetManifestId: "", name: handoff.name || `${saved.displayName} — Revision ${version.revisionNumber}` });
                      setManifests([]);
                      if (rulesetId) listManifests(rulesetId).then((r) => setManifests(r.items), () => setManifests([]));
                    }}
                  >
                    <option value="">Choose…</option>
                    {rulesets.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({formatEnumLabel(r.status)})
                      </option>
                    ))}
                  </select>
                </label>
                {manifests.length > 0 ? (
                  <label className="gov-field" htmlFor="rev-handoff-manifest">
                    <span>Target Manifest (optional — recorded as the composition the proposal was analysed against; it is never edited)</span>
                    <select id="rev-handoff-manifest" value={handoff.targetManifestId} onChange={(e) => setHandoff({ ...handoff, targetManifestId: e.target.value })}>
                      <option value="">None</option>
                      {manifests.map((m) => (
                        <option key={m.id} value={m.id}>
                          Manifest v{m.manifestVersion}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="gov-field" htmlFor="rev-handoff-name">
                  <span>Proposal name</span>
                  <input id="rev-handoff-name" value={handoff.name} onChange={(e) => setHandoff({ ...handoff, name: e.target.value })} />
                </label>
                <label className="gov-field" htmlFor="rev-handoff-description">
                  <span>Description</span>
                  <input id="rev-handoff-description" value={handoff.description} onChange={(e) => setHandoff({ ...handoff, description: e.target.value })} />
                </label>
                <button
                  type="button"
                  className="gov-button gov-button--primary"
                  disabled={busy !== "" || dirty || handoff.rulesetId === "" || handoff.name.trim() === ""}
                  onClick={() =>
                    run("Create proposal", async () => {
                      const cs = await proposeChangeSet(versionId, {
                        rulesetId: handoff.rulesetId,
                        targetManifestId: handoff.targetManifestId || null,
                        name: handoff.name,
                        description: handoff.description || null,
                      });
                      setProposal({ id: cs.id, rulesetId: cs.rulesetId, name: cs.name });
                    })
                  }
                >
                  Create ChangeSet proposal
                </button>
              </>
            )}
            {proposal !== null ? (
              <p className="gov-ok" role="status">
                Proposal &quot;{proposal.name}&quot; created as a DRAFT ChangeSet. <Link href={canonManagerChangeSetHref(proposal.rulesetId, proposal.id)}>Open in Canon Manager</Link>
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section id="rev-history" className="gov-panel" aria-labelledby="rev-history-h">
        <h2 id="rev-history-h">History</h2>
        <div className="gov-actions">
          <Link href={`/compendium/entities/${entity.id}?revision=${version.revisionNumber}`}>View in Version History</Link>
          {version.revisionNumber > 1 ? <Link href={`/compendium/entities/${entity.id}?compareA=${version.revisionNumber - 1}&compareB=${version.revisionNumber}`}>Compare with Previous Revision</Link> : null}
          <Link href={`/compendium/admin/entities/${entity.id}`}>All revisions of this Entity</Link>
        </div>
      </section>
    </div>
  );
}
