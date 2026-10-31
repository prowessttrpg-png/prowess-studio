"use client";

import type { ReactNode } from "react";
import { groupsOf, presentationDescriptorFor, type ContractDescriptor, type FieldDescriptor } from "../../admin/_lib/descriptors";
import type { EntryDetailDto } from "../_lib/reference-client";
import { StructuredValue, TokenText, type StructuredContext } from "./StructuredValue";

/**
 * Mechanical Data presenter (PAS-10 M6-WO2). Dedicated presentation reuses the WO1 authoring DESCRIPTORS (keyed by the
 * M5 shared contract — Targeting, Effect, Trait, Duration, Ability Condition, Foundation — plus Affinity), so there is
 * no second catalog: one description of each contract labels both the editor and this read-only view. Everything else
 * — kinds without a dedicated descriptor, schema versions the catalog does not support, generic content — is presented
 * generically and labelled as such. Values are shown exactly as stored: no cost is computed, no formula evaluated, no
 * conflict resolved, nothing migrated.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function FieldValue({ field, payload, context, keywordName }: { field: FieldDescriptor; payload: Record<string, unknown>; context: StructuredContext; keywordName: (key: string) => string | null }) {
  const value = field.key === "" ? payload : payload[field.key];
  const path = field.key === "" ? "payload" : `payload.${field.key}`;
  switch (field.input) {
    case "select":
    case "token":
      return typeof value === "string" && value !== "" ? <TokenText value={value} /> : <span className="gov-muted">—</span>;
    case "keywords":
      return Array.isArray(value) && value.length > 0 ? (
        <ul className="prowess-reference__chips" aria-label={field.label}>
          {value.map((k) => (
            <li key={String(k)} className="prowess-keyword-chip">
              {keywordName(String(k)) ?? String(k)} <code>{String(k)}</code>
            </li>
          ))}
        </ul>
      ) : (
        <span className="gov-muted">none</span>
      );
    case "compatibility":
      return Array.isArray(value) && value.length > 0 ? (
        <ul className="prowess-reference__list">
          {value.map((rule, i) =>
            isRecord(rule) ? (
              <li key={i}>
                <TokenText value={String(rule.relation ?? "")} />: <StructuredValue value={rule.allow} path={`${path}[${i}].allow`} context={context} />
              </li>
            ) : null,
          )}
        </ul>
      ) : (
        <span className="gov-muted">none</span>
      );
    case "costContributions":
      return (
        <div>
          {Array.isArray(value) && value.length > 0 ? (
            <table className="prowess-reference__table">
              <caption className="gov-muted">Authored cost data, exactly as stored. The final cost is computed by the Rules Engine — never on this page.</caption>
              <thead>
                <tr>
                  <th scope="col">Contribution</th>
                  <th scope="col">Currency</th>
                  <th scope="col">Authored data</th>
                </tr>
              </thead>
              <tbody>
                {value.map((c, i) =>
                  isRecord(c) ? (
                    <tr key={i}>
                      <td>
                        <code>{String(c.contributionKey ?? "")}</code>
                      </td>
                      <td>
                        <TokenText value={String(c.currency ?? "")} />
                      </td>
                      <td>
                        <StructuredValue value={c.data} path={`${path}[${i}].data`} context={context} />
                      </td>
                    </tr>
                  ) : null,
                )}
              </tbody>
            </table>
          ) : (
            <span className="gov-muted">No authored cost contributions.</span>
          )}
        </div>
      );
    case "outcomes":
      return Array.isArray(value) && value.length > 0 ? (
        <ul className="prowess-reference__list">
          {value.map((o, i) =>
            isRecord(o) ? (
              <li key={i}>
                <strong>
                  <code>{String(o.outcomeKey ?? "")}</code>
                </strong>
                <StructuredValue value={o.data} path={`${path}[${i}].data`} context={context} />
              </li>
            ) : null,
          )}
        </ul>
      ) : (
        <span className="gov-muted">none</span>
      );
    case "resolution":
      return isRecord(value) ? (
        <div>
          <TokenText value={String(value.mode ?? "")} />
          <StructuredValue value={value.data} path={`${path}.data`} context={context} />
        </div>
      ) : (
        <span className="gov-muted">No resolution of its own (as authored).</span>
      );
    case "restriction":
      return isRecord(value) ? (
        <div>
          <TokenText value={String(value.restrictionKey ?? "")} />
          <StructuredValue value={value.data} path={`${path}.data`} context={context} />
        </div>
      ) : (
        <span className="gov-muted">—</span>
      );
    // M6-WO3 character-facing fields (§51): shown exactly as authored, labelled for readers. Skill options are exact
    // references, rendered as exact-Release links by the StructuredValue reference renderer.
    case "integer":
      return typeof value === "number" ? <span data-field={field.key}>{value}</span> : <span className="gov-muted">—</span>;
    case "statGrants":
      return Array.isArray(value) && value.length > 0 ? (
        <ul className="prowess-reference__list" aria-label={field.label}>
          {value.map((g, i) =>
            isRecord(g) ? (
              <li key={i} data-testid="reference-stat-grant">
                <code>{String(g.grantKey ?? "")}</code>{" "}
                {g.kind === "FIXED" ? (
                  <>
                    +{String(g.amount ?? "")} <TokenText value={String(g.stat ?? "")} /> (fixed)
                  </>
                ) : (
                  <>
                    +{String(g.amount ?? "")} to {String(g.count ?? "")} different Stats, chosen from{" "}
                    {Array.isArray(g.allowedStats) ? g.allowedStats.map(String).join(", ") : "—"}
                  </>
                )}
              </li>
            ) : null,
          )}
        </ul>
      ) : (
        <span className="gov-muted">none</span>
      );
    case "skillGrants":
      return Array.isArray(value) && value.length > 0 ? (
        <ul className="prowess-reference__list" aria-label={field.label}>
          {value.map((g, i) =>
            isRecord(g) ? (
              <li key={i} data-testid="reference-skill-grant">
                <code>{String(g.grantKey ?? "")}</code> <TokenText value={String(g.selectionKind ?? "")} />
                {g.selectionKind === "CHOOSE_ANY" ? ` — any ${String(g.count ?? "")} published Skill(s)` : g.selectionKind === "CHOOSE_FROM" ? ` — choose ${String(g.count ?? "")} of:` : " —"}{" "}
                rank <TokenText value={String(g.rankKey ?? "")} />
                {Array.isArray(g.options) && g.options.length > 0 ? <StructuredValue value={g.options} path={`${path}[${i}].options`} context={context} /> : null}
              </li>
            ) : null,
          )}
        </ul>
      ) : (
        <span className="gov-muted">none</span>
      );
    case "advancementLevels":
      return Array.isArray(value) && value.length > 0 ? (
        <table className="prowess-reference__table" aria-label={field.label} data-testid="reference-advancement-levels">
          <thead>
            <tr>
              <th scope="col">Level</th>
              <th scope="col">Stat Points</th>
              <th scope="col">Skill advancements</th>
            </tr>
          </thead>
          <tbody>
            {value.map((row, i) =>
              isRecord(row) ? (
                <tr key={i}>
                  <th scope="row">{String(row.level ?? "")}</th>
                  <td>{String(row.statPoints ?? "")}</td>
                  <td>{String(row.skillAdvancements ?? "")}</td>
                </tr>
              ) : null,
            )}
          </tbody>
        </table>
      ) : (
        <span className="gov-muted">none</span>
      );
    case "authoredData":
    case "source":
      return <StructuredValue value={value} path={path} context={context} />;
  }
}

function Dedicated({ descriptor, payload, context, keywordName }: { descriptor: ContractDescriptor; payload: Record<string, unknown>; context: StructuredContext; keywordName: (key: string) => string | null }) {
  const known = new Set(descriptor.fields.map((f) => f.key));
  const extra = Object.entries(payload).filter(([k]) => !known.has(k));
  return (
    <div data-testid="reference-presenter" data-presenter="dedicated">
      <p className="prowess-authoring__purpose">{descriptor.purpose}</p>
      {groupsOf(descriptor).map((group) => (
        <section key={group} className="prowess-authoring__group" aria-label={group}>
          <h4>{group}</h4>
          <dl className="gov-dl">
            {descriptor.fields
              .filter((f) => f.group === group)
              .map((f) => (
                <div key={f.key} className="prowess-reference__field">
                  <dt>{f.label}</dt>
                  <dd>
                    <FieldValue field={f} payload={payload} context={context} keywordName={keywordName} />
                  </dd>
                </div>
              ))}
          </dl>
        </section>
      ))}
      {extra.length > 0 ? (
        <section className="prowess-authoring__group" aria-label="Other authored fields">
          <h4>Other authored fields</h4>
          <StructuredValue value={Object.fromEntries(extra)} context={context} />
        </section>
      ) : null}
    </div>
  );
}

export function DefinitionPresenter({ detail, renderReference }: { detail: EntryDetailDto; renderReference: (path: string) => ReactNode | null }) {
  const context: StructuredContext = { renderReference };
  const names = new Map(detail.keywords.structured.map((k) => [k.canonicalKey, k.keyword?.name ?? null] as const));
  const keywordName = (key: string) => names.get(key) ?? null;
  const definition = detail.definition;
  let body: ReactNode;
  if (definition === null) {
    const data = detail.pinnedRevision.structuredData;
    body = (
      <div data-testid="reference-presenter" data-presenter="generic">
        <p className="gov-muted">Generic / non-Prowess Entity — this revision stores no Prowess Definition, so no Definition kind is shown or inferred.</p>
        {isRecord(data) && Object.keys(data).length > 0 ? <StructuredValue value={data} path="structuredData" context={context} /> : <p className="gov-muted">No structured data.</p>}
      </div>
    );
  } else {
    const descriptor = detail.kind === null ? null : presentationDescriptorFor(detail.kind, definition.schemaVersion);
    const payload = definition.payload ?? {};
    if (descriptor !== null) {
      body = <Dedicated descriptor={descriptor} payload={payload} context={context} keywordName={keywordName} />;
    } else {
      const reason =
        detail.kind === null
          ? `The declared kind ${definition.definitionKind ?? "(none)"} is not in the Definition catalog.`
          : !detail.schemaVersionSupported
            ? `Schema version ${definition.schemaVersion ?? "(none)"} is not a version the catalog supports for ${detail.kind.definitionKind}; it is shown exactly as stored and never migrated on view.`
            : `${detail.kind.definitionKind} has no dedicated presentation yet.`;
      body = (
        <div data-testid="reference-presenter" data-presenter="generic">
          <p className="gov-muted">{reason} Generic presentation of the stored payload:</p>
          <StructuredValue value={payload} context={context} />
        </div>
      );
    }
  }
  return (
    <section className="gov-panel prowess-reference__mechanics" aria-labelledby="ref-mechanics">
      <h2 id="ref-mechanics">Mechanical Data</h2>
      {definition !== null ? (
        <p className="gov-meta">
          <span className="gov-tag">Schema version {definition.schemaVersion ?? "—"}</span>
          {definition.systemFamily ? <span className="gov-tag">Declared family: {definition.systemFamily}</span> : null}
        </p>
      ) : null}
      {body}
      {definition !== null && Array.isArray(definition.legacyTerms) && definition.legacyTerms.length > 0 ? (
        <section aria-label="Legacy terminology">
          <h4>Legacy terminology (provenance)</h4>
          <StructuredValue value={definition.legacyTerms} path="legacyTerms" />
        </section>
      ) : null}
      <details className="prowess-reference__developer">
        <summary>Developer details — stored structured data (raw JSON)</summary>
        <pre>{JSON.stringify(detail.pinnedRevision.structuredData, null, 2)}</pre>
      </details>
    </section>
  );
}
