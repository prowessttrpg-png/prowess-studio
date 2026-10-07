"use client";

import { RULESET_CHANNELS, RULESET_STATUSES } from "@prowess/model";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createRuleset, GovernanceApiError, listRulesets } from "../../../src/api-client";
import { Crumbs, EmptyNote, ErrorPanel, Field, Resource, StatusBadge, useResource } from "./_components/primitives";

/**
 * /developer/rulesets — the Ruleset / Canon governance entry point (PAS-10 M2-WO10 §7, §8). Canon Manager
 * IS this workspace (there is no second copy of it). Everything goes through the M2 HTTP API.
 */
export default function RulesetsPage() {
  const router = useRouter();
  const [filters, setFilters] = useState({ status: "", channel: "" });
  const list = useResource(() => listRulesets({ status: filters.status || undefined, channel: filters.channel || undefined }), [filters.status, filters.channel]);
  const all = useResource(() => listRulesets(), []);
  const names = new Map((all.data?.items ?? []).map((r) => [r.id, r.name]));
  const [form, setForm] = useState({ canonicalKey: "", name: "", description: "", channel: "DEVELOPMENT", versionLabel: "", parentRulesetId: "" });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fieldError = (f: string) => (error instanceof GovernanceApiError && error.field === f ? error.message : null);

  return (
    <section className="gov-page">
      <Crumbs items={[{ label: "Developer", href: "/developer" }, { label: "Rulesets" }]} />
      <h1>Rulesets</h1>
      <p className="gov-muted">
        Ruleset and Canon governance: manifests, Canon policies, rule conflicts, decisions, ChangeSets and immutable releases. This workspace is
        the Canon Manager.
      </p>

      <div className="gov-filters" role="group" aria-label="Filter Rulesets">
        <Field label="Status" htmlFor="filter-status">
          <select id="filter-status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">Any status</option>
            {RULESET_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Channel" htmlFor="filter-channel">
          <select id="filter-channel" value={filters.channel} onChange={(e) => setFilters({ ...filters, channel: e.target.value })}>
            <option value="">Any channel</option>
            {RULESET_CHANNELS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>

      <Resource state={list}>
        {({ items }) =>
          items.length === 0 ? (
            <EmptyNote title="No Rulesets match.">Create one below.</EmptyNote>
          ) : (
            <ul className="gov-list" aria-label="Rulesets">
              {items.map((r) => (
                <li key={r.id} className="gov-card">
                  <h2 className="gov-card__title">
                    <Link href={`/developer/rulesets/${r.id}`}>{r.name}</Link>
                  </h2>
                  <p className="gov-meta">
                    <StatusBadge value={r.status} kind="ruleset-status" /> <StatusBadge value={r.channel} kind="channel" /> <code>{r.canonicalKey}</code>
                    {r.versionLabel ? <span> · {r.versionLabel}</span> : null}
                    {r.parentRulesetId ? <span> · Parent: {names.get(r.parentRulesetId) ?? r.parentRulesetId}</span> : null}
                  </p>
                </li>
              ))}
            </ul>
          )
        }
      </Resource>

      <form
        className="gov-form"
        aria-labelledby="create-ruleset-heading"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const created = await createRuleset({
              canonicalKey: form.canonicalKey.trim(),
              name: form.name.trim(),
              description: form.description.trim() || null,
              channel: form.channel,
              versionLabel: form.versionLabel.trim() || null,
              parentRulesetId: form.parentRulesetId || null,
            });
            router.push(`/developer/rulesets/${created.id}`);
          } catch (err) {
            setError(err);
            setBusy(false);
          }
        }}
      >
        <h2 id="create-ruleset-heading">Create Ruleset</h2>
        <p className="gov-muted">New Rulesets start as DRAFT.</p>
        <Field label="Canonical key" htmlFor="rs-key" error={fieldError("canonicalKey")}>
          <input id="rs-key" required value={form.canonicalKey} onChange={(e) => setForm({ ...form, canonicalKey: e.target.value })} placeholder="ruleset.core_playtest" />
        </Field>
        <Field label="Name" htmlFor="rs-name" error={fieldError("name")}>
          <input id="rs-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Description" htmlFor="rs-description">
          <textarea id="rs-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="Channel" htmlFor="rs-channel">
          <select id="rs-channel" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
            {RULESET_CHANNELS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Version label (optional)" htmlFor="rs-version">
          <input id="rs-version" value={form.versionLabel} onChange={(e) => setForm({ ...form, versionLabel: e.target.value })} />
        </Field>
        <Field label="Parent Ruleset (optional)" htmlFor="rs-parent">
          <select id="rs-parent" value={form.parentRulesetId} onChange={(e) => setForm({ ...form, parentRulesetId: e.target.value })}>
            <option value="">No parent</option>
            {(all.data?.items ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        {error ? <ErrorPanel error={error} title="Could not create the Ruleset" /> : null}
        <button type="submit" className="gov-button gov-button--primary" disabled={busy}>
          Create Ruleset
        </button>
      </form>
    </section>
  );
}
