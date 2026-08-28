# PRD — Disclosure Component

| | |
|---|---|
| Title | Disclosure Component — Product Requirements Document (PRD) |
| Abstract | Problem, goals, non-goals, users, and success criteria for `src/component/disclosure/`'s `mountDisclosure()`. |
| Status | Implemented |
| Component | `src/component/disclosure/` — used from `src/shared/` (`window.html`/`window.ts`), both the Chrome extension and the nodejs example server target |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [MRD](MRD.md) · [SRS](SRS.md) · [DESIGN](DESIGN.md) · [TC](TC.md) · [../architecture.md](../architecture.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-28 | Youngho Kim | Split out of the original single-file `docs/disclosure-component.md`; added Title/Abstract/Author/Milestone/History metadata. |

## Problem

`window.html`'s Debug Information, Discovery, and RTSP log panels were always visible, with no
show/hide control, taking up a large fixed vertical footprint regardless of whether the user
currently needs them (see [MRD.md](MRD.md)).

## Goals

- A reusable show/hide ("∧∨") panel component applied to all three log panels.
- Debug Information's existing "Use" checkbox and "Clear" button remain usable, as configurable
  options of the component — not hardcoded to that one panel, and not broken by being placed inside
  a clickable header.
- All three panels start collapsed.
- No persistence of open/closed state across reloads.

## Non-Goals

- Not applied to the other, non-collapsible `.panel` sections in `window.html` (Session, Device,
  Video Control, etc.) — only the three panels the user asked for.
- Not a general accordion (only-one-open-at-a-time) widget — each of the three panels opens/closes
  independently.
- No state persistence (`localStorage`/`chrome.storage`) — see [MRD.md](MRD.md)'s reasoning.

## Users

Anyone using `window.html`'s Control page who wants the diagnostic panels out of the way by default,
and anyone troubleshooting who needs to expand one of them without extra clicks navigating away from
where they already are.

## User Story

> As a user configuring a camera, I don't want the Debug Information/Discovery/RTSP logs taking up
> screen space until I actually need them — I want to click a header to reveal one when
> troubleshooting, and have it collapse again as the default the next time I load the page.

## Success Criteria

- All three panels render collapsed on page load.
- Clicking a panel's header (title + chevron) toggles it open/closed; the chevron flips `∨`/`∧`.
- Clicking Debug Information's "Use" checkbox or "Clear" button does **not** also toggle that
  panel.
- Every pre-existing `window.ts` read/write call site for `#debug`/`#result`/`#rtsp`/`#use_debug`/
  `#clear_debug` is unchanged (see [TC.md](TC.md)).
- `npm run build` succeeds for both `dist/chrome-extension/` and `dist/nodejs/` after the change.
