# MRD — Calendar Component

| | |
|---|---|
| Title | Calendar Component — Market Requirements Document (MRD) |
| Abstract | Why Playback + SUNAPI On needed a month-view calendar, and why it's built as a new reusable component rather than inline markup. |
| Status | Draft |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [PRD](PRD.md) · [SRS](SRS.md) · [DESIGN](DESIGN.md) · [TC](TC.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-28 | Youngho Kim | Initial MRD, written for `docs/window-ui/SRS.md`'s FR-7.8 (SUNAPI-driven Calendar search). |

## Market context

`src/shared-v2/`'s Playback panel (`docs/window-ui/`'s FR-7.1–FR-7.4) requires a user to type a
date range by hand, click "Search Overlapped Id", then separately click "Search Timeline" — with
no indication of which dates actually have recordings before searching. Requested directly by the
user: when SUNAPI is On, replace that manual flow with a month calendar that visibly marks which
days have recordings (via `calendarsearch`) and lets a click on one of those days drive the rest
of the search automatically.

## Alternatives considered

| Approach | Why it was or wasn't chosen |
|---|---|
| **Keep the manual date-range flow for everyone (status quo)** | Zero work, but doesn't address what the user asked for, and gives no visual indication of which dates have any recordings at all before running a search. |
| **Inline markup/logic directly in `playbackCalendar.ts`, no separate component** | Considered and rejected via `AskUserQuestion` — the user chose a reusable component to match this repo's established `src/component/switch/`+`src/component/disclosure/` convention (each has its own `mountX()` API and doc set) rather than a one-off inline implementation. |
| **A third-party date-picker/calendar library** | Not considered seriously — this codebase has an explicit no-new-heavy-dependency bias (`src/component/switch/`'s own MRD makes the same call for a plain toggle), and a month-grid-with-highlighted-days is a small enough surface to hand-build with `moment` (already a dependency) the same way the discovery Star Topology view hand-builds its `vis.Network` grouping logic instead of reaching for a higher-level framework. |
| **A new reusable `src/component/calendar/` (chosen)** | Matches this repo's established pattern for shared UI widgets — own `mountCalendar()`, own MRD/PRD/SRS/DESIGN/TC set — and is genuinely reusable if a future feature needs a month-view date picker (not a hypothetical stretch: `docs/window-ui/SRS.md`'s FR-7.8 is itself only one of several places a "pick a day with recordings" interaction could plausibly be needed later, e.g. Instant Playback). |

## Why this deviates from `switch`/`disclosure`'s pure progressive-enhancement style

Both existing components only *enhance* markup already authored in `window.html` — they never
generate DOM. A month calendar can't follow that exactly: the grid of day cells is inherently
data-driven (the number of days, the weekday offset, which days are highlighted all change every
month), so `mountCalendar()` mounts into an *empty* container and generates the grid itself,
re-rendering it on every month change. This is not unprecedented in this codebase — the discovery
result table/topology (`docs/star-topology/`) and the Video Source/Profile list
(`docs/control-panel-data-binding.md` §4) already render dynamically from data for the same
reason. See [DESIGN.md](DESIGN.md) for how this is scoped (the component still never reaches
outside its own container, and still exposes a small, `switch`/`disclosure`-style
`mount()`-returns-a-controller API).
