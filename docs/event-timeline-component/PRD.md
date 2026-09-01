# PRD — Event Timeline Component

| | |
|---|---|
| Title | Event Timeline Component — Product Requirements Document (PRD) |
| Abstract | Problem, goals, non-goals, users, and success criteria for `src/component/event-timeline/`'s `mountEventTimeline()`. |
| Status | Draft |
| Component | `src/component/event-timeline/` — used from `src/shared-v2/` only (`playback.ts`) |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [MRD](MRD.md) · [SRS](SRS.md) · [DESIGN](DESIGN.md) · [TC](TC.md) · [../window-ui/SRS.md](../window-ui/SRS.md) (FR-7.6) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-31 | Youngho Kim | Initial PRD. |
| 2.0 | 2026-08-31 | Youngho Kim | Retracted the "Custom date-range input tied to zoom presets" non-goal — reported directly by the user, the zoom presets now DO trigger a caller-owned re-fetch (`onRangePresetSelect`). Added a Selected Time goal ("Manual Start/End Time" moved into this component, renamed). See SRS.md v2.0 and `../window-ui/SRS.md` FR-7.1-7.4/FR-7.8 v2.0. |
| 2.1 | 2026-09-01 | Youngho Kim | Retracted the "per-row Hide control" goal — removed outright per the user's explicit request, along with the "An 'All Types' filter dropdown" non-goal's own rationale (which cited that Hide control as the reason not to add a filter dropdown). The overview row's collapse button now collapses/expands every detail row at once instead. See SRS.md FR-3/FR-10 v2.15. |

## Problem

`docs/window-ui/SRS.md`'s FR-7.6 needs a Playback recording-timeline widget that: shows every
result on one merged overview line plus a dedicated row per distinct Rule#; lets the user zoom into
and pan across the fetched time range; and keeps the existing click/double-click-to-select-time
behavior the caller (`playback.ts`) depends on — all in the dark, `vis.Timeline`-can't-do-this-style
the user asked for. See [MRD.md](MRD.md).

## Goals

- A reusable, dark-theme-native (light theme too, via the same tokens `window.css` already defines)
  event-timeline widget, mounted fresh into an empty container on every render.
- A collapsible "ALL EVENTS" overview row spanning the full fetched item range, doubling as the
  pan/zoom scrubber (drag its highlighted viewport rectangle to pan, drag its edges to zoom) — no
  separate bottom scrollbar widget.
- One detail row per caller-supplied row definition (in practice: one per distinct Rule#), zoomed/
  panned in sync with the overview's viewport selection.
- Mouse-wheel zoom, drag-to-pan, zoom in/out buttons, fixed-width zoom presets (1H/6H/1D/1W/1M/1Y),
  and a zoom-factor readout.
- `onSelect(item)`/`onDoubleClick(time)` callbacks and a `setCustomTime(date)` playhead API,
  sufficient to replace every `vis.Timeline` API `playback.ts` previously called
  (`addCustomTime`/`setCustomTime`, `on('select'/'doubleClick', ...)`).
- ~~A per-row "Hide" control, carried over from the previous `vis.Timeline`-based design.~~
  **Retracted (v2.1)**: removed outright per the user's explicit request — the overview row's
  collapse button now collapses/expands every detail row at once instead (SRS.md FR-10 v2.15).
- **(v2.0)** A "Selected Time" input pair (Start, always; End, behind a "Has End Time" checkbox for
  open-ended playback) owned by this component instead of the surrounding page — the single "what
  will play" state shared by both of `playback.ts`'s Playback UIs (manual and SUNAPI Calendar),
  replacing "Manual Start Time"/"Manual End Time" fields that previously lived outside it in each
  UI separately (and, in the Calendar UI's case, were never actually wired to the correct fields at
  all — see `MEMORY.md`).
- **(v2.0)** The zoom presets (1H/6H/1D/1W/1M/1Y) can trigger a caller-owned re-fetch
  (`onRangePresetSelect`, `[now-preset, now]`) instead of only re-zooming already-loaded data —
  reported directly by the user, retracting this PRD's own original "Custom date-range input" non-
  goal below.

## Non-Goals

- **Per-event thumbnail images** — the reference screenshot's inline camera-snapshot strip per
  event. SUNAPI's `getTimeline()` response (`{Result, Type, StartTime, EndTime}`) has no per-event
  image field; the user explicitly chose to exclude this rather than fake or newly source it.
- **The reference image's page chrome** — its top tab bar (Camera Events/ONVIF Timeline/
  Detections) belongs to a different application's page layout, not this panel.
- **An "All Types" filter dropdown** — not added; the overview row's collapse-all-detail-rows button
  (SRS.md FR-10 v2.15) already covers "declutter the row list," the closest analogue this widget has
  to a per-type filter.
- ~~**A "Custom" date-range input tied to the zoom presets** — the existing Search Timeline date
  fields (`docs/window-ui/SRS.md` FR-7.1–FR-7.3) already own *what gets fetched*; this widget only
  controls *how the already-fetched result is viewed*.~~ **Retracted (v2.0)**: those "existing
  Search Timeline date fields" no longer exist — `docs/window-ui/SRS.md`'s v2.0 redesign moved
  *what gets fetched* onto this widget's own zoom presets, reported directly by the user. The
  reference's "Custom" preset button specifically is still not reproduced (no bespoke custom-range
  input was requested), but presets now do trigger a fetch, not just a local re-zoom — see PRD
  History and SRS.md's FR-5 v2.0.
- **The reference's "N/N" pager readout** — its meaning isn't derivable from this app's data model
  (no analogous concept exists); not guessed at.
- **`src/shared/`'s original Playback timeline** — untouched, still `vis.Timeline`-based, same
  status as the Calendar feature and every prior FR-7.6 revision.
- **SUNAPI/network awareness** — this component makes no network calls and knows nothing about
  SUNAPI; `playback.ts` owns every `getTimeline()` call and feeds this component only plain rows/
  items. **Still true as of v2.0**: `onRangePresetSelect` only hands the caller plain `Date` math,
  and Selected Time (SRS.md FR-13) is plain strings — the caller still owns every actual request and
  every GMT/camera-timezone interpretation.

## Users

Anyone using `src/shared-v2/`'s Playback panel to review a channel's recording/event history and
locate a specific moment to seek to, especially on a channel with several configured Rules where
telling them apart previously meant reading item tooltips one at a time.

## User Story

> As a user reviewing a channel's recording history, I want to see all activity at a glance, zoom
> into a specific window, and tell different alarm rules apart by row and color, without the
> timeline growing so tall it pushes the rest of the page out of view.

## Success Criteria

- The "ALL EVENTS" row renders every fetched item (Normal + every Rule#) on one line; each distinct
  Rule# additionally renders in its own row.
- Zoom (wheel, buttons, presets) and pan (drag, overview-row drag) all update the detail rows' and
  axis's visible window consistently, clamped to the fetched item range.
- Clicking an item invokes `onSelect` with that item's own data exactly once; double-clicking
  invokes `onDoubleClick` with the clicked time.
- `setCustomTime()` moves a playhead marker to the given instant without affecting the current zoom
  window.
- Widget height is proportional to the number of rows actually rendered (overview + N Rule# rows),
  never a fixed height regardless of content.
- `npm run build:shared-v2` succeeds; `npm run build` (the real, shipped product, still
  `vis.Timeline`-based via `src/shared/`) is unaffected, since nothing under
  `src/component/event-timeline/` is imported from `src/shared/`.
