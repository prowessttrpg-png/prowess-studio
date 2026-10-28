"use client";

import { RELATIONSHIP_TYPES } from "@prowess/model";
import { EntityTypeBadge, formatEnumLabel, VersionStatusBadge } from "@prowess/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { EntityDto, EntityVersionDto } from "../../_lib/api-client";
import {
  AuthoringApiError,
  assignEntityKeyword,
  createAlias,
  createRelationship,
  createRevision,
  getEntity,
  listAliases,
  listEntityKeywords,
  listRelationships,
  listVersions,
  removeAlias,
  removeEntityKeyword,
  removeRelationship,
  searchEntities,
  type KeywordAssignmentDto,
  type RelationshipRowDto,
} from "../_lib/authoring-client";
import { storedCandidate } from "../_lib/definition-form";
import { AuthoredDataEditor } from "./AuthoredDataEditor";
import { KeywordPicker } from "./KeywordPicker";

/**
 * Manage an existing Entity (PAS-10 M6-WO1 §4, §18, §20–24, §64–65). Entity-level concerns only: stable identity,
 * the full revision history (with Create New Revision, links into the existing Version History and revision
 * comparison), aliases, Entity-level Keywords and relationships — each through its existing M1 endpoint. Revision
 * CONTENT is edited in the revision workspace. There is no Entity deletion (§44).
 */
interface Loaded {
  entity: EntityDto;
  versions: EntityVersionDto[];
  aliases: Array<{ id: string; alias: string; context: string | null }>;
  keywords: KeywordAssignmentDto[];
  relationships: { outgoing: RelationshipRowDto[]; incoming: RelationshipRowDto[] };
}

function ErrorLine({ error }: { error: string }) {
  return error ? (
    <p className="gov-bad" role="alert">
      {error}
    </p>
  ) : null;
}
const messageOf = (e: unknown, fallback: string) => (e instanceof AuthoringApiError ? `${e.message} (${e.code})` : fallback);

export function EntityWorkspace({ entityId }: { entityId: string }) {
  const router = useRouter();
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revisionError, setRevisionError] = useState("");
  const [revisionSummary, setRevisionSummary] = useState("");
  const [alias, setAlias] = useState({ alias: "", context: "" });
  const [aliasError, setAliasError] = useState("");
  const [keywordError, setKeywordError] = useState("");
  const [relationship, setRelationship] = useState<{ type: string; target: EntityDto | null; metadata: Record<string, unknown> }>({ type: "", target: null, metadata: {} });
  const [targetSearch, setTargetSearch] = useState("");
  const [targetResults, setTargetResults] = useState<Array<{ entity: EntityDto; latestRevision: { displayName: string } | null }>>([]);
  const [relationshipError, setRelationshipError] = useState("");

  const load = useCallback(async () => {
    try {
      const [entity, versions, aliases, keywords, relationships] = await Promise.all([getEntity(entityId), listVersions(entityId), listAliases(entityId), listEntityKeywords(entityId), listRelationships(entityId)]);
      setData({ entity, versions, aliases, keywords, relationships });
    } catch (e) {
      setLoadError(messageOf(e, "Could not load this Entity."));
    }
  }, [entityId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the initial load IS the external-system sync
    void load();
  }, [load]);

  useEffect(() => {
    if (targetSearch.trim().length < 2) return;
    let cancelled = false;
    const t = setTimeout(() => {
      searchEntities(targetSearch.trim()).then(
        (r) => !cancelled && setTargetResults(r.filter((x) => x.entity.id !== entityId)),
        () => !cancelled && setTargetResults([]),
      );
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [targetSearch, entityId]);

  if (loadError) return <p className="gov-error" role="alert">{loadError}</p>;
  if (data === null) return <p role="status">Loading Entity…</p>;

  const { entity, versions } = data;
  const latest = versions.length === 0 ? null : versions[versions.length - 1]!;
  const kind = latest === null ? null : (storedCandidate(latest.structuredData)?.definitionKind ?? null);

  async function newRevision(base: EntityVersionDto) {
    setBusy(true);
    setRevisionError("");
    try {
      const created = await createRevision(entityId, { baseVersionId: base.id, changeSummary: revisionSummary || null });
      router.push(`/compendium/admin/entities/${entityId}/revisions/${created.id}`);
    } catch (e) {
      setRevisionError(messageOf(e, "Could not create a new revision."));
      setBusy(false);
    }
  }

  return (
    <div className="prowess-authoring">
      <nav className="gov-crumbs" aria-label="Breadcrumb">
        <ol>
          <li>
            <Link href="/compendium/admin">Compendium Admin</Link>
          </li>
          <li aria-current="page">{latest?.displayName ?? entity.canonicalKey}</li>
        </ol>
      </nav>
      <header>
        <p className="gov-eyebrow">Manage Entity</p>
        <h1>{latest?.displayName ?? entity.canonicalKey}</h1>
        <p className="gov-meta">
          <EntityTypeBadge entityType={entity.entityType} />
          <span className="gov-badge">{kind ?? "Generic / non-Prowess Entity"}</span>
          <Link href={`/compendium/entities/${entity.id}`}>Open in the Compendium browser</Link>
        </p>
      </header>

      <section className="gov-panel" aria-labelledby="ws-identity">
        <h2 id="ws-identity">Identity</h2>
        <dl className="gov-dl">
          <dt>Canonical Key</dt>
          <dd>
            <code>{entity.canonicalKey}</code>
          </dd>
          <dt>Entity Type</dt>
          <dd>{formatEnumLabel(entity.entityType)}</dd>
          <dt>Definition kind</dt>
          <dd>{kind ?? "None — generic content (no Definition kind is inferred from names)"}</dd>
          <dt>Entity id</dt>
          <dd className="gov-id">{entity.id}</dd>
        </dl>
        <p className="gov-muted">Identity is stable: revisions change content, never the Canonical Key, Entity Type or Definition kind.</p>
      </section>

      <section className="gov-panel" aria-labelledby="ws-history">
        <h2 id="ws-history">Revisions and history</h2>
        {versions.length === 0 ? <p className="gov-muted">No revisions.</p> : null}
        <ol className="gov-list" aria-label="Revisions">
          {[...versions].reverse().map((v) => (
            <li key={v.id} className="gov-card gov-card--compact" data-testid="authoring-revision">
              <p className="gov-meta">
                <strong>Revision {v.revisionNumber}</strong> <VersionStatusBadge status={v.status} /> <span>{v.displayName}</span>
                {latest?.id === v.id ? <span className="gov-tag">Latest Revision</span> : null}
              </p>
              {v.changeSummary ? <p className="gov-muted">{v.changeSummary}</p> : null}
              <div className="gov-actions">
                <Link className="gov-button" href={`/compendium/admin/entities/${entity.id}/revisions/${v.id}`}>
                  {v.status === "DRAFT" ? `Edit Draft (Revision ${v.revisionNumber})` : `View Revision ${v.revisionNumber}`}
                </Link>
                <Link href={`/compendium/entities/${entity.id}?revision=${v.revisionNumber}`}>Version History</Link>
                {v.revisionNumber > 1 ? <Link href={`/compendium/entities/${entity.id}?compareA=${v.revisionNumber - 1}&compareB=${v.revisionNumber}`}>Compare with previous revision</Link> : null}
              </div>
            </li>
          ))}
        </ol>
        {latest !== null ? (
          <div className="gov-form">
            <h3>Create New Revision</h3>
            <p className="gov-muted">Copies the content of Revision {latest.revisionNumber} into a new DRAFT of this same Entity. The server allocates the revision number; Revision {latest.revisionNumber} is not changed.</p>
            <label className="gov-field" htmlFor="ws-revision-summary">
              <span>Change summary (why this revision exists)</span>
              <input id="ws-revision-summary" value={revisionSummary} onChange={(e) => setRevisionSummary(e.target.value)} />
            </label>
            <div className="gov-actions">
              <button type="button" className="gov-button gov-button--primary" disabled={busy} onClick={() => void newRevision(latest)}>
                Create New Revision from Revision {latest.revisionNumber}
              </button>
            </div>
            <ErrorLine error={revisionError} />
          </div>
        ) : null}
      </section>

      <section className="gov-panel" aria-labelledby="ws-aliases">
        <h2 id="ws-aliases">Aliases</h2>
        <p className="gov-muted">Aliases are discovery metadata for search. They never change the Canonical Key. Saved immediately.</p>
        <ul className="gov-list" aria-label="Aliases">
          {data.aliases.map((a) => (
            <li key={a.id} className="gov-actions">
              <span>{a.alias}</span>
              {a.context ? <span className="gov-tag">context: {a.context}</span> : null}
              <button
                type="button"
                className="gov-button"
                aria-label={`Remove alias ${a.alias}`}
                onClick={async () => {
                  try {
                    await removeAlias(a.id);
                    await load();
                  } catch (e) {
                    setAliasError(messageOf(e, "Could not remove the alias."));
                  }
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <form
          className="gov-actions"
          onSubmit={async (e) => {
            e.preventDefault();
            setAliasError("");
            try {
              await createAlias(entityId, alias.alias, alias.context.trim() === "" ? null : alias.context);
              setAlias({ alias: "", context: "" });
              await load();
            } catch (err) {
              setAliasError(messageOf(err, "Could not add the alias."));
            }
          }}
        >
          <label className="gov-field" htmlFor="ws-alias">
            <span>Alias</span>
            <input id="ws-alias" value={alias.alias} onChange={(e) => setAlias({ ...alias, alias: e.target.value })} />
          </label>
          <label className="gov-field" htmlFor="ws-alias-context">
            <span>Context (optional)</span>
            <input id="ws-alias-context" value={alias.context} onChange={(e) => setAlias({ ...alias, context: e.target.value })} />
          </label>
          <button type="submit" className="gov-button" disabled={alias.alias.trim() === ""}>
            Add alias
          </button>
        </form>
        <ErrorLine error={aliasError} />
      </section>

      <section className="gov-panel" aria-labelledby="ws-keywords">
        <h2 id="ws-keywords">Entity-level Keywords</h2>
        <p className="gov-muted">Assigned to the Entity across all revisions (revision-level Keywords are managed per revision). Separate from a Definition&apos;s own structured Keywords. Saved immediately.</p>
        <ul className="prowess-authoring__chips" aria-label="Entity-level Keywords">
          {data.keywords.map((k) => (
            <li key={k.keyword.id} className="prowess-keyword-chip">
              {k.keyword.name}{" "}
              <button
                type="button"
                className="gov-link-button"
                aria-label={`Remove Entity-level Keyword ${k.keyword.name}`}
                onClick={async () => {
                  try {
                    await removeEntityKeyword(entityId, k.keyword.id);
                    await load();
                  } catch (e) {
                    setKeywordError(messageOf(e, "Could not remove the Keyword."));
                  }
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <KeywordPicker
          label="Assign an Entity-level Keyword"
          exclude={data.keywords.map((k) => k.keyword.id)}
          onPick={async (k) => {
            setKeywordError("");
            try {
              await assignEntityKeyword(entityId, k.id);
              await load();
            } catch (e) {
              setKeywordError(messageOf(e, "Could not assign the Keyword."));
            }
          }}
        />
        <ErrorLine error={keywordError} />
      </section>

      <section className="gov-panel" aria-labelledby="ws-relationships">
        <h2 id="ws-relationships">Relationships</h2>
        <p className="gov-muted">Each relationship is exactly what was authored: source Entity, type, target Entity and metadata. No inverse is created and nothing is inferred from names. Saved immediately.</p>
        <h3>Outgoing (this Entity is the source)</h3>
        {data.relationships.outgoing.length === 0 ? <p className="gov-muted">None.</p> : null}
        <ul className="gov-list" aria-label="Outgoing relationships">
          {data.relationships.outgoing.map((r) => (
            <li key={r.relationship.id} className="gov-card gov-card--compact">
              <code>{entity.canonicalKey}</code> — <strong>{formatEnumLabel(r.relationship.relationshipType)}</strong> → <code>{r.counterpart.canonicalKey}</code>
              {Object.keys(r.relationship.metadata).length > 0 ? <pre className="lab-json">{JSON.stringify(r.relationship.metadata, null, 2)}</pre> : null}
              <button
                type="button"
                className="gov-button"
                aria-label={`Remove relationship to ${r.counterpart.canonicalKey}`}
                onClick={async () => {
                  try {
                    await removeRelationship(r.relationship.id);
                    await load();
                  } catch (e) {
                    setRelationshipError(messageOf(e, "Could not remove the relationship."));
                  }
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <h3>Incoming (this Entity is the target)</h3>
        {data.relationships.incoming.length === 0 ? <p className="gov-muted">None.</p> : null}
        <ul className="gov-list" aria-label="Incoming relationships">
          {data.relationships.incoming.map((r) => (
            <li key={r.relationship.id} className="gov-card gov-card--compact">
              <code>{r.counterpart.canonicalKey}</code> — <strong>{formatEnumLabel(r.relationship.relationshipType)}</strong> → <code>{entity.canonicalKey}</code>
            </li>
          ))}
        </ul>
        <div className="gov-form">
          <h3>Add an outgoing relationship</h3>
          <label className="gov-field" htmlFor="ws-rel-type">
            <span>Relationship type</span>
            <select id="ws-rel-type" value={relationship.type} onChange={(e) => setRelationship({ ...relationship, type: e.target.value })}>
              <option value="">Choose…</option>
              {RELATIONSHIP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {formatEnumLabel(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="gov-field" htmlFor="ws-rel-target">
            <span>Target Entity {relationship.target ? `(chosen: ${relationship.target.canonicalKey})` : ""}</span>
            <input id="ws-rel-target" type="search" value={targetSearch} onChange={(e) => setTargetSearch(e.target.value)} placeholder="Search by name or alias" autoComplete="off" />
          </label>
          {targetSearch.trim().length >= 2 && targetResults.length > 0 ? (
            <ul className="gov-list" aria-label="Target Entity results">
              {targetResults.map((t) => (
                <li key={t.entity.id}>
                  <button
                    type="button"
                    className="gov-button"
                    onClick={() => {
                      setRelationship({ ...relationship, target: t.entity });
                      setTargetSearch("");
                    }}
                  >
                    {t.latestRevision?.displayName ?? t.entity.canonicalKey} — <code>{t.entity.canonicalKey}</code>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <fieldset className="prowess-authoring__nested">
            <legend>Metadata</legend>
            <AuthoredDataEditor value={relationship.metadata} onChange={(metadata) => setRelationship({ ...relationship, metadata })} label="Relationship metadata" />
          </fieldset>
          <div className="gov-actions">
            <button
              type="button"
              className="gov-button"
              disabled={relationship.type === "" || relationship.target === null}
              onClick={async () => {
                setRelationshipError("");
                try {
                  await createRelationship({ sourceEntityId: entityId, targetEntityId: relationship.target!.id, relationshipType: relationship.type, metadata: relationship.metadata });
                  setRelationship({ type: "", target: null, metadata: {} });
                  await load();
                } catch (e) {
                  setRelationshipError(messageOf(e, "Could not add the relationship."));
                }
              }}
            >
              Add relationship
            </button>
          </div>
        </div>
        <ErrorLine error={relationshipError} />
      </section>
    </div>
  );
}
