import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NavLink, ProwessBrand } from "./index.js";

describe("@prowess/ui primitives", () => {
  it("renders the Prowess wordmark", () => {
    render(<ProwessBrand />);
    expect(screen.getByTestId("prowess-brand")).toHaveTextContent("PROWESS STUDIO");
  });

  it("renders a NavLink with its label by default", () => {
    render(<NavLink href="/compendium" label="Compendium" />);
    expect(screen.getByTestId("nav-link-compendium")).toHaveTextContent("Compendium");
  });
});
