"use client";

import { useEffect, useId, useState } from "react";
import {
  getEntity, getEntityVersion, listEntityVersions, listSourceDocuments, searchEntities,
  type EntityDto, type EntityVersionDto, type ManifestDto, type PolicyDto, type SourceDocumentDto,
} from "../../../../src/api-client";
import { formatDate } from "../_lib/presentation";

/**
 * Reusable developer pickers (§67–§70). They SELECT exact records; they never pick a "best" or latest
 * Version for the operator — nothing is preselected.
 */
const entityCache = new Map<string, Promise<EntityDto>>();
const versionCache = new Map<string, Promise<EntityVersionDto>>();
const cached = <T,>(cache: Map<string, Promise<T>>, id: string, load: () => Promise<T>) => {
  if (!cache.has(id)) cache.set(id, load().catch((e) => { cache.delete(id); throw e; }));
  return cache.get(id) as Promise<T>;
};

/** Shows an Entity's canonical key (falls back to the id while loading). */
export function EntityLabel({ id }: { id: string }) {
  const [entity, setEntity] = useState<EntityDto | null>(null);
  useEffect(() => {
    cached(entityCache, id, () => getEntity(id)).then(setEntity, () => setEntity(null));
  }, [id]);
  return <span title={id}>{entity ? entity.canonicalKey : <code>{id.slice(0, 8)}…</code>}</span>;
}

/** Shows "r<revision> — <display name> (STATUS)" for an exact Version. */
export function VersionLabel({ id }: { id: string }) {
  const [version, setVersion] = useState<EntityVersionDto | null>(null);
  useEffect(() => {
    cached(versionCache, id, () => getEntityVersion(id)).then(setVersion, () => setVersion(null));
  }, [id]);
  return (
    <span title={id} data-testid="version-label">
      {version ? `r${version.revisionNumber} — ${version.displayName} (${version.status})` : <code>{id.slice(0, 8)}…</code>}
    </span>
  );
}

/** Search an Entity by canonical key / text, then pick exactly one. */
export function EntityPicker({ value, onChange, label = "Entity" }: { value: string; onChange: (entityId: string) => void; label?: string }) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<EntityDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const tooShort = search.trim().length < 2;
  const shown = tooShort ? [] : results;
  useEffect(() => {
    if (tooShort) return;
    const t = setTimeout(() => {
      searchEntities(search.trim()).then(
        (r) => {
          setResults(r);
          setError(null);
        },
        () => setError("Entity search failed."),
      );
    }, 250);
    return () => clearTimeout(t);
  }, [search, tooShort]);
  return (
    <div className="gov-picker">
      <label htmlFor={`${id}-search`}>{label}</label>
      {value ? (
        <p className="gov-picker__selected">
          Selected: <EntityLabel id={value} />{" "}
          <button type="button" className="gov-link-button" onClick={() => onChange("")}>
            Change
          </button>
        </p>
      ) : (
        <>
          <input id={`${id}-search`} type="search" value={search} placeholder="Exact canonical key, or part of a name or alias" onChange={(e) => setSearch(e.target.value)} />
          {error ? <p className="gov-field__error">{error}</p> : null}
          <ul className="gov-picker__results" aria-label={`${label} results`}>
            {shown.map((entity) => (
              <li key={entity.id}>
                <button type="button" className="gov-link-button" onClick={() => onChange(entity.id)}>
                  {entity.canonicalKey} <span className="gov-muted">({entity.entityType})</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Pick one exact Version of a given Entity. Shows revision, display name, status and id. */
export function VersionSelect({ entityId, value, onChange, label = "Exact Version" }: { entityId: string; value: string; onChange: (versionId: string) => void; label?: string }) {
  const id = useId();
  const [versions, setVersions] = useState<EntityVersionDto[]>([]);
  const shown = entityId ? versions : [];
  useEffect(() => {
    if (!entityId) return;
    let cancelled = false;
    listEntityVersions(entityId).then(
      (v) => {
        if (!cancelled) setVersions(v);
      },
      () => {
        if (!cancelled) setVersions([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [entityId]);
  return (
    <div className="gov-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} disabled={!entityId} onChange={(e) => onChange(e.target.value)}>
        <option value="">{entityId ? "Choose an exact Version…" : "Choose an Entity first"}</option>
        {shown.map((v) => (
          <option key={v.id} value={v.id}>
            {`r${v.revisionNumber} — ${v.displayName} (${v.status}) · ${v.id.slice(0, 8)}`}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Entity + exact Version together, making it clear which Version belongs to which Entity (§13). */
export function EntityVersionPicker({
  value,
  onChange,
  entityLocked,
}: {
  value: { entityId: string; entityVersionId: string };
  onChange: (v: { entityId: string; entityVersionId: string }) => void;
  entityLocked?: boolean;
}) {
  return (
    <div className="gov-picker-pair">
      {entityLocked ? (
        <p>
          Entity: <EntityLabel id={value.entityId} />
        </p>
      ) : (
        <EntityPicker value={value.entityId} onChange={(entityId) => onChange({ entityId, entityVersionId: "" })} />
      )}
      <VersionSelect entityId={value.entityId} value={value.entityVersionId} onChange={(entityVersionId) => onChange({ ...value, entityVersionId })} />
    </div>
  );
}

export function ManifestSelect({ manifests, value, onChange, label = "Manifest", allowNone, noneLabel = "None" }: { manifests: ManifestDto[]; value: string; onChange: (id: string) => void; label?: string; allowNone?: boolean; noneLabel?: string }) {
  const id = useId();
  return (
    <div className="gov-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allowNone ? noneLabel : "Choose a Manifest…"}</option>
        {manifests.map((m) => (
          <option key={m.id} value={m.id}>
            {`Manifest v${m.manifestVersion}${m.parentManifestId ? " (has parent)" : ""} · ${formatDate(m.createdAt)} · ${m.id.slice(0, 8)}`}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Never auto-selects; "Latest" marks only the numerically highest policyVersion (§69). */
export function PolicySelect({ policies, value, onChange }: { policies: PolicyDto[]; value: string; onChange: (id: string) => void }) {
  const id = useId();
  const highest = policies.reduce((max, p) => Math.max(max, p.policyVersion), 0);
  return (
    <div className="gov-field">
      <label htmlFor={id}>Canon Policy</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose an exact Policy snapshot…</option>
        {policies.map((p) => (
          <option key={p.id} value={p.id}>
            {`Policy v${p.policyVersion} — ${p.name}${p.policyVersion === highest ? " (Latest)" : ""} · ${p.id.slice(0, 8)}`}
          </option>
        ))}
      </select>
    </div>
  );
}

/** SourceDocument picker over the existing M1 list endpoint (§20, §70). */
export function SourceDocumentSelect({ value, onChange, label = "Source Document" }: { value: string; onChange: (id: string) => void; label?: string }) {
  const id = useId();
  const [docs, setDocs] = useState<SourceDocumentDto[]>([]);
  useEffect(() => {
    listSourceDocuments().then(setDocs, () => setDocs([]));
  }, []);
  return (
    <div className="gov-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a Source Document…</option>
        {docs.map((d) => (
          <option key={d.id} value={d.id}>
            {`${d.title} (${d.sourceType}) · ${d.id.slice(0, 8)}`}
          </option>
        ))}
      </select>
    </div>
  );
}
