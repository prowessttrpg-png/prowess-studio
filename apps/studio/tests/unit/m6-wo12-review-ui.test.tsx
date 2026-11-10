import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PAS-10 M6-WO12 — the reviewer's revision approval on a Canon Manager ChangeSet (gap fix, invariant M6-I181). The
 * control reads the proposed revision fresh, offers "Approve revision rN" ONLY while it is IN_REVIEW, sends exactly one
 * lifecycle command (status APPROVED, through the existing M1 endpoint) after an explicit confirmation, and re-reads.
 * A Draft gets an explanation instead; a refusal is shown, never hidden.
 */
const api = vi.hoisted(() => ({ read: vi.fn(), approve: vi.fn() }));
vi.mock("../../src/api-client/review", () => ({ readRevisionForReview: api.read, approveReviewedRevision: api.approve }));
import { RevisionReview } from "../../app/developer/rulesets/_components/revision-review";

const version = (status: string) => ({ id: "11111111-1111-4111-8111-111111111111", entityId: "e", revisionNumber: 2, status, displayName: "Steady Ward Effect (playtest)" });

beforeAll(() => {
  // jsdom: a minimal <dialog> (the ConfirmButton primitive opens a modal dialog).
  const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  proto.close ??= function (this: HTMLDialogElement) { this.removeAttribute("open"); };
});
beforeEach(() => {
  api.read.mockReset();
  api.approve.mockReset();
});

describe("M6-WO12 reviewer approval of a ChangeSet's proposed revision", () => {
  it("W12-REVIEW an IN_REVIEW revision offers one confirmed approval, sends status APPROVED once and re-reads the revision", async () => {
    api.read.mockResolvedValueOnce(version("IN_REVIEW")).mockResolvedValueOnce(version("APPROVED"));
    api.approve.mockResolvedValue(version("APPROVED"));
    render(<RevisionReview versionId="11111111-1111-4111-8111-111111111111" />);
    const button = await screen.findByRole("button", { name: "Approve revision r2" });
    expect(screen.getByTestId("revision-review")).toHaveAttribute("data-status", "IN_REVIEW");
    fireEvent.click(button);
    expect(api.approve).not.toHaveBeenCalled(); // nothing is sent before the explicit confirmation
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm: Approve revision r2", hidden: true }));
    });
    await waitFor(() => expect(screen.getByTestId("revision-review")).toHaveAttribute("data-status", "APPROVED"));
    expect(api.approve).toHaveBeenCalledTimes(1);
    expect(api.approve).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    expect(api.read).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: /Approve revision/ })).toBeNull();
  });

  it("W12-REVIEW a Draft or an already approved revision offers no approval; a Draft says what to do instead", async () => {
    api.read.mockResolvedValue(version("DRAFT"));
    const { unmount } = render(<RevisionReview versionId="11111111-1111-4111-8111-111111111111" />);
    expect(await screen.findByText("Still a Draft — submit it for review in Compendium Admin first.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve revision/ })).toBeNull();
    unmount();
    api.read.mockResolvedValue(version("APPROVED"));
    render(<RevisionReview versionId="11111111-1111-4111-8111-111111111111" />);
    await waitFor(() => expect(screen.getByTestId("revision-review")).toHaveAttribute("data-status", "APPROVED"));
    expect(screen.queryByRole("button", { name: /Approve revision/ })).toBeNull();
    expect(api.approve).not.toHaveBeenCalled();
  });

  it("W12-REVIEW a refused approval is shown and the revision keeps its server status", async () => {
    api.read.mockResolvedValue(version("IN_REVIEW"));
    api.approve.mockRejectedValue(new Error("Invalid transition IN_REVIEW → APPROVED"));
    render(<RevisionReview versionId="11111111-1111-4111-8111-111111111111" />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve revision r2" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm: Approve revision r2", hidden: true }));
    });
    expect(await screen.findByText("Approval failed")).toBeInTheDocument();
    expect(screen.getByTestId("revision-review")).toHaveAttribute("data-status", "IN_REVIEW");
  });
});
