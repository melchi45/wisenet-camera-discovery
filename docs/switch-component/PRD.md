# PRD — Switch Component

| | |
|---|---|
| Title | Switch Component — Product Requirements Document (PRD) |
| Abstract | Problem, goals, non-goals, users, and success criteria for `src/component/switch/`'s `mountSwitch()`. |
| Status | Implemented |
| Component | `src/component/switch/` — used from `src/shared/` (`window.html`/`window.ts`), both the Chrome extension and the nodejs example server target |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [MRD](MRD.md) · [SRS](SRS.md) · [DESIGN](DESIGN.md) · [TC](TC.md) · [../architecture.md](../architecture.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-28 | Youngho Kim | Split out of the original single-file `docs/switch-component.md`; added Title/Abstract/Author/Milestone/History metadata. |

## Problem

`window.html` had 5 switch-looking controls built on 3 unrelated mechanisms (see [MRD.md](MRD.md))
that only happened to look alike, with no shared component, no support for a 3+-option switch, and
no way to render a dot instead of text for an option.

## Goals

- One reusable component, `mountSwitch()`, behind every switch-looking control in this UI.
- Support a basic On|Off switch (2 options, default labels), a custom Text1|Text2 switch (2 options,
  custom labels — e.g. HTTP|HTTPS), an N-way switch (3+ options), and a dot-instead-of-text render
  mode for any option.
- **Full migration** of all 5 pre-existing switches onto the new component, not just availability
  for future call sites (see [MRD.md](MRD.md)'s reasoning).
- Zero behavior change to any pre-existing `window.ts` call site that reads/writes a switch's
  underlying `.checked`/`:checked`/`.active` state.

## Non-Goals

- Not a general, framework-agnostic widget library — scoped to this UI's own `window.html`/
  `window.ts`, reusing this codebase's existing CSS custom properties (`--accent`, `--surface`,
  etc.) rather than being themeable for use outside it.
- Not a config-driven full-markup-generation component (see [MRD.md](MRD.md)'s alternatives) —
  every switch's native input(s)/button(s) must already exist in `window.html`.
- No new persistence behavior — dark mode still resets to its HTML default (`checked`, i.e. dark) on
  every page load, same as before this component existed.

## Users

Whoever maintains `window.html`'s switch-looking controls next — adding a new one, or changing an
existing one's labels/variant, should only ever need `mountSwitch()`, not a fourth ad hoc mechanism.

## User Story

> As a maintainer adding a new toggle to the Control panel, I want one documented function to mount
> it — On|Off, custom two-label, or 3+-way, optionally as dots instead of text — instead of having
> to decide which of three different pre-existing patterns to copy.

## Success Criteria

- All 5 pre-existing switches (dark mode, HTTP/HTTPS, Live/Playback, timeline range, SUNAPI On/Off)
  are mounted through `mountSwitch()`.
- Every pre-existing `window.ts` read/write call site for those 5 controls (~35 total) is unchanged
  — confirmed by grep after migration (see [TC.md](TC.md)).
- `npm run build` succeeds for both `dist/chrome-extension/` and `dist/nodejs/` after the migration.
- `segmentedToggle.ts` (the one ad hoc mechanism previously factored into its own module) is deleted
  — no longer needed once `mountSwitch()` covers its one case plus the other four.
