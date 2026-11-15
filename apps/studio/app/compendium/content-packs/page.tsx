"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
interface PackManifestDto {
  label: string;
  contentDigest: string;
  formatVersion: number;
  release: { versionLabel: string; releaseNumber: number; rulesetId: string; releaseId: string };
  provenance: { claimedCreator: string; category: string };
  compatibility: { definitionSchemas: unknown[] };
  files: Array<{ type: string; byteSize: number }>;
}

interface Receipt { manifest: PackManifestDto; trust: string }
interface ContentPackPreview extends Receipt {
  previewFingerprint: string;
  added: number;
  reused: number;
  state: "Ready" | "Already installed" | "Conflict";
  conflicts: string[];
}

async function readPacks(signal?: AbortSignal): Promise<Receipt[]> {
  const response = await fetch("/api/content-packs", { signal });
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Unable to read installed packs.");
  return body as Receipt[];
}

export default function ContentPacksPage() {
  const [packs, setPacks] = useState<Receipt[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ContentPackPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const abort = new AbortController();
    void readPacks(abort.signal).then(setPacks, (reason: unknown) => {
      if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to read installed packs.");
    });
    return () => abort.abort();
  }, []);

  async function submit(action: "preview" | "install") {
    if (!file) return;
    setPending(true);
    setError("");
    setNotice("");
    if (action === "preview") setPreview(null);
    try {
      const response = await fetch(`/api/content-packs/${action}`, {
        method: "POST",
        body: file,
        headers: action === "install" && preview ? { "x-prowess-pack-preview": preview.previewFingerprint } : {},
      });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The pack could not be read.");
      if (action === "preview") setPreview(body as ContentPackPreview);
      else {
        setPreview(null);
        setNotice(body.state);
        setPacks(await readPacks());
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to open the pack.");
      if (action === "install") setPreview(null);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="prowess-reference">
      <nav className="gov-crumbs" aria-label="Breadcrumb"><Link href="/compendium">Compendium</Link> / Content Packs</nav>
      <h1>Content Packs</h1>
      <form onSubmit={(event) => { event.preventDefault(); void submit("preview"); }}>
        <fieldset disabled={pending}>
          <legend>Import Content Pack</legend>
          <label htmlFor="content-pack-file">Choose a .prowesspack file</label>{" "}
          <input id="content-pack-file" type="file" accept=".prowesspack" onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setPreview(null);
            setError("");
            setNotice("");
          }} />{" "}
          <button className="gov-button" disabled={!file}>Preview pack</button>
        </fieldset>
      </form>
      {pending ? <p role="status">Checking content pack…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {preview ? (
        <section aria-labelledby="pack-preview">
          <h2 id="pack-preview">{preview.manifest.label}</h2>
          <dl>
            <dt>Release</dt><dd>{preview.manifest.release.versionLabel} (#{preview.manifest.release.releaseNumber})</dd>
            <dt>Claimed creator</dt><dd>{preview.manifest.provenance.claimedCreator}</dd>
            <dt>Claimed category</dt><dd>{preview.manifest.provenance.category}</dd>
            <dt>Source verification</dt><dd>{preview.trust}</dd>
            <dt>Compatibility</dt><dd>Format {preview.manifest.formatVersion} · {preview.manifest.compatibility.definitionSchemas.length} Definition schemas</dd>
            <dt>Changes</dt><dd>{preview.added} new · {preview.reused} already present</dd>
            <dt>Offline assets</dt><dd>{preview.manifest.files.filter((entry) => entry.type === "asset").reduce((total, entry) => total + entry.byteSize, 0).toLocaleString()} bytes</dd>
          </dl>
          <p>{preview.state}</p>
          {preview.conflicts.length ? <ul>{preview.conflicts.map((message) => <li key={message}>{message}</li>)}</ul> : null}
          {preview.state === "Ready" ? <button type="button" className="gov-button" disabled={pending} onClick={() => void submit("install")}>Install pack</button> : null}
        </section>
      ) : null}
      <section aria-labelledby="installed-packs">
        <h2 id="installed-packs">Installed packs</h2>
        {!packs.length ? <p>No content packs installed.</p> : (
          <ul>{packs.map(({ manifest, trust }) => (
            <li key={manifest.contentDigest}>
              <Link href={`/compendium/rulesets/${manifest.release.rulesetId}/releases/${manifest.release.releaseId}`}>{manifest.label} — {manifest.release.versionLabel}</Link>
              {" · "}{trust}
            </li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}
