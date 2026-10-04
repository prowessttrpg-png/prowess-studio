import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  EmptyState,
  EntityTypeBadge,
  formatEnumLabel,
  InspectorPanel,
  KeywordChip,
  NavLink,
  NavToggle,
  Pagination,
  ProwessBrand,
  TopBarAccount,
  TopBarCreateButton,
  TopBarRulesetSelector,
  TopBarSearch,
  VersionStatusBadge,
} from "./index.js";

describe("@prowess/ui primitives", () => {
  it("renders the Prowess wordmark", () => {
    render(<ProwessBrand />);
    expect(screen.getByTestId("prowess-brand")).toHaveTextContent("PROWESS STUDIO");
  });

  it("renders a NavLink with its label by default", () => {
    render(<NavLink href="/compendium" label="Compendium" />);
    expect(screen.getByTestId("nav-link-compendium")).toHaveTextContent("Compendium");
  });

  describe("top bar placeholders", () => {
    it("renders the Global Search placeholder with its shortcut hint", () => {
      render(<TopBarSearch />);
      expect(screen.getByTestId("topbar-search")).toHaveTextContent("Search Prowess...");
      expect(screen.getByTestId("topbar-search")).toHaveTextContent("Ctrl/Cmd+K");
    });

    it("renders the Ruleset selector placeholder as a disabled control", () => {
      render(<TopBarRulesetSelector />);
      const button = screen.getByTestId("topbar-ruleset");
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent("Core Playtest");
      expect(button).toHaveAccessibleName();
    });

    it("renders the Create placeholder as a disabled control with an accessible name", () => {
      render(<TopBarCreateButton />);
      const button = screen.getByTestId("topbar-create");
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleName();
    });

    it("renders the Account placeholder as a disabled control with an accessible name", () => {
      render(<TopBarAccount />);
      const button = screen.getByTestId("topbar-account");
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleName();
    });
  });

  describe("NavToggle", () => {
    it("reflects open state via aria-expanded and names its target via aria-controls", () => {
      const onClick = vi.fn();
      const { rerender } = render(
        <NavToggle open={false} controls="prowess-primary-nav" onClick={onClick} />,
      );
      const button = screen.getByTestId("nav-toggle");
      expect(button).toHaveAttribute("aria-expanded", "false");
      expect(button).toHaveAttribute("aria-controls", "prowess-primary-nav");
      expect(button).toHaveAccessibleName();

      rerender(<NavToggle open={true} controls="prowess-primary-nav" onClick={onClick} />);
      expect(screen.getByTestId("nav-toggle")).toHaveAttribute("aria-expanded", "true");
    });

    it("calls onClick when activated", () => {
      const onClick = vi.fn();
      render(<NavToggle open={false} controls="prowess-primary-nav" onClick={onClick} />);
      screen.getByTestId("nav-toggle").click();
      expect(onClick).toHaveBeenCalledOnce();
    });
  });

  describe("InspectorPanel", () => {
    it("is hidden and empty by default", () => {
      render(<InspectorPanel>Some future inspector content</InspectorPanel>);
      const panel = screen.getByTestId("inspector-panel");
      expect(panel).toHaveAttribute("hidden");
      expect(panel).not.toHaveTextContent("Some future inspector content");
    });

    it("renders its content only when explicitly opened", () => {
      render(<InspectorPanel open>Some future inspector content</InspectorPanel>);
      const panel = screen.getByTestId("inspector-panel");
      expect(panel).not.toHaveAttribute("hidden");
      expect(panel).toHaveTextContent("Some future inspector content");
    });
  });

  describe("formatEnumLabel", () => {
    it("converts SCREAMING_SNAKE_CASE to a readable label", () => {
      expect(formatEnumLabel("SPELL_EFFECT")).toBe("Spell Effect");
      expect(formatEnumLabel("DRAFT")).toBe("Draft");
      expect(formatEnumLabel("IN_REVIEW")).toBe("In Review");
    });
  });

  describe("EntityTypeBadge", () => {
    it("renders the formatted entity type as visible text, not a color-only indicator", () => {
      render(<EntityTypeBadge entityType="SPELL_EFFECT" />);
      expect(screen.getByTestId("entity-type-badge")).toHaveTextContent("Spell Effect");
    });
  });

  describe("VersionStatusBadge", () => {
    it("renders the formatted status as visible text", () => {
      render(<VersionStatusBadge status="IN_REVIEW" />);
      expect(screen.getByTestId("version-status-badge")).toHaveTextContent("In Review");
    });

    it("applies a status-specific tone class without removing the text label", () => {
      render(<VersionStatusBadge status="CANON" />);
      const badge = screen.getByTestId("version-status-badge");
      expect(badge.className).toContain("prowess-badge--status-canon");
      expect(badge).toHaveTextContent("Canon");
    });
  });

  describe("KeywordChip", () => {
    it("renders the Keyword name and exposes the canonical key as a tooltip", () => {
      render(<KeywordChip name="Fire" canonicalKey="test.keyword.fire" />);
      const chip = screen.getByTestId("keyword-chip");
      expect(chip).toHaveTextContent("Fire");
      expect(chip).toHaveAttribute("title", "test.keyword.fire");
    });
  });

  describe("EmptyState", () => {
    it("renders a title and optional description with status role", () => {
      render(<EmptyState title="No Entities exist" description="Create one to get started." />);
      const state = screen.getByTestId("empty-state");
      expect(state).toHaveAttribute("role", "status");
      expect(state).toHaveTextContent("No Entities exist");
      expect(state).toHaveTextContent("Create one to get started.");
    });

    it("renders without a description when none is given", () => {
      render(<EmptyState title="No Entities match these filters" />);
      expect(screen.getByTestId("empty-state")).toHaveTextContent("No Entities match these filters");
    });
  });

  describe("Pagination", () => {
    it("renders Previous/Next controls with accessible names and a page/result status", () => {
      const onPageChange = vi.fn();
      render(<Pagination page={2} totalPages={5} total={123} onPageChange={onPageChange} />);

      expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();
      expect(screen.getByTestId("pagination")).toHaveTextContent("Page 2 of 5");
      expect(screen.getByTestId("pagination")).toHaveTextContent("123 results");
    });

    it("disables Previous on the first page and Next on the last page", () => {
      const onPageChange = vi.fn();
      const { rerender } = render(
        <Pagination page={1} totalPages={3} total={30} onPageChange={onPageChange} />,
      );
      expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();

      rerender(<Pagination page={3} totalPages={3} total={30} onPageChange={onPageChange} />);
      expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    });

    it("calls onPageChange with the correct target page", () => {
      const onPageChange = vi.fn();
      render(<Pagination page={2} totalPages={5} total={100} onPageChange={onPageChange} />);

      fireEvent.click(screen.getByRole("button", { name: "Next page" }));
      expect(onPageChange).toHaveBeenCalledWith(3);

      fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
      expect(onPageChange).toHaveBeenCalledWith(1);
    });

    it("renders only a result count, no Previous/Next, when there's a single page", () => {
      const onPageChange = vi.fn();
      render(<Pagination page={1} totalPages={1} total={3} onPageChange={onPageChange} />);
      expect(screen.queryByRole("button", { name: "Previous page" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();
      expect(screen.getByTestId("pagination")).toHaveTextContent("3 results");
    });
  });
});
