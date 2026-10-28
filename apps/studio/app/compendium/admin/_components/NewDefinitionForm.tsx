"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SourceDocumentDto } from "../../_lib/api-client";
import {
  AuthoringApiError,
  createDefinition,
  getCatalog,
  listSourceDocuments,
  validateCandidate,
  type AuthoringCatalogDto,
  type KeywordRowDto,
  type ValidationResultDto,
} from "../_lib/authoring-client";
import { isDirty, newCandidate, suggestCanonicalKey, type DefinitionCandidate } from "../_lib/definition-form";
import { descriptorFor } from "../_lib/descriptors";
import { useUnsavedChangesGuard } from "../_lib/use-navigation-guard";
import { DefinitionEditor } from "./DefinitionEditor";
import { DefinitionPreview } from "./DefinitionPreview";
import { KeywordPicker } from "./KeywordPicker";
import { ValidationPanel } from "./ValidationPanel";

/**
 * Create Definition (PAS-10 M6-WO1 §10–11): family → kind → canonical key → display name → description → structured
 * Definition → Keywords → optional provenance → validate → create the Entity and Revision 1 as a DRAFT, then open its
 * workspace. Kinds and storage EntityTypes come from the catalog (the M5 registry); the author never guesses an
 * EntityType, and reserved kinds are shown but cannot be chosen (§55). Creation happens in one server request that
 * validates every input before the first write (§10).
 */
interface SourceRow {
  sourceDocumentId: string;
  title: string;
  sectionLabel: string;
  pageReference: string;
  sourceExcerptNote: string;
}

export function NewDefinitionForm() {
  const router = useRouter();
  const validationHeading = useRef<HTMLHeadingElement>(null);
  const [catalog, setCatalog] = useState<AuthoringCatalogDto | null>(null);
  const [loadError, setLoadError] = useState("");
  const [family, setFamily] = useState("");
  const [kindName, setKindName] = useState("");
  const [canonicalKey, setCanonicalKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [rulesText, setRulesText] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [candidate, setCandidate] = useState<DefinitionCandidate | null>(null);
  const [entityKeywords, setEntityKeywords] = useState<KeywordRowDto[]>([]);
  const [versionKeywords, setVersionKeywords] = useState<KeywordRowDto[]>([]);
  const [documents, setDocuments] = useState<SourceDocumentDto[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [pendingDoc, setPendingDoc] = useState("");
  const [validation, setValidation] = useState<{ result: ValidationResultDto; forCandidate: string } | null>(null);
  const [busy, setBusy] = useState<"" | "validate" | "create">("");
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  useEffect(() => {
    getCatalog().then(setCatalog, (e: unknown) => setLoadError(e instanceof AuthoringApiError ? e.message : "Could not load the authoring catalog."));
    listSourceDocuments().then(setDocuments, () => setDocuments([]));
  }, []);

  const families = useMemo(() => (catalog === null ? [] : catalog.systemFamilies.filter((f) => catalog.kinds.some((k) => k.systemFamily === f))), [catalog]);
  const kindsOfFamily = useMemo(() => (catalog === null ? [] : catalog.kinds.filter((k) => k.systemFamily === family)), [catalog, family]);
  const kind = catalog?.kinds.find((k) => k.definitionKind === kindName) ?? null;
  const descriptor = kind !== null && candidate !== null ? descriptorFor(kind, candidate.schemaVersion) : null;

  const pristine = { family: "", kindName: "", canonicalKey: "", displayName: "", shortDescription: "", rulesText: "", sources: [], entityKeywords: [], versionKeywords: [] };
  const dirty = isDirty(pristine, { family, kindName, canonicalKey, displayName, shortDescription, rulesText, sources, entityKeywords, versionKeywords }) && busy !== "create";
  useUnsavedChangesGuard(dirty);

  const candidateKey = JSON.stringify(candidate);
  const staleValidation = validation !== null && validation.forCandidate !== candidateKey;

  async function runValidation() {
    if (kind === null || candidate === null) return;
    setBusy("validate");
    setError(null);
    try {
      const result = await validateCandidate(kind.definitionKind, candidate);
      setValidation({ result, forCandidate: JSON.stringify(candidate) });
      if (result.status === "FAIL") validationHeading.current?.focus();
    } catch (e) {
      setError(e instanceof AuthoringApiError ? { code: e.code, message: e.message } : { code: "UNKNOWN", message: "Validation could not run." });
    } finally {
      setBusy("");
    }
  }

  async function create() {
    if (kind === null || candidate === null) return;
    setBusy("create");
    setError(null);
    try {
      const created = await createDefinition({
        definitionKind: kind.definitionKind,
        entityType: kind.allowedEntityTypes.length === 1 ? kind.allowedEntityTypes[0] : null,
        canonicalKey: canonicalKey.trim(),
        displayName,
        shortDescription: shortDescription || null,
        rulesText: rulesText || null,
        changeSummary: changeSummary || null,
        prowessDefinition: candidate,
        entityKeywordIds: entityKeywords.map((k) => k.id),
        versionKeywordIds: versionKeywords.map((k) => k.id),
        sources: sources.map((s) => ({ sourceDocumentId: s.sourceDocumentId, sectionLabel: s.sectionLabel || null, pageReference: s.pageReference || null, sourceExcerptNote: s.sourceExcerptNote || null })),
      });
      router.push(`/compendium/admin/entities/${created.entity.id}/revisions/${created.version.id}?created=1`);
    } catch (e) {
      setBusy("");
      setError(e instanceof AuthoringApiError ? { code: e.code, message: e.message } : { code: "UNKNOWN", message: "The Definition could not be created." });
    }
  }

  if (loadError) return <p className="gov-error" role="alert">{loadError}</p>;
  if (catalog === null) return <p role="status">Loading the authoring catalog…</p>;

  const canCreate = kind !== null && candidate !== null && canonicalKey.trim() !== "" && displayName.trim() !== "" && busy === "";

  return (
    <form
      className="prowess-authoring prowess-authoring__form"
      aria-labelledby="new-definition-heading"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <nav className="gov-crumbs" aria-label="Breadcrumb">
        <ol>
          <li>
            <Link href="/compendium/admin">Compendium Admin</Link>
          </li>
          <li aria-current="page">New Definition</li>
        </ol>
      </nav>
      <h1 id="new-definition-heading">New Definition</h1>
      <p className="gov-muted">The new Definition is saved as Revision 1 in DRAFT. It does not enter any Ruleset until it is proposed through the Canon Manager.</p>

      <section className="gov-panel" aria-labelledby="new-def-kind">
        <h2 id="new-def-kind">1. What are you authoring?</h2>
        <label className="gov-field" htmlFor="new-def-family">
          <span>Definition family</span>
          <select
            id="new-def-family"
            value={family}
            onChange={(e) => {
              setFamily(e.target.value);
              setKindName("");
              setCandidate(null);
              setValidation(null);
            }}
          >
            <option value="">Choose a family…</option>
            {families.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="gov-field" htmlFor="new-def-kind-select">
          <span>Definition kind</span>
          <select
            id="new-def-kind-select"
            value={kindName}
            disabled={family === ""}
            onChange={(e) => {
              const next = catalog.kinds.find((k) => k.definitionKind === e.target.value) ?? null;
              setKindName(e.target.value);
              setCandidate(next === null ? null : newCandidate(next));
              setValidation(null);
            }}
          >
            <option value="">Choose a kind…</option>
            {kindsOfFamily.map((k) => (
              <option key={k.definitionKind} value={k.definitionKind} disabled={!k.authorable}>
                {k.definitionKind}
                {k.authorable ? "" : " — reserved, not yet authorable"}
              </option>
            ))}
          </select>
        </label>
        {kind !== null ? (
          <p>
            Stored as Entity Type{kind.allowedEntityTypes.length === 1 ? "" : "s"}: <strong>{kind.allowedEntityTypes.join(" / ")}</strong> (decided by the M5 catalog for {kind.definitionKind}, not chosen by hand).
          </p>
        ) : null}
      </section>

      <section className="gov-panel" aria-labelledby="new-def-identity">
        <h2 id="new-def-identity">2. Identity</h2>
        <label className="gov-field" htmlFor="new-def-display-name">
          <span>Display Name (required)</span>
          <input id="new-def-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label className="gov-field" htmlFor="new-def-canonical-key">
          <span>Canonical Key (required)</span>
          <input id="new-def-canonical-key" value={canonicalKey} onChange={(e) => setCanonicalKey(e.target.value)} spellCheck={false} aria-describedby="new-def-canonical-key-help" />
        </label>
        <p id="new-def-canonical-key-help" className="gov-muted">
          The Canonical Key is the Definition&apos;s permanent machine identity (for example <code>spell.effect.force_push</code>). The Display Name is the human-facing name: renaming it later never changes the Canonical Key. A
          Canonical Key already in use is an error.
        </p>
        <div className="gov-actions">
          <button type="button" className="gov-button" disabled={kind === null || displayName.trim() === ""} onClick={() => kind && setCanonicalKey(suggestCanonicalKey(kind.definitionKind, displayName))}>
            Suggest a Canonical Key from the Display Name
          </button>
        </div>
      </section>

      <section className="gov-panel" aria-labelledby="new-def-content">
        <h2 id="new-def-content">3. Description and Rules Text</h2>
        <label className="gov-field" htmlFor="new-def-short">
          <span>Short description</span>
          <input id="new-def-short" value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} />
        </label>
        <label className="gov-field" htmlFor="new-def-rules">
          <span>Rules Text (human-facing explanation — never parsed into mechanics)</span>
          <textarea id="new-def-rules" rows={5} value={rulesText} onChange={(e) => setRulesText(e.target.value)} />
        </label>
        <label className="gov-field" htmlFor="new-def-change">
          <span>Change summary</span>
          <input id="new-def-change" value={changeSummary} onChange={(e) => setChangeSummary(e.target.value)} placeholder="Why this revision exists" />
        </label>
      </section>

      <section className="gov-panel" aria-labelledby="new-def-structured">
        <h2 id="new-def-structured">4. Structured Prowess Definition</h2>
        {kind !== null && candidate !== null ? (
          <DefinitionEditor kind={kind} catalog={catalog} candidate={candidate} onChange={setCandidate} issues={validation?.result.issues ?? []} />
        ) : (
          <p className="gov-muted">Choose a Definition kind first.</p>
        )}
      </section>

      <section className="gov-panel" aria-labelledby="new-def-keywords">
        <h2 id="new-def-keywords">5. Keyword assignments</h2>
        <p className="gov-muted">Database Keyword assignments are discovery metadata, separate from the Definition&apos;s own structured Keywords above. Entity-level Keywords describe the Entity across all its revisions; revision-level Keywords belong to Revision 1 only.</p>
        {(
          [
            ["Entity-level Keywords (all revisions)", entityKeywords, setEntityKeywords],
            ["Revision-level Keywords (Revision 1 only)", versionKeywords, setVersionKeywords],
          ] as const
        ).map(([label, list, setList]) => (
          <div key={label} className="prowess-authoring__field">
            <h3>{label}</h3>
            <ul className="prowess-authoring__chips" aria-label={label}>
              {list.map((k) => (
                <li key={k.id} className="prowess-keyword-chip">
                  {k.name}{" "}
                  <button type="button" className="gov-link-button" onClick={() => setList(list.filter((x) => x.id !== k.id))} aria-label={`Remove ${k.name} from ${label}`}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <KeywordPicker label={`Add to ${label}`} exclude={list.map((k) => k.id)} onPick={(k) => setList([...list, k])} />
          </div>
        ))}
      </section>

      <section className="gov-panel" aria-labelledby="new-def-sources">
        <h2 id="new-def-sources">6. Sources / provenance (optional)</h2>
        <p className="gov-muted">Attach existing Source Documents. File references are shown as opaque labels — Studio never opens a stored file reference.</p>
        <ul className="gov-list">
          {sources.map((s, i) => (
            <li key={i} className="gov-card gov-card--compact">
              <strong>{s.title}</strong>
              <div className="prowess-authoring__row">
                {(["sectionLabel", "pageReference", "sourceExcerptNote"] as const).map((f) => (
                  <label key={f} className="gov-field">
                    <span>{f === "sectionLabel" ? "Section" : f === "pageReference" ? "Page reference" : "Excerpt note"}</span>
                    <input value={s[f]} onChange={(e) => setSources(sources.map((x, j) => (j === i ? { ...x, [f]: e.target.value } : x)))} />
                  </label>
                ))}
                <button type="button" className="gov-button" onClick={() => setSources(sources.filter((_, j) => j !== i))} aria-label={`Remove source ${s.title}`}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="gov-actions">
          <label className="gov-field" htmlFor="new-def-source-doc">
            <span>Source Document</span>
            <select id="new-def-source-doc" value={pendingDoc} onChange={(e) => setPendingDoc(e.target.value)}>
              <option value="">Choose a document…</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                  {d.versionLabel ? ` (${d.versionLabel})` : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="gov-button"
            disabled={pendingDoc === ""}
            onClick={() => {
              const d = documents.find((x) => x.id === pendingDoc);
              if (d) setSources([...sources, { sourceDocumentId: d.id, title: d.title, sectionLabel: "", pageReference: "", sourceExcerptNote: "" }]);
              setPendingDoc("");
            }}
          >
            Attach source
          </button>
        </div>
      </section>

      {descriptor !== null ? <ValidationPanel ref={validationHeading} result={validation?.result ?? null} stale={staleValidation} fields={descriptor.fields} /> : null}

      <DefinitionPreview
        content={{ displayName, shortDescription, rulesText, status: null, revisionNumber: null, sources: sources.map((s) => ({ title: s.title, sectionLabel: s.sectionLabel || null, pageReference: s.pageReference || null })) }}
        candidate={candidate}
        validation={staleValidation ? null : (validation?.result ?? null)}
      />

      {error ? (
        <div className="gov-error" role="alert">
          <strong>{error.code === "ENTITY.CANONICAL_KEY_CONFLICT" ? "Canonical Key conflict" : error.code.startsWith("COMPENDIUM_AUTHORING.DEFINITION") ? "Definition refused" : "Could not create the Definition"}</strong>
          <p>{error.message}</p>
          <p className="gov-muted">
            <code>{error.code}</code>
          </p>
        </div>
      ) : null}

      <div className="gov-actions">
        <button type="button" className="gov-button" disabled={kind === null || candidate === null || busy !== ""} onClick={() => void runValidation()}>
          {busy === "validate" ? "Validating…" : "Validate Definition"}
        </button>
        <button type="submit" className="gov-button gov-button--primary" disabled={!canCreate}>
          {busy === "create" ? "Creating…" : "Create Definition as Draft"}
        </button>
        <Link href="/compendium/admin" className="gov-button">
          Cancel
        </Link>
      </div>
    </form>
  );
}
