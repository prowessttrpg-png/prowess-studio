"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { listAllRulesets } from "../../../src/api-client/governance";
import type { RulesetDto } from "../../../src/api-client/types";
import { listReleases, type ReleaseSummaryDto } from "../../compendium/rulesets/_lib/reference-client";
import { formatDate, readableToken, releaseName } from "../../compendium/rulesets/_lib/reference-urls";
import { EncounterApiError, createEncounter, newSubmissionKey } from "../_lib/encounter-client";

/**
 * New encounter (M7-WO1): name it and choose ONE exact published Release explicitly (nothing is preselected — there is no
 * "latest" default). Only completed Characters built on that Release can join it. The Release never changes afterwards.
 */
export function NewEncounterForm() {
  const router = useRouter();
  const [rulesets, setRulesets] = useState<RulesetDto[] | null>(null);
  const [rulesetId, setRulesetId] = useState("");
  const [releases, setReleases] = useState<ReleaseSummaryDto[] | null>(null);
  const [releaseId, setReleaseId] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per submission: a retry after a lost response reuses it, so the server never creates two encounters.
  const pendingKey = useRef<string | null>(null);

  useEffect(() => {
    listAllRulesets().then(setRulesets, () => setError("Could not load Rulesets."));
  }, []);
  useEffect(() => {
    if (rulesetId === "") return;
    let live = true;
    listReleases(rulesetId).then(
      (r) => live && setReleases(r.releases),
      () => live && setError("Could not load this Ruleset's Releases."),
    );
    return () => {
      live = false;
    };
  }, [rulesetId]);

  const submit = async () => {
    if (name.trim() === "") return setFieldError("Give the encounter a name.");
    if (releaseId === "") return setFieldError("Choose the exact Release this encounter uses.");
    setFieldError(null);
    setBusy(true);
    setError(null);
    pendingKey.current ??= newSubmissionKey();
    try {
      const created = await createEncounter({ name, notes: notes.trim() === "" ? null : notes, rulesetReleaseId: releaseId, idempotencyKey: pendingKey.current });
      pendingKey.current = null;
      router.push(`/encounters/${encodeURIComponent(created.encounter.id)}`);
    } catch (e) {
      if (!(e instanceof EncounterApiError) || e.code !== "NETWORK_ERROR") pendingKey.current = null;
      setError(e instanceof EncounterApiError ? e.message : "Could not create the encounter.");
      setBusy(false);
    }
  };

  return (
    <form
      className="gov-form prowess-encounter"
      aria-label="New encounter"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <nav className="gov-crumbs" aria-label="Breadcrumb">
        <Link href="/encounters">Encounters</Link> / <span aria-current="page">New encounter</span>
      </nav>
      <h1>New encounter</h1>
      <p>Choose the exact published Release for this encounter. Only completed Characters built on that same Release can join; a newer Release never changes it.</p>
      <label className="gov-field">
        <span>Name (required)</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-invalid={fieldError !== null && name.trim() === "" ? true : undefined} />
      </label>
      <label className="gov-field">
        <span>Notes (optional)</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} rows={3} />
      </label>
      <label className="gov-field">
        <span>Ruleset</span>
        <select
          value={rulesetId}
          onChange={(e) => {
            setRulesetId(e.target.value);
            setReleases(null);
            setReleaseId("");
          }}
        >
          <option value="">{rulesets === null ? "Loading Rulesets…" : "Choose a Ruleset…"}</option>
          {(rulesets ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {releases !== null && releases.length === 0 ? <p className="gov-muted">This Ruleset has no published Release yet.</p> : null}
      {releases !== null && releases.length > 0 ? (
        <label className="gov-field">
          <span>Release (required)</span>
          <select value={releaseId} onChange={(e) => setReleaseId(e.target.value)} aria-invalid={fieldError !== null && releaseId === "" ? true : undefined}>
            <option value="">Choose a Release…</option>
            {[...releases].reverse().map((r) => (
              <option key={r.id} value={r.id}>
                {releaseName(r)} · {readableToken(r.channel)} · {formatDate(r.publishedAt)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {fieldError !== null ? (
        <p className="gov-field__error" role="alert" data-testid="new-encounter-field-error">
          {fieldError}
        </p>
      ) : null}
      {error !== null ? (
        <p className="gov-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="gov-actions">
        <button type="submit" className="gov-button" disabled={busy}>
          {busy ? "Creating…" : "Create encounter"}
        </button>
        <Link href="/encounters">Cancel</Link>
      </p>
    </form>
  );
}
