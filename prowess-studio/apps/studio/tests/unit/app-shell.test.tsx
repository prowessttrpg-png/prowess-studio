import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "../../app/components/AppShell";

let mockPathname = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

vi.mock("next/link", () => ({
  // A minimal stand-in sufficient for rendering/assertions — real
  // navigation behavior is covered by the Playwright e2e suite, which runs
  // against an actual Next.js server.
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("AppShell", () => {
  it("renders the brand and all eight primary navigation entries", () => {
    mockPathname = "/";
    render(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );

    expect(screen.getByTestId("prowess-brand")).toBeInTheDocument();
    for (const label of [
      "Dashboard",
      "Compendium",
      "Studio",
      "Characters",
      "World",
      "GM",
      "Publishing",
      "Developer",
    ]) {
      expect(screen.getByTestId(`nav-link-${label.toLowerCase()}`)).toBeInTheDocument();
    }
  });

  it("renders page content inside the shared shell's workspace", () => {
    mockPathname = "/";
    render(
      <AppShell>
        <p>Distinctive page content</p>
      </AppShell>,
    );
    expect(screen.getByText("Distinctive page content")).toBeInTheDocument();
  });

  it("marks the Compendium link as the active section when on /compendium", () => {
    mockPathname = "/compendium";
    render(
      <AppShell>
        <p>Compendium content</p>
      </AppShell>,
    );
    const link = screen.getByRole("link", { name: "Compendium" });
    expect(link).toHaveAttribute("aria-current", "page");

    const dashboardLink = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboardLink).not.toHaveAttribute("aria-current");
  });

  it("marks the Dashboard link active only at the exact root path", () => {
    mockPathname = "/";
    render(
      <AppShell>
        <p>Dashboard content</p>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  });

  it("provides top bar placeholders for Search, Ruleset, Create, and Account", () => {
    mockPathname = "/";
    render(
      <AppShell>
        <p>Content</p>
      </AppShell>,
    );
    expect(screen.getByTestId("topbar-search")).toBeInTheDocument();
    expect(screen.getByTestId("topbar-ruleset")).toBeInTheDocument();
    expect(screen.getByTestId("topbar-create")).toBeInTheDocument();
    expect(screen.getByTestId("topbar-account")).toBeInTheDocument();
  });

  it("reserves a right Inspector region, hidden by default", () => {
    mockPathname = "/";
    render(
      <AppShell>
        <p>Content</p>
      </AppShell>,
    );
    expect(screen.getByTestId("inspector-panel")).toHaveAttribute("hidden");
  });

  describe("mobile navigation toggle", () => {
    it("starts closed, with the nav toggle accessible and wired to the nav region", () => {
      mockPathname = "/";
      render(
        <AppShell>
          <p>Content</p>
        </AppShell>,
      );
      const toggle = screen.getByTestId("nav-toggle");
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      const navId = toggle.getAttribute("aria-controls");
      expect(navId).toBeTruthy();
      expect(document.getElementById(navId!)).toHaveAttribute("data-mobile-open", "false");
    });

    it("opens the nav drawer when the toggle is activated, and updates aria-expanded", async () => {
      mockPathname = "/";
      render(
        <AppShell>
          <p>Content</p>
        </AppShell>,
      );
      const toggle = screen.getByTestId("nav-toggle");
      fireEvent.click(toggle);

      expect(toggle).toHaveAttribute("aria-expanded", "true");
      const navId = toggle.getAttribute("aria-controls")!;
      expect(document.getElementById(navId)).toHaveAttribute("data-mobile-open", "true");
    });

    it("closes the nav drawer again after selecting a link (mobile UX: don't leave the drawer open)", () => {
      mockPathname = "/";
      render(
        <AppShell>
          <p>Content</p>
        </AppShell>,
      );
      const toggle = screen.getByTestId("nav-toggle");
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");

      fireEvent.click(screen.getByRole("link", { name: "Compendium" }));
      expect(toggle).toHaveAttribute("aria-expanded", "false");
    });
  });
});
