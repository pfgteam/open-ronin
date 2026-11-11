# Open Ronin — UI Guidelines

> Established 2026-08-13 after the visual-cohesion audit. These rules exist so every
> module looks and behaves like the same product. The Dashboards module is the
> reference layout. Enforced by `scripts/ui-audit.sh` — run it before shipping UI work.
>
> **Style guide (2026-11-05):** the browsable guide is the "Open Ronin Style Guide"
> Design System artifact (tokens with light and dark values, component pages,
> brand book, logo set). Decisions 1–12 below are confirmed (Alex, 2026-11-05)
> and this file now matches them. Colours, fonts, corners and button style are
> themeable at runtime from **Admin › Design System** (`design_settings`, 0161):
> the tokens in `globals.css` are the defaults, so never hard-code a value a
> setting could change.

## Style guide decisions (confirmed 2026-11-05)

1. **Font:** `font-sans` = `var(--font-app)` → `var(--font-inter)` (next/font). Never the literal `Inter`.
2. **Modal radius:** `rounded-lg` for every modal and dialog. `rounded-xl` / `rounded-2xl` are banned (audit).
3. **Scrim:** `bg-slate-900/40 backdrop-blur-[2px]` (Dialog, ModalCard, Drawer).
4. **Elevation:** `shadow-panel` is the only shadow, for floating things (drawers, popovers, the bulk bar, drag overlays). Cards and tabs have none. `shadow-sm|md|lg|xl|2xl` are banned (audit).
5. **Spacing rhythm:** page container `px-6 py-5` (AppLayout); card grids `gap-4`, control and field grids `gap-3`; `space-y-4` between sections, `space-y-2` between rows.
6. **Layering (z scale):** `z-10` sticky table parts, `z-20` in-page floating, `z-30` drawers, `z-40` chrome and the bulk bar, `z-50` overlays, `z-[60]` popovers, `z-[100]` toasts. `z-[1]` is banned (audit).
7. **Colour fallback:** one fallback for DB-driven colours, `FALLBACK_COLOR` (`#8f9494`, `lib/colors.ts`).
8. **Palettes:** avatars and group bars use the token palette `VIZ` / `vizFor()` (`--viz-1..8`), status and priority colours use the status tokens and primary. No hex lists, no hashed `hsl()`, no template `rgba()` (audit).
9. **Colour input default:** `#069494`.
10. **Motion:** `transition-colors duration-150` on interactive elements; `transition-all` only for progress widths; no decorative `animate-pulse`.
11. **Whole-surface click targets:** a tile, card, row or field that opens something is clickable across its whole surface (`LinkCard`, hub rows). Row actions and checkboxes stop propagation; labels use `htmlFor`.
12. **Buttons are always bordered; actions are Buttons.** Every Button variant carries a border (width, radius and weight come from `--btn-border-w`, `--btn-radius`, `--btn-weight`). A bare link or unbordered span never fires an action; plain links are for navigation inside copy. Use `IconButton` for icon-only buttons (bordered in page content).

Status badges are quiet (rework 8.5): a tinted chip with a dot, tone from the status category (`lib/work/hub/rows.ts`: neutral, primary, warning, success, danger, muted), token colours only.

## Color

| Role | Token | Rule |
|---|---|---|
| Brand / primary actions | `primary-*` (teal, 600 = `#069494`) | Buttons, active nav, focus rings, links |
| Brand accent | `accent-*` (lime, 600 = `#88D03A`) | Identity only: logo wordmark (`org.`), Beacon badge, highlights. **Never a status color.** |
| Neutrals | `slate-*` (brandGray, 900 = `#202020`) | The ONLY neutral family. No `gray`/`zinc`/`neutral`/`stone`. |
| Success / on-track / done | `green-*` | The ONLY green. `emerald` is banned. |
| Warning / at-risk | `amber-*` | No `yellow`/`orange`. |
| Danger / overdue / error | `red-*` | No `rose`/`pink`. |
| In-progress | `primary-*` | Not blue — `blue` is banned. |

No hardcoded hex/rgb in `.tsx`. The raw RGB values in `globals.css` scrollbar rules
are the one exception and must match the brandGray scale.

## Dark mode (was the #1 recurring bug — now the healthiest dimension)

> Status 2026-09-16: a full sweep found **zero** `hover:bg-slate-*` without a
> `dark:` pair, zero `text-black`, and every bare `bg-white` justified. The
> rules below are what fixed it — keep following them, but the historical
> "#1 recurring bug" framing no longer describes the code.

`Card` renders `dark:bg-slate-800`; the page behind it is `dark:bg-slate-900`
(AppLayout). Painting slate-800 on a Card is painting the background on itself.

Inside a Card:

- Hover fill → `dark:hover:bg-slate-700/45` (subtle rows: `/30`; strong: `/50`)
- Border / separator → `dark:border-slate-700` or `dark:border-slate-700/50`
- Selected segment → `dark:bg-slate-700`
- Section darker than the card → `dark:bg-slate-900`
- Chips/tracks → `dark:bg-slate-700/60`

`dark:hover:bg-slate-800` and `dark:border-slate-800` are banned outright — the
slate-700 tones are visible on both surfaces, so there is no reason to risk it.
Every hover gets `transition-colors`. Hover applies to EVERY row in a list, even
non-clickable ones (hover reveals row actions).

## Typography

- Page title: `text-xl font-semibold text-slate-900 dark:text-slate-100` — use
  `<PageHeader>` (`@/components/ui/PageHeader`), don't hand-roll.
- Body/controls: `text-sm`. Dense/table text: `text-xs`.
- Micro (counts, chips, kbd): `text-2xs` (11px, defined in tailwind.config.ts).
- **Arbitrary font sizes (`text-[Npx]`) are banned.** If a size is missing, add a
  token to the config.
- KPI values: `text-2xl font-semibold tabular-nums` (dashboard tiles).
- Section labels: `text-2xs font-medium uppercase tracking-wide text-slate-500`.

## Radius

`rounded-md` for controls (buttons, inputs, selects, chips with corners),
`rounded-lg` for cards/panels/modals, `rounded-full` for pills/avatars/dots.
Bare `rounded` is banned.

## Components — use these, don't re-style raw elements

| Need | Use |
|---|---|
| Button | `@/components/ui/Button` (primary/secondary/ghost/outline/danger · sm/md/lg), always bordered |
| Icon-only button | `@/components/ui/IconButton` (aria-label required) |
| On/off setting that saves at once | `@/components/ui/Toggle` |
| Card that opens something | `@/components/ui/LinkCard` (whole surface is the link) |
| Side panel | `@/components/ui/Drawer` (sticky header, one scroll body, z-30) |
| Tabs | `@/components/ui/Tabs` (counts are true filtered counts) |
| Avatar | `@/components/ui/Avatar` (token colours) |
| Table parts | `@/components/ui/Table` (`TableScroller`, `Th`, `Td`, `Tr`, `SectionRow`, `StatusDot`) |
| Header "select all" | `@/components/ui/TriCheckbox` |
| Colour picker | `@/components/ui/ColorField` |
| End of a long list | `@/components/ui/AutoLoad` — never a Load more button (rework D8) |
| Text input | `@/components/ui/Input` |
| Select | `@/components/ui/Select` (size `sm` for toolbars, `md` for forms) |
| Page title row | `@/components/ui/PageHeader` |
| Card/panel | `@/components/ui/Card` |
| Status pill | `@/components/ui/Badge` |
| Loading list/table | `@/components/ui/Skeleton` / `SkeletonRows` — not spinners or "Loading…" |
| Empty module | `@/components/ui/ComingSoon` |

Boy-scout rule: any screen you touch, convert its raw `<button>`/`<input>`/`<select>`
to the shared components as part of the change.

## Tables (the reference is the Dashboards daily table)

- Section header ABOVE the table: chevron + `text-xs font-semibold uppercase tracking-wider text-slate-500` + plain tabular count + `h-px` rule filling the row.
- `<thead>`: `bg-slate-50/80 dark:bg-slate-900/30`; `<th>`: `text-xs font-medium text-slate-400 dark:text-slate-500` — normal case, NOT uppercase.
- Rows: separator `border-slate-100 dark:border-slate-700/60`, hover `hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors`.
- Numbers right-aligned with `tabular-nums`.
- Status in read-only lists = text, not a chip: colored dot (`w-1.5 h-1.5 rounded-full`) + humanized label in `text-2xs text-slate-500` (see `StatusText` in HomeView). Editable status (The Work tables) stays a Select.
- No kind icons (checkbox/folder) next to row titles — the kind is stated in the meta line.

## Filters (one standard, everywhere)

- Filter toggle chip: `@/components/ui/FilterChip` — rounded-full, active = `border-primary-500 bg-primary-50 dark:bg-primary-950/50 text-primary-700`, idle = muted border. Count via the `count` prop (plain, `opacity-60` — never a solid pill).
- Search box in toolbars: `text-xs rounded-md border slate-200/700 bg-white dark:bg-slate-800 py-1.5` with a leading Search icon (see MetricExplorer).
- Solid `bg-primary-600 text-white` filter pills are banned — that treatment is reserved for primary action Buttons.
- Dropdown filters use `@/components/ui/Select` size `sm`.

## Brand wordmark

- App chrome (TopNav): Open Ronin roundel + `org.` in `primary-600 dark:primary-400` + `team` in slate-900/100.
- Auth pages: roundel + "Open Ronin" all-neutral (slate-900/100) — no color splash on marketing-free surfaces.
- `accent` (lime #88D03A) is reserved for identity badges (Beacon, Client origin, tier-1) — never status, never the wordmark.

## Overlays

Scrim = `bg-slate-900/40 backdrop-blur-[2px]`, always. No per-modal opacity choices.

## Focus

Interactive elements: `focus:outline-none focus:ring-2 focus:ring-primary-500`
(components already do this — one more reason to use them). Prefer `focus-visible:`
for buttons. `focus:ring-0`/`ring-1` are not allowed on new code — **now enforced
by `ui-audit.sh`**, after ⌘K Quick Add shipped with no focus indicator at all.

A deliberately chrome-less input is still fine: put the indicator on the
container with `focus-within:ring-2`, or use `focus-visible:border-primary-500`
on the input. Invisible focus is the thing that's banned, not the borderless look.

## Contrast (WCAG AA — measured, not eyeballed)

Body text needs **4.5:1**; 11px `text-2xs` is body text, not large text, so it
needs the full 4.5 too. Measured against the real palette:

| Pair | Ratio | Verdict |
|---|---|---|
| `text-slate-400` on white | 2.61 | ✗ never for text in light mode |
| `text-slate-500` on white | 4.7 | ✓ since the Revamp palette (`#6f7474`); still pair it with `dark:text-slate-400` because its dark value is `tx3` |
| `text-slate-600` on white | 7.34 | ✓ the light-mode secondary text colour |
| `dark:text-slate-400` on slate-800 | 5.41 | ✓ the dark-mode secondary text colour |
| `dark:text-slate-500` on slate-800 | 3.21 | ✗ |
| white on `primary-600` | 3.70 | ✗ — why Button uses `primary-700` (4.89) |
| white on `accent-600` (lime) | 1.89 | ✗ **lime never carries white text** |
| `slate-900` on `accent-600` | 8.64 | ✓ |
| white on `amber-500` | 2.15 | ✗ — use `text-slate-900` (7.59) |

**The rule:** secondary text is `text-slate-600 dark:text-slate-400`. `slate-400`
is for icons, dividers and disabled states in light mode — not for words.
`slate-500` is fine as a *background* or border, not as text.

Note there is no single token value that passes in both modes: the same
`slate-500` faces white in light mode and slate-800 in dark, which pull in
opposite directions. That is why the fix is a per-mode class pair, not a palette
tweak.

## Layout rhythm

`px-6 py-5 max-w-screen-2xl` page container (AppLayout), `gap-4` card grids,
`gap-3` control and field grids, `space-y-4` between sections, `space-y-2`
between rows. Don't invent new rhythms (style guide decision 5).

Control borders (`line2`) are 1.6:1 light / 1.7:1 dark on the card, under the
3:1 WCAG floor for control boundaries; the focus ring carries the affordance.
If a client-facing surface needs it, `line2` would darken to about `#9a9f9f`.
White on `success` (3.3:1) and `warning` (2.6:1) fails: put `text-slate-900`
on those fills. White on `danger` is 4.5:1 exactly. Admin › Design System runs
these same checks on any custom palette.

## Enforcement

```bash
bash scripts/ui-audit.sh        # counts banned patterns; non-zero exit on regression
```

Ratchets (`scripts/ui-audit-baseline.txt`): hex in tsx, raw `<button>`,
`<input>`, `<select>`, `<textarea>`, native checkboxes, retyped focus rings and
`Loading…` literals outside `components/ui` fail the audit when they GROW.
Lower the number in the commit that sweeps a screen (style guide phase 3);
never raise it to get a green build.

This is a CI step, not a suggestion — `.github/workflows/ci.yml` runs it on every
PR and the PR is red if it fails. Run it locally with the other gates:

```bash
cd web && pnpm typecheck && pnpm lint && pnpm test
cd .. && bash scripts/ui-audit.sh    # repo ROOT — a run from inside web/ misses it
```

The root path is the trap: the other three gates run in `web/`, this one does not,
so it is easy to leave out of a local check and meet a red CI (PR #38).

When the audit flags a class, look for a `ui/` primitive that already covers that
case before hand-patching the class — a bare `rounded` on a native checkbox meant
`ui/Checkbox`, which also fixed a dark-mode rendering bug the raw input carried.

If a legitimate exception exists, document it here.
