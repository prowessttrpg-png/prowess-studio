import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression (RULES-WO1 Phase D finding; the same behaviour reproduced on main 23f3c03): an Entity Type chosen while
 * the Compendium search is still waiting for its debounce must survive the search update. Before the fix, the
 * debounce timer wrote the URL with the writer captured when it was armed — without the new filter — and the
 * filter was silently dropped.
 *
 * The router is a tiny URL store: push() changes the URL and every reader re-renders, as with Next's router.
 */
const url = vi.hoisted(() => {
  let current = "";
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(next: string) {
      current = next;
      for (const l of listeners) l();
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    pushes: [] as string[],
    cache: new Map<string, URLSearchParams>(),
    params(q: string): URLSearchParams {
      let p = this.cache.get(q);
      if (p === undefined) this.cache.set(q, (p = new URLSearchParams(q)));
      return p;
    },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/compendium",
  // One URLSearchParams object per URL, as Next returns a stable object until the URL changes.
  useSearchParams: () => url.params(useSyncExternalStore(url.subscribe, url.get, url.get)),
  useRouter: () => ({
    push: (href: string) => {
      url.pushes.push(href);
      // Next applies a push asynchronously; the store does the same.
      setTimeout(() => url.set(href.split("?")[1] ?? ""), 20);
    },
  }),
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
const listEntities = vi.hoisted(() => vi.fn());
vi.mock("../../app/compendium/_lib/api-client", async (orig) => ({ ...(await orig<object>()), listEntities }));

const { default: CompendiumPage } = await import("../../app/compendium/page");

beforeEach(() => {
  url.set("");
  url.pushes.length = 0;
  listEntities.mockReset();
  listEntities.mockResolvedValue({ items: [], total: 0, totalPages: 0 });
});

describe("Compendium — search and filters together", () => {
  it("keeps an Entity Type chosen during the search debounce when the search update lands", async () => {
    render(<CompendiumPage />);
    const search = await screen.findByLabelText("Search");
    fireEvent.change(search, { target: { value: "fireball" } });
    // Within the 300 ms debounce window:
    fireEvent.change(screen.getByLabelText("Entity Type"), { target: { value: "SPELL_EFFECT" } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    const params = new URLSearchParams(url.get());
    expect(params.get("entityType")).toBe("SPELL_EFFECT");
    expect(params.get("search")).toBe("fireball");
    // Every write after the filter keeps it.
    const afterFilter = url.pushes.slice(url.pushes.findIndex((p) => p.includes("entityType=SPELL_EFFECT")));
    expect(afterFilter.length).toBeGreaterThan(0);
    for (const p of afterFilter) expect(p).toContain("entityType=SPELL_EFFECT");
    await waitFor(() => expect(listEntities).toHaveBeenLastCalledWith(expect.objectContaining({ search: "fireball", entityType: "SPELL_EFFECT" })));
  });

  it("still writes a search typed on its own after the debounce, keeping existing filters", async () => {
    url.set("entityType=SPELL_EFFECT");
    render(<CompendiumPage />);
    fireEvent.change(await screen.findByLabelText("Search"), { target: { value: "bolt" } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    const params = new URLSearchParams(url.get());
    expect(params.get("search")).toBe("bolt");
    expect(params.get("entityType")).toBe("SPELL_EFFECT");
  });

  it("never shows a page label with another page's rows, and a superseded slow response never replaces a newer one", async () => {
    const row = (key: string) => ({ entity: { id: key, entityType: "GENERIC_RULE", canonicalKey: key, createdAt: "", updatedAt: "" }, latestRevision: null });
    listEntities.mockImplementation(async (p: { page: number }) => {
      // Page 1 answers slowly the SECOND time it is asked (a stale reply arriving late).
      const calls = listEntities.mock.calls.filter((c) => (c[0] as { page: number }).page === 1).length;
      if (p.page === 1 && calls > 1) await new Promise((r) => setTimeout(r, 250));
      return { items: [row(`test.page${p.page}`)], total: 3, totalPages: 3, page: p.page, pageSize: 1 };
    });
    url.set("search=x&pageSize=1");
    render(<CompendiumPage />);
    await screen.findAllByText("test.page1");
    const seen: string[] = [];
    const sample = () => {
      const label = document.querySelector('[data-testid="pagination"]')?.textContent ?? "";
      const rows = [...document.querySelectorAll('[data-testid="entity-row"]')].map((r) => r.textContent ?? "").join("|");
      seen.push(`${/Page (\d)/.exec(label)?.[1] ?? "-"}:${rows}`);
    };
    const observer = new MutationObserver(sample);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findAllByText("test.page2");
    // Back to page 1 (slow) and immediately on to page 3 (fast): page 3 must win.
    url.set("search=x&pageSize=1");
    url.set("search=x&pageSize=1&page=3");
    await screen.findAllByText("test.page3");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    observer.disconnect();
    expect(screen.getAllByText("test.page3").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("test.page1")).toHaveLength(0);
    for (const s of seen) {
      const [label, rows] = s.split(":");
      if (label !== "-" && rows !== "") expect(rows, s).toContain(`test.page${label}`);
    }
  });
});
