"use client";

import { useEffect, useState } from "react";
import { getCatalog, type AuthoringCatalogDto } from "../compendium/admin/_lib/authoring-client";
import { guidedEditorCoverage } from "./build-identity";

/** RULES-WO1: which rule kinds this build edits with a guided editor, from this build's own catalog and descriptors. */
export function EditorCoverage() {
  const [catalog, setCatalog] = useState<AuthoringCatalogDto | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    getCatalog().then(setCatalog, () => setFailed(true));
  }, []);
  if (failed) return <p className="gov-bad">The editor list could not be loaded.</p>;
  if (catalog === null) return <p role="status">Loading the editor list…</p>;
  const coverage = guidedEditorCoverage(catalog.kinds);
  return (
    <>
      <p data-testid="about-editor-counts">
        {coverage.guided.length} kinds of rule have a guided editor in this build; {coverage.technical.length} still use the technical editor.
      </p>
      <details data-testid="about-editors">
        <summary>Show the list</summary>
        <h3>Guided</h3>
        <ul>
          {coverage.guided.map((k) => (
            <li key={k} data-testid="about-guided-kind">
              {k}
            </li>
          ))}
        </ul>
        <h3>Technical editor only</h3>
        <ul>
          {coverage.technical.map((k) => (
            <li key={k} data-testid="about-technical-kind">
              {k}
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
