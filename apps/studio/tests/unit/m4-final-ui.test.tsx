import { fireEvent, render, screen } from "@testing-library/react";
import { buildExplanation, buildTrace, evaluateFormula } from "@prowess/rules";
import { describe, expect, it } from "vitest";
import { ExplanationView, TraceView } from "../../app/developer/rules/_components/views";

/** M4-I178/I179/I187: large server trace and explanation remain lazy. Real WO9 contract, no local projection. */
describe("WO12 large trace / explanation presentation sanity", () => {
  it("renders 1001 nodes with only roots initially mounted, expanding branches on demand", () => {
    const trace = buildTrace([{key: "root", operation: "audit", children: Array.from({length: 500}, (_, i) => ({key: `branch${i}`, operation: "audit", children: [{key: "leaf", operation: "audit"}]}))}]);
    expect(trace.stepCount).toBe(1001);
    const view = render(<TraceView trace={trace} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getAllByRole("button")).toHaveLength(501);
    expect(screen.queryByRole("button", {name: /leaf/})).not.toBeInTheDocument();
    view.unmount();
    const source = evaluateFormula({expression: "17"}, {});
    const detailed = buildExplanation({explanationKey: "large", contributions: [{contributionKey: "formula", order: 1, kind: "FORMULA", response: {...source, trace}}]});
    expect(detailed.success).toBe(true);
    render(<ExplanationView document={detailed.data!} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByLabelText("Explanation node")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getAllByRole("button")).toHaveLength(501);
  });
});
