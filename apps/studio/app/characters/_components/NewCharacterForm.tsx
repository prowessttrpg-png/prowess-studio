"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { listAllRulesets } from "../../../src/api-client/governance";
import type { RulesetDto } from "../../../src/api-client/types";
import { listReleases, type ReleaseSummaryDto as ReferenceReleaseDto } from "../../compendium/rulesets/_lib/reference-client";
import { formatDate, readableToken, releaseName } from "../../compendium/rulesets/_lib/reference-urls";
import { CharacterApiError, createCharacter, getCapability, type CapabilityDto } from "../_lib/character-client";

/**
 * New Character (PAS-10 M6-WO3 §55): choose a published Ruleset Release EXPLICITLY (nothing is preselected — there is
 * no "latest" default), see whether that exact Release can build a Character, name the Character, create the Draft.
 * Once created, the Character's Release never changes.
 */
export function NewCharacterForm() {
  const router = useRouter();
  const [rulesets, setRulesets] = useState<RulesetDto[]>([]);
  const [rulesetId, setRulesetId] = useState("");
  const [releases, setReleases] = useState<ReferenceReleaseDto[] | null>(null);
  const [releaseId, setReleaseId] = useState("");
  const [capability, setCapability] = useState<CapabilityDto | null>(null);
  const [name, setName] = useState("");
  const [concept, setConcept] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
  useEffect(() => {
    if (releaseId === "") return;
    let live = true;
    getCapability(releaseId).then(
      (c) => live && setCapability(c),
      (e: unknown) => live && setError(e instanceof CharacterApiError ? `${e.message} (${e.code})` : "Could not check this Release."),
    );
    return () => {
      live = false;
    };
  }, [releaseId]);

  const ready = capability !== null && capability.release.id === releaseId && capability.status === "READY";
  return (
    <form
      className="gov-form prowess-character"
      aria-label="New Character"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const created = await createCharacter({ name, concept: concept.trim() === "" ? null : concept, rulesetReleaseId: releaseId });
          router.push(`/characters/${encodeURIComponent(created.id)}/create`);
        } catch (err) {
          setError(err instanceof CharacterApiError ? `${err.message} (${err.code})` : "Could not create the Character.");
          setBusy(false);
        }
      }}
    >
      <h1>New Character</h1>
      <p>Choose the exact published Release this Character is built from. The Character stays on that Release — a newer Release never changes it.</p>
      <label className="gov-field">
        <span>Ruleset</span>
        <select
          value={rulesetId}
          onChange={(e) => {
            setRulesetId(e.target.value);
            setReleases(null);
            setReleaseId("");
            setCapability(null);
          }}
        >
          <option value="">Choose a Ruleset…</option>
          {rulesets.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {releases !== null && releases.length === 0 ? <p className="gov-muted">This Ruleset has no published Release yet.</p> : null}
      {releases !== null && releases.length > 0 ? (
        <label className="gov-field">
          <span>Release</span>
          <select
            value={releaseId}
            onChange={(e) => {
              setReleaseId(e.target.value);
              setCapability(null);
            }}
          >
            <option value="">Choose a Release…</option>
            {[...releases].reverse().map((r) => (
              <option key={r.id} value={r.id}>
                {releaseName(r)} · {readableToken(r.channel)} · {formatDate(r.publishedAt)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {releaseId !== "" && capability === null ? <p role="status">Checking this Release…</p> : null}
      {capability !== null && capability.release.id === releaseId && capability.status !== "READY" ? (
        <div className="gov-bad" role="alert" data-testid="capability-missing">
          <strong>This Release cannot build a Character yet.</strong>
          <ul>
            {capability.missing.map((m, i) => (
              <li key={i}>
                {m.requirement}: {m.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {ready ? <p className="gov-ok" data-testid="capability-ready">This Release contains everything Character creation needs.</p> : null}
      <label className="gov-field">
        <span>Name (required)</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
      </label>
      <label className="gov-field">
        <span>Concept (optional)</span>
        <textarea value={concept} onChange={(e) => setConcept(e.target.value)} maxLength={2000} />
      </label>
      {error !== null ? (
        <p className="gov-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="gov-actions">
        <button type="submit" className="gov-button gov-button--primary" disabled={!ready || name.trim() === "" || busy}>
          Create Character Draft
        </button>
      </p>
    </form>
  );
}
