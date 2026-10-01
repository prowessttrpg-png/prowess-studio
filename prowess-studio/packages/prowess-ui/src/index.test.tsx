import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  InspectorPanel,
  NavLink,
  NavToggle,
  ProwessBrand,
  TopBarAccount,
  TopBarCreateButton,
  TopBarRulesetSelector,
  TopBarSearch,
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
});
