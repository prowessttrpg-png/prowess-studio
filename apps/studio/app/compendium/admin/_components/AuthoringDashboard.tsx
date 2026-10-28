"use client";

import { ENTITY_TYPES } from "@prowess/model";
import { EmptyState, EntityTypeBadge, formatEnumLabel, Pagination, VersionStatusBadge } from "@prowess/ui";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AuthoringApiError, listDefinitions, type AuthoringListItemDto } from "../_lib/authoring-client";

/**
 * Compendium Admin dashboard (PAS-10 M6-WO1 §4, §60–61): authoring discovery over the existing Entity query. Each row
 * shows Display Name, Canonical Key, Entity Type, the Definition kind the latest revision declares (or "Generic /
 * non-Prowess Entity" — never inferred, §67), the Latest Revision number and lifecycle status, a cheap structural M5
 * check of that revision and its last update. "Latest Revision" is only the highest revision number: never labelled
 * Current / Active / Canon, and lifecycle status is not Ruleset publication authority.
 */
const PAGE_SIZE = 20;
const STATUS_TABS: ReadonlyArray<{ label: string; status: string }> = [
  { label: "All", status: "" },
  { label: "Drafts", status: "DRAFT" },
  { label: "In review", status: "IN_REVIEW" },
  { label: "Approved", status: "APPROVED" },
];

function validationLabel(v: AuthoringListItemDto["structuralValidation"]): string {
  if (v === "PASS") return "Structure valid";
  if (v === "FAIL") return "Needs attention";
  if (v === "NOT_A_DEFINITION") return "Not a Prowess Definition";
  return "No revisions";
}

export function AuthoringDashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const status = searchParams.get("status") ?? "";
  const entityType = searchParams.get("entityType") ?? "";
  const search = searchParams.get("search") ?? "";
  const attentionOnly = searchParams.get("attention") === "1";

  const [searchInput, setSearchInput] = useState(search);
  const [data, setData] = useState<{ items: AuthoringListItemDto[]; totalPages: number; total: number } | null>(null);
  const [error, setError] = useState("");

  const update = useCallback(
    (next: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === null || v === "") params.delete(k);
        else params.set(k, v);
      }
      if (!("page" in next)) params.delete("page");
      const q = params.toString();
      router.push(q === "" ? pathname : `${pathname}?${q}`);
    },
    [pathname, router, searchParams],
  );

  // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors the URL (back / forward) into the input, as /compendium does
  useEffect(() => setSearchInput(search), [search]);
  useEffect(() => {
    if (searchInput === search) return;
    const t = setTimeout(() => update({ search: searchInput }), 300);
    return () => clearTimeout(t);
  }, [searchInput]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset before fetching the page the URL now names
    setData(null);
    setError("");
    listDefinitions({ page, pageSize: PAGE_SIZE, search: search || undefined, status: status || undefined, entityType: entityType || undefined }).then(
      (r) => {
        if (!cancelled) setData({ items: r.items, totalPages: r.pagination.totalPages, total: r.pagination.total });
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof AuthoringApiError ? e.message : "Could not load Definitions.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [page, search, status, entityType]);

  const rows = data === null ? [] : attentionOnly ? data.items.filter((i) => i.structuralValidation === "FAIL") : data.items;

  return (
    <div className="prowess-authoring">
      <header className="prowess-compendium__header">
        <p className="gov-eyebrow">Compendium Admin — authoring workspace</p>
        <h1>Compendium Admin</h1>
        <p className="prowess-compendium__description">
          Create and edit Prowess Definitions as versioned Draft content, validate them against the real M5 contracts, and hand approved revisions to the Canon Manager. Saving content never publishes it: a published
          Ruleset Release is the only authority. &quot;Admin&quot; here is a designer-facing workspace, not an access-control system.
        </p>
        <div className="gov-actions">
          <Link className="gov-button gov-button--primary" href="/compendium/admin/new">
            New Definition
          </Link>
          <Link className="gov-button" href="/compendium">
            Browse the Compendium
          </Link>
        </div>
      </header>

      <nav aria-label="Lifecycle status filter" className="gov-tabs">
        <ul>
          {STATUS_TABS.map((t) => (
            <li key={t.label}>
              <a
                href={t.status ? `${pathname}?status=${t.status}` : pathname}
                aria-current={status === t.status ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  update({ status: t.status });
                }}
              >
                {t.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="gov-filters" role="search">
        <label className="gov-field" htmlFor="authoring-search">
          <span>Search name, alias</span>
          <input id="authoring-search" type="search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </label>
        <label className="gov-field" htmlFor="authoring-entity-type">
          <span>Entity Type</span>
          <select id="authoring-entity-type" value={entityType} onChange={(e) => update({ entityType: e.target.value })}>
            <option value="">All types</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {formatEnumLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="prowess-authoring__inline">
          <input type="checkbox" checked={attentionOnly} onChange={(e) => update({ attention: e.target.checked ? "1" : null, page: String(page) })} /> Only rows needing attention (this page)
        </label>
      </div>

      {error ? (
        <p className="gov-error" role="alert">
          {error}
        </p>
      ) : null}
      {data === null && error === "" ? <p role="status">Loading Definitions…</p> : null}
      {data !== null && rows.length === 0 ? <EmptyState title="No Definitions match" description="Create a Definition, or widen the filters." /> : null}
      {rows.length > 0 ? (
        <div className="lab-scroll">
          <table className="prowess-authoring__table" aria-label="Definitions">
            <thead>
              <tr>
                <th scope="col">Display Name</th>
                <th scope="col">Canonical Key</th>
                <th scope="col">Entity Type</th>
                <th scope="col">Definition Kind</th>
                <th scope="col">Latest Revision</th>
                <th scope="col">Lifecycle status</th>
                <th scope="col">Structure</th>
                <th scope="col">Last update</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.entity.id} data-testid="authoring-row">
                  <td>
                    <Link href={`/compendium/admin/entities/${item.entity.id}`}>{item.latestRevision?.displayName ?? item.entity.canonicalKey}</Link>
                  </td>
                  <td>
                    <code>{item.entity.canonicalKey}</code>
                  </td>
                  <td>
                    <EntityTypeBadge entityType={item.entity.entityType} />
                  </td>
                  <td>{item.definitionKind ?? <span className="gov-muted">Generic / non-Prowess Entity</span>}</td>
                  <td>{item.latestRevision ? `Revision ${item.latestRevision.revisionNumber}` : "No revisions"}</td>
                  <td>{item.latestRevision ? <VersionStatusBadge status={item.latestRevision.status} /> : "—"}</td>
                  <td data-validation={item.structuralValidation ?? "NONE"}>{validationLabel(item.structuralValidation)}</td>
                  <td>{item.latestRevision ? new Date(item.latestRevision.updatedAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {data !== null && data.totalPages > 1 ? <Pagination page={page} totalPages={data.totalPages} total={data.total} onPageChange={(p) => update({ page: String(p) })} /> : null}
    </div>
  );
}
