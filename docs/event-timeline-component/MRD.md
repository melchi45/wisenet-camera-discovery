# MRD — Event Timeline Component

| | |
|---|---|
| Title | Event Timeline Component — Market Requirements Document (MRD) |
| Abstract | Why the Playback recording timeline was rebuilt as a new custom widget instead of restyling `vis.Timeline`. |
| Status | Draft |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [PRD](PRD.md) · [SRS](SRS.md) · [DESIGN](DESIGN.md) · [TC](TC.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-31 | Youngho Kim | Initial MRD, written for `docs/window-ui/SRS.md`'s FR-7.6 v1.16 (custom event-timeline widget replacing `vis.Timeline`). |

## Market context

`src/shared-v2/`'s Playback recording timeline (`docs/window-ui/SRS.md` FR-7.6) had already gone
through two revisions this session on top of the vendored `vis` npm package's `vis.Timeline` (a
single auto-stacked `"All"` group, then `stack: false` + per-Rule# rows — see `MEMORY.md`), each
time still reported by the user as visually misaligned or too tall. The user then attached a
screenshot of a different application's "ONVIF Timeline" view (a dark panel with a collapsible "ALL
EVENTS" mini-overview/density row showing a highlighted zoom-viewport range and a playhead, named
per-event-type rows below it with colored bars and inline duration labels, and explicit zoom
controls) and asked for that visual style.

`vis.Timeline` has no native minimap/overview sub-widget (confirmed: zero matches for
`minimap`/`overview` in the vendored `node_modules/vis/dist/vis.js`), so the requested "ALL EVENTS"
overview strip — and the zoom-window-vs-full-range relationship it visualizes — cannot be reskinned
onto it; reaching that look requires a genuinely different widget, not new CSS on the old one.

## Alternatives considered

| Approach | Why it was or wasn't chosen |
|---|---|
| **Reskin `vis.Timeline` with new CSS colors only** | Offered to the user via `AskUserQuestion` alongside the full-rebuild option. Rejected — `vis.Timeline` has no overview/minimap concept at all, so the requested "ALL EVENTS" viewport-highlight strip is structurally unreachable through CSS alone, regardless of how much color/spacing is changed. |
| **A second `vis.Timeline` instance as a hand-wired minimap** | Not seriously pursued — would still be built on the same library this session's `MEMORY.md` already documents an unresolved, unexplained item-positioning bug for in this app's exact real-page layout (untouched by every prior stack/height/group change tried against it). Doubling the surface exposed to that same unresolved bug, just to half-reach the requested look, was judged worse than replacing it outright. |
| **A third-party timeline/gantt charting library** | Not considered seriously — matches the reasoning `docs/calendar-component/MRD.md` already gives for the Calendar component: this codebase has an explicit no-new-heavy-dependency bias, and every existing `src/component/*` widget (`calendar`, `switch`, `disclosure`) is hand-rolled vanilla DOM/TS with no charting library. |
| **A new reusable `src/component/event-timeline/` (chosen)** | Matches this repo's established pattern for shared UI widgets — its own `mountEventTimeline()`, its own MRD/PRD/SRS/DESIGN/TC set — built with the same vanilla-DOM approach as `calendar`/`switch`/`disclosure`, with no new dependency. |

## Non-goals carried from the user's own choices

Asked directly (`AskUserQuestion`), the user chose the full-rebuild option over a reskin, and
separately chose to exclude per-event thumbnail images from the reference screenshot — SUNAPI's
`getTimeline()` response has no per-event image field to source them from, so they'd have to be
faked or newly fetched from an endpoint that doesn't exist for this data today. See
[PRD.md](PRD.md)'s Non-Goals for the complete list (thumbnails, the reference's top tab bar and
"All Types"/pager chrome, and a new "Custom" date-range input).
