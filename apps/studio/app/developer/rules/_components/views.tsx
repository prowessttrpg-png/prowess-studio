"use client";

import { useState } from "react";
import type { CalculationTrace, EvaluationStepResult, ExplanationDocument, ExplanationNode, RuleEngineResponse, RuleMessage, TraceStep } from "@prowess/rules";
import type { JsonValue } from "@prowess/model";

export function Raw({ value, label = "Raw JSON" }: { value: unknown; label?: string }) {
  return <pre className="lab-json" aria-label={label}>{JSON.stringify(value, null, 2) ?? "Not supplied"}</pre>;
}
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rows = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(record) : [];
const text = (value: unknown): string => typeof value === "string" ? value : JSON.stringify(value) ?? "Not supplied";

function Fields({ data, fields }: { data: Record<string, unknown>; fields: readonly [string, string][] }) {
  return <dl className="lab-fields">{fields.filter(([key]) => key in data).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{typeof data[key] === "object" ? <Raw value={data[key]} label={label} /> : text(data[key])}</dd></div>)}</dl>;
}

export function Diagnostics({ response }: { response: Pick<RuleEngineResponse<unknown>, "errors" | "warnings" | "info"> }) {
  return <div className="lab-diagnostics">{(["errors", "warnings", "info"] as const).map(group => <section key={group}>
    <h4>{group.toUpperCase()} ({response[group].length})</h4>
    {response[group].map(message => <details key={message.ordinal} data-testid="lab-diagnostic"><summary>{message.severity} · {message.kind === "VALIDATION" ? message.category : "ENGINE"} · {message.code} · {message.path}</summary><p>{message.message}</p><Raw value={message} /></details>)}
  </section>)}</div>;
}

function RequirementTree({ value }: { value: unknown }) {
  const node = record(value);
  const [expanded, setExpanded] = useState(false);
  return <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary>{text(node.kind)} · {node.satisfied === true ? "SATISFIED" : "NOT SATISFIED"} · {text(node.nodePath)}</summary>
    {expanded && <><Raw value={{ ...node, children: undefined }} label="Requirement outcome" />
    {rows(node.children).map((child, index) => <RequirementTree key={index} value={child} />)}</>}
  </details>;
}

/** Subsystem-specific field presentation. All values come from the returned child response. */
export function StepOverview({ step }: { step: EvaluationStepResult }) {
  if (step.executionStatus === "BLOCKED") return <section><h3>BLOCKED</h3>{step.blockedBy.map((binding, index) => <div key={index}><p>{binding.reason}</p><Raw value={binding} /></div>)}</section>;
  const response = step.response;
  if (!response) return <p>No child response available.</p>;
  const data = record(response.data);
  return <section data-testid={`overview-${step.stepKey}`}>
    <h3>{step.operation}</h3><p>Child status: <strong>{response.status}</strong></p>
    {response.data === null && <p>No valid result data. The evaluation response and diagnostics remain available.</p>}
    {step.operation === "FORMULA" && <Fields data={data} fields={[["variables", "Bindings"], ["expressionValue", "Raw Result"], ["rounding", "Rounding"], ["minimum", "Minimum"], ["maximum", "Maximum"], ["finalValue", "Final Result"]]} />}
    {step.operation === "REQUIREMENT" && response.data !== null && <><h4>{data.satisfied === true ? "SATISFIED" : "NOT SATISFIED"}</h4><RequirementTree value={data.outcome} /></>}
    {step.operation === "KEYWORD" && <><h4>Exact keyword identities and contributors</h4>
      <div className="lab-scroll"><table><caption>Returned keyword set</caption><thead><tr><th>Canonical key</th><th>Keyword identity</th><th>Category identity</th><th>Contributors / provenance</th></tr></thead><tbody>{rows(data.keywords).map((item, index) => {
        const keyword = record(item.keyword);
        return <tr key={index}><td>{text(keyword.canonicalKey)}</td><td>{text(keyword.keywordId)}</td><td>{text(keyword.categoryId)}</td><td><Raw value={item.contributors} /></td></tr>;
      })}</tbody></table></div>
    </>}
    {step.operation === "MODIFIER" && <>
      <Fields data={data} fields={[["initialTargets", "Initial Targets"], ["finalTargets", "Final Targets"]]} />
      <div className="lab-scroll"><table><caption>Modifier application order</caption><thead><tr>{["Phase", "Key", "Status", "Before", "Operation", "Operand", "After", "Condition"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
        {rows(data.outcomes).map((outcome, index) => <tr key={index}>{[outcome.phase, outcome.modifierKey, outcome.status === "SKIPPED_CONDITION" ? "SKIPPED — SKIPPED_CONDITION" : outcome.status, outcome.before, outcome.operation, outcome.operand, outcome.after, outcome.condition].map((value, cell) => <td key={cell}>{text(value)}</td>)}</tr>)}
      </tbody></table></div><details><summary>Modifier provenance and full outcomes</summary><Raw value={data.outcomes} /></details>
    </>}
    {step.operation.startsWith("RESOURCE_PAYMENT_") && response.data !== null && <>
      <section className="lab-value" data-testid="listed-value"><h4>LISTED VALUE</h4><strong>{text(data.listedAmount)}</strong></section>
      <h4>THIS PAYMENT / PAYMENT ALLOCATION</h4>
      <p>{data.canPay === true ? "Payment available" : "Payment unavailable — State unchanged"}</p><p>Shortfall {text(data.shortfall)}</p>
      <div className="lab-scroll"><table data-testid="payment-allocation"><caption>{text(data.mode)} allocation — projected values</caption><thead><tr><th>Source</th><th>Before</th><th>Paid</th><th>Projected After</th></tr></thead><tbody>
        {rows(data.allocations).map((allocation, index) => <tr key={index}><td>{text(allocation.resourceKey)}</td><td>{text(allocation.currentBefore)}</td><td>{text(allocation.amountPaid)}</td><td>{text(allocation.currentAfter)}</td></tr>)}
      </tbody></table></div>
      <div className="lab-scroll"><table data-testid="resulting-resources"><caption>Resulting resource state</caption><thead><tr><th>Source</th><th>Remaining</th></tr></thead><tbody>{rows(record(data.resultingResources).resources).map(resource => <tr key={text(resource.resourceKey)}><td>{text(resource.resourceKey)}</td><td>{text(resource.current)}</td></tr>)}</tbody></table></div>
    </>}
    {step.operation.startsWith("RESOURCE_") && !step.operation.startsWith("RESOURCE_PAYMENT_") && <>
      <h4>{step.operation === "RESOURCE_RESERVE_CAPACITY" ? "Capacity Reserved" : step.operation === "RESOURCE_RELEASE_CAPACITY" ? "Capacity Released" : "Resource transition"}</h4>
      <Fields data={data} fields={[["transition", "Operation"], ["applied", "Applied"], ["requestedAmount", "Requested Amount"], ["actualAmount", "Actual Amount"], ["shortfall", "Shortfall"], ["before", "State Before"], ["after", "State After"], ["availableMaximumBefore", "Available Maximum Before"], ["availableMaximumAfter", "Available Maximum After"]]} />
    </>}
    {step.operation === "VALIDATION" && <Fields data={data} fields={[["checks", "Explicit Checks"], ["errorCount", "Error Count"], ["warningCount", "Warning Count"], ["infoCount", "Info Count"], ["checkCounts", "Explicit Check Counts"], ["categoryCounts", "Category Counts"], ["sources", "Sources"]]} />}
    {(step.operation === "EXPLANATION" || step.operation === "EXPLANATION_PROJECT") && response.data !== null && <ExplanationView document={response.data as unknown as ExplanationDocument} />}
    <Diagnostics response={response} />
  </section>;
}

function TraceBranch({ node, focus, stepKey }: { node: TraceStep; focus: string | null; stepKey: string }) {
  const [expanded, setExpanded] = useState(false);
  const focused = focus === node.path;
  const ancestor = focus !== null && focus.startsWith(`${node.path}.`);
  const open = expanded || focused || ancestor;
  return <li id={`trace-${encodeURIComponent(stepKey)}-${node.path}`} data-focused={focused} className="lab-trace-node">
    <button type="button" aria-expanded={open} onClick={() => setExpanded(!expanded)}>{open ? "▾" : "▸"} {node.path} · #{node.ordinal} · {node.key} · {node.operation}</button>
    {open && <><Fields data={node as unknown as Record<string, unknown>} fields={[["phase", "Phase"], ["inputs", "Resolved Inputs"], ["output", "Output"], ["explanation", "Explanation"], ["provenance", "Rule Provenance"], ["modifierSource", "Modifier Source"]]} />
      <ul>{node.children.map(child => <TraceBranch key={child.path} node={child} focus={focus} stepKey={stepKey} />)}</ul>
    </>}
  </li>;
}
export function TraceView({ trace, focus = null, stepKey = "run" }: { trace: CalculationTrace | null; focus?: string | null; stepKey?: string }) {
  if (!trace || trace.steps.length === 0) return <p>No trace available.</p>;
  return <section aria-label="Calculation Trace"><p>{trace.stepCount} trace nodes; branches expand on demand.</p><ul className="lab-tree">{trace.steps.map(node => <TraceBranch key={node.path} node={node} focus={focus} stepKey={stepKey} />)}</ul></section>;
}

type TraceLink = (contributionKey: string, path: string) => void;
function ExplanationBranch({ node, onTrace }: { node: ExplanationNode; onTrace?: TraceLink }) {
  const [expanded, setExpanded] = useState(false);
  return <li><button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "▾" : "▸"} {node.label ?? node.key} · {node.status ?? node.operation}</button>
    {onTrace && <button type="button" onClick={() => onTrace(node.sourceContributionKey, node.sourceTracePath)}>Trace {node.sourceContributionKey} / {node.sourceTracePath}</button>}
    {expanded && <><Raw value={{ ...node, children: undefined }} label="Explanation node" /><p>{node.omittedChildCount} children omitted by server projection</p><ul>{node.children.map(child => <ExplanationBranch key={child.nodeId} node={child} onTrace={onTrace} />)}</ul></>}
  </li>;
}
function diagnosticNode(nodes: readonly ExplanationNode[], message: RuleMessage): ExplanationNode | undefined {
  const stack = [...nodes].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    if (node.relatedDiagnosticOrdinals.includes(message.ordinal)) return node;
    stack.push(...[...node.children].reverse());
  }
  return undefined;
}
export function ExplanationView({ document, onTrace }: { document: ExplanationDocument; onTrace?: TraceLink }) {
  return <section aria-label={`${document.level} explanation`}>
    <h4>{document.level} · {document.title ?? document.explanationKey}</h4><Raw value={document.summary} label="Returned explanation summary counts" />
    {document.sections.map(section => <section className="lab-card" key={section.sectionKey} data-testid={`explanation-${section.sectionKey}`}>
      <h5>{section.label ?? section.sectionKey} · {section.statusLabel}</h5>
      <dl className="lab-fields">{section.facts.map(fact => <div key={fact.factKey}><dt>{fact.label}</dt><dd>{text(fact.value)}</dd></div>)}</dl>
      <ul className="lab-tree">{section.nodes.map(node => <ExplanationBranch key={node.nodeId} node={node} onTrace={onTrace} />)}</ul>
      {section.diagnostics.map(message => <details key={message.ordinal}><summary>{message.severity} · {message.code} · {message.path}</summary><Raw value={message} />{onTrace && <button type="button" onClick={() => { const node = diagnosticNode(section.nodes, message); if (node) onTrace(node.sourceContributionKey, node.sourceTracePath); }}>Focus related trace if available</button>}</details>)}
      <details><summary>Exact section provenance</summary><Raw value={{ rule: section.provenance, ruleset: section.ruleset }} /></details>
    </section>)}
  </section>;
}

export function ChildOutput({ response }: { response: RuleEngineResponse<JsonValue> | null }) {
  return response ? <Raw value={response} label="Exact child RuleEngineResponse" /> : <p>No response: this step did not execute.</p>;
}
