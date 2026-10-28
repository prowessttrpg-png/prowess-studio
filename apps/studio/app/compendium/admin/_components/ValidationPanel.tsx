"use client";

import { forwardRef } from "react";
import type { ValidationIssueDto, ValidationResultDto } from "../_lib/authoring-client";
import { fieldDomId } from "../_lib/definition-form";
import type { FieldDescriptor } from "../_lib/descriptors";

/**
 * Accessible validation summary (PAS-10 M6-WO1 §15, §47). Shows the server's M5 validation RESULT as text (PASS / FAIL,
 * never colour alone), every issue with its code, field path, Definition kind and component, and a link that moves
 * focus to the field the issue belongs to. The heading is focusable so the editor can move focus here after a failed
 * validation. No stack trace or internal path is ever shown — only what the API returned.
 */
function anchorFor(issue: ValidationIssueDto, fields: readonly FieldDescriptor[]): string | null {
  const field = fields.find((f) => f.key === "" || issue.path === `payload.${f.key}` || issue.path.startsWith(`payload.${f.key}.`) || issue.path.startsWith(`payload.${f.key}[`));
  return field === undefined ? null : fieldDomId(field.key);
}

export const ValidationPanel = forwardRef<HTMLHeadingElement, { result: ValidationResultDto | null; stale: boolean; fields: readonly FieldDescriptor[] }>(function ValidationPanel({ result, stale, fields }, ref) {
  return (
    <section className="prowess-authoring__validation" aria-labelledby="definition-validation-heading">
      <h3 id="definition-validation-heading" ref={ref} tabIndex={-1}>
        Validation
      </h3>
      <div role="status" aria-live="polite">
        {result === null ? (
          <p className="gov-muted">Not validated yet. Validation runs the real M5 Definition contract on the server; it does not save anything.</p>
        ) : (
          <>
            <p className="prowess-authoring__verdict" data-status={result.status}>
              <strong>{result.status === "PASS" ? "PASS" : "FAIL"}</strong> — {result.definitionKind ?? "Unknown kind"}
              {result.status === "PASS" ? " satisfies its M5 structural contract." : ` has ${result.issues.filter((i) => i.severity === "ERROR").length} error(s).`}
              {result.refused ? " This content cannot be stored, even as a Draft." : ""}
              {stale ? " (The form changed after this result — validate again.)" : ""}
            </p>
            {result.issues.length > 0 ? (
              <ul className="prowess-authoring__issues">
                {result.issues.map((issue, n) => {
                  const anchor = anchorFor(issue, fields);
                  return (
                    <li key={n} data-severity={issue.severity}>
                      <strong>{issue.severity === "ERROR" ? "Error" : "Warning"}</strong> <code>{issue.code}</code>
                      {issue.path ? (
                        <>
                          {" "}
                          at{" "}
                          {anchor ? (
                            <a
                              href={`#${anchor}`}
                              data-skip-unsaved-guard
                              onClick={(e) => {
                                e.preventDefault();
                                const el = document.getElementById(anchor);
                                el?.focus();
                                if (typeof el?.scrollIntoView === "function") el.scrollIntoView({ block: "center" });
                              }}
                            >
                              <code>{issue.path}</code>
                            </a>
                          ) : (
                            <code>{issue.path}</code>
                          )}
                        </>
                      ) : null}
                      {issue.component ? <span className="gov-tag"> · component {issue.component}</span> : null}
                      {issue.definitionKind ? <span className="gov-tag"> · {issue.definitionKind}</span> : null}
                      <div>{issue.message}</div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
});
