# Studio Application Shell — M0-WO5

The reusable Prowess Studio shell (PAS-06 / PAS-10 §M0-WO5). Every route in
`apps/studio` renders through this one shell — no page builds its own copy
of navigation, top bar, or layout chrome.

## Structure

```
AppShell (apps/studio/app/components/AppShell.tsx)
├─ top bar (PROWESS brand, mobile nav toggle, Search, Ruleset, Create, Account)
└─ body
   ├─ primary navigation (left, persistent on desktop / drawer on mobile)
   ├─ workspace (the actual page content — {children})
   └─ Inspector region (right, reserved, hidden by default)
```

`apps/studio/app/layout.tsx` wraps every route in `<AppShell>`; individual
`page.tsx` files render only their own content into the workspace region.

## Centralized navigation

`apps/studio/src/navigation.ts` is the single source of truth for the
primary nav — `AppShell` reads from it; no page or component hard-codes its
own nav list. Each entry has an `id`, `label`, `href`, and an optional
`placeholder` flag.

| Entry | Route | Status |
| --- | --- | --- |
| Dashboard | `/` | Functional (M0-WO1) |
| Compendium | `/compendium` | Functional (M0-WO1) |
| Studio | `/studio` | Placeholder (M0-WO5) |
| Characters | `/characters` | Placeholder (M0-WO5) |
| World | `/world` | Placeholder (M0-WO5) |
| GM | `/gm` | Placeholder (M0-WO5) |
| Publishing | `/publishing` | Placeholder (M0-WO5) |
| Developer | `/developer` | Functional (M0-WO1) |

"Functional" means the route exists and renders its real (if minimal)
content; "Placeholder" means the route exists and is reachable from the
shell, but holds no real product functionality — just a labeled stand-in
page, explicit about what it isn't yet.

### Future nested navigation

PAS-06 anticipates subsections under some primary entries (Studio →
Spells/Maneuvers/Equipment/Summons/Cards; Developer → Rules
Inspector/Canon Manager/Sources/Tests). `navigation.ts`'s `NavEntry.children`
field already records this shape, so adding real subsection UI later won't
require changing the data structure — but per M0-WO5's scope, `children` is
not read or rendered by `AppShell` yet; only the primary level is visible.

### Active state

`isNavEntryActive(entry, pathname)` (also in `navigation.ts`) decides which
entry is "active" for a given pathname: the Dashboard entry matches only
the exact root path; every other entry also matches its own sub-paths
(e.g. a future `/compendium/spells/fireball` would still highlight
"Compendium"). The active link gets `aria-current="page"` (for assistive
tech) plus a background/weight/border-color change (so it's never
color-alone) — never a `data-active` attribute alone, which isn't exposed
to assistive technology.

## Top bar

Four placeholders, none functional yet (`packages/prowess-ui/src/TopBar.tsx`):

- **Global Search** (`TopBarSearch`) — shows "Search Prowess..." and a
  `Ctrl/Cmd+K` shortcut hint. No search implementation.
- **Ruleset selector** (`TopBarRulesetSelector`) — shows a static "Core
  Playtest" label as a disabled control. No real Ruleset data exists yet
  (that's a future Work Order).
- **Create** (`TopBarCreateButton`) — a disabled button. No object-creation
  workflow exists.
- **Account** (`TopBarAccount`) — a disabled control showing a single
  initial. No authentication belongs here or anywhere in M0.

All four are real, disabled HTML controls with explicit `aria-label`s —
not inert decoration — so they read correctly to assistive tech as "not
yet available" rather than being silently skipped or, worse, appearing
interactive with no effect.

## Workspace

The `<main className="prowess-shell__workspace">` region is where every
page's own content renders. It is intentionally unopinionated — list/detail
views, builders, split panes, and contextual inspectors can all live here
later without any shell change. No business logic (rules, spell costs,
entity status, Canon, character statistics) belongs in the shell itself —
`AppShell` only ever renders navigation chrome and passes `children`
through untouched.

## Right Inspector region

`packages/prowess-ui/src/InspectorPanel.tsx` establishes the structural
slot PAS-06's contextual right Inspector will eventually use. For M0-WO5:

- it renders as an empty `<aside>`, `hidden` by default;
- no page passes `open` or real content yet;
- the component already accepts `open`/`title`/`children` props, so a
  future page can start using it without any change to `AppShell`.

This is the one place in the shell that intentionally uses the native
`hidden` attribute for "not shown anywhere, at any width" — contrast with
the primary nav's mobile drawer below, where `hidden` would have been the
wrong tool.

## Responsive behavior

Breakpoint: **900px** (`--shell-breakpoint-desktop` in `globals.css`).

- **≥900px (desktop/tablet-landscape):** primary navigation is a persistent
  left sidebar; the mobile nav toggle is hidden (CSS `display: none`); the
  top bar's Search field has room to show its full `Ctrl/Cmd+K` hint.
- **<900px (mobile/tablet-portrait):** primary navigation becomes a
  toggleable drawer, closed by default. A hamburger-style toggle
  (`NavToggle`, top-left of the top bar) opens/closes it. Selecting a nav
  link while the drawer is open closes it again (standard mobile UX — you
  don't want the drawer still covering the screen after navigating). The
  Search field's shortcut hint is hidden to save space, and the Inspector
  region (when eventually shown) stacks below the workspace instead of
  beside it.

**Implementation note — why nav visibility is CSS-only, never the
`hidden` attribute:** an earlier draft tried to default the nav to
`hidden` and have a desktop-width CSS media query override that default.
This doesn't work, and more importantly isn't correct even where it
appears to: the `hidden` attribute removes its element from the
accessibility tree and keyboard tab order *unconditionally*, in every
browser, regardless of what CSS later does to its `display` value — a
screen-reader or keyboard user at desktop width would still have the
"hidden" nav invisible to them even though sighted desktop users would see
it rendered. The fix: the nav is always present in the DOM and always in
the accessibility tree; a `data-mobile-open` attribute (driven by
`AppShell`'s own React state) combined with a pure-CSS, breakpoint-scoped
rule controls *visual* display only at narrow widths, and is irrelevant
(always visible) at desktop widths. This bug was caught by the shell's own
component tests failing, not by inspection — see
`apps/studio/tests/unit/app-shell.test.tsx`.

## Accessibility

- Primary nav is a real `<nav aria-label="Primary">` containing a real
  `<ul>`/`<li>`/`<a>` structure — fully keyboard-navigable by default, no
  custom key handling needed.
- The active nav entry carries `aria-current="page"`, not just a visual
  style.
- The mobile nav toggle is a real `<button>` with `aria-expanded` (current
  state), `aria-controls` (which element it toggles — the primary nav's
  `id`), and an explicit `aria-label` that changes between "Open
  navigation menu" / "Close navigation menu".
- Every top-bar placeholder control has an explicit `aria-label` describing
  both what it is and that it isn't implemented yet, rather than an
  unlabeled icon or a `div` masquerading as a control.
- Focus outlines are preserved (`:focus-visible` styling on nav links, not
  suppressed).

## What the shell deliberately does not do

- No Prowess rule calculations, Spell costs, Entity status, Canon, Ruleset,
  or character statistics — presentation and navigation only.
- No real search, Ruleset data, object creation, or authentication — all
  four top-bar controls are disabled placeholders.
- No final visual-design pass — spacing/color tokens exist
  (`:root` custom properties in `globals.css`) for consistency, but this is
  a structural foundation, not Prowess's eventual brand identity.
- `DEVELOPMENT_MODE` (M0-WO2) is **not** read anywhere in the shell. It's a
  server-only configuration value; exposing it to client components (e.g.
  to conditionally show "Developer" nav) would require a deliberate,
  separate client-safe derived value — not something to leak in as a side
  effect of shell work. The Developer nav entry is visible unconditionally
  for now.
