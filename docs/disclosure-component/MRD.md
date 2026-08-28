# MRD — Disclosure Component

| | |
|---|---|
| Title | Disclosure Component — Market Requirements Document (MRD) |
| Abstract | Why the Debug Information/Discovery/RTSP log panels needed a collapse affordance, and why native `<details>`/`<summary>` was chosen over a hand-rolled widget. |
| Status | Implemented |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [PRD](PRD.md) · [SRS](SRS.md) · [DESIGN](DESIGN.md) · [TC](TC.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-28 | Youngho Kim | Split out of the original single-file `docs/disclosure-component.md` (itself written as an ad hoc SDD) into the MRD/PRD/SRS/DESIGN/TC set, matching `docs/star-topology/`/`docs/native-https-proxy/`'s convention; added Title/Abstract/Author/Milestone/History metadata. |

## Market context

`window.html`'s three diagnostic/log panels — Debug Information (`#debug`, plus a "Use" checkbox
and "Clear" button), Discovery (`#result`), and RTSP (`#rtsp`) — were always visible, taking up a
large fixed vertical footprint at the bottom of the Control page regardless of whether the user
currently needs them. These are diagnostic panels, not something needed on every page load — a
typical user configuring a camera doesn't need raw debug/discovery/RTSP logs open by default, only
when actively troubleshooting.

## Alternatives considered

| Approach | Why it was or wasn't chosen |
|---|---|
| **Leave the panels always visible (status quo)** | Zero work, but doesn't address the clutter the user explicitly asked to fix. |
| **A hand-rolled `aria-expanded` disclosure widget** (a `<button aria-expanded>` + a content `<div>` toggled via a class) | Would need custom JS for click handling, `Enter`/`Space` keyboard activation, and setting `aria-expanded` correctly on every state change — reimplementing behavior the browser already provides. |
| **Native `<details>`/`<summary>`** (chosen) | Open/close, keyboard activation, and correct expanded/collapsed semantics come from the browser for free — this extension already targets evergreen Chrome/Edge only (`README.md`), so there's no compatibility concern. For a panel with no header controls (Discovery, RTSP), **zero JavaScript is needed** for the disclosure behavior itself. See [DESIGN.md](DESIGN.md) for the one real problem this still needed JS for (interactive controls inside `<summary>`). |

## Why default-collapsed and no persistence (user-confirmed decisions)

Both were explicit forks presented to the user (via `AskUserQuestion`) rather than assumed:

- **Default collapsed** (not the status-quo default-visible, and not a per-panel mix): these are
  diagnostic panels the typical user doesn't need open on every load; collapsing them by default
  reduces page clutter with no loss of functionality (still one click away).
- **No state persistence** (not `localStorage`-backed): this codebase has no existing precedent for
  persisting this kind of UI-only convenience state — contrast `#auto_discovery_toggle`, which
  persists to `chrome.storage.local` because it's a functional setting, not a UI convenience. Adding
  persistence here would be new scope beyond what was asked, for a state that resets harmlessly
  every reload anyway.
