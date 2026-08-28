# DESIGN — Disclosure Component

| | |
|---|---|
| Title | Disclosure Component — Design Document |
| Abstract | Why native `<details>`/`<summary>`, the `<summary>`-click-bubbling fix, the label-wrapped-checkbox wrinkle, and idempotency. |
| Status | Implemented |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [PRD](PRD.md) · [MRD](MRD.md) · [SRS](SRS.md) · [TC](TC.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-28 | Youngho Kim | Split out of the original single-file `docs/disclosure-component.md` (its §3/§4 Design/Detailed design sections); added Title/Abstract/Author/Milestone/History metadata. |

## Why native `<details>`/`<summary>`, not a hand-rolled widget

A hand-rolled disclosure (a `<button aria-expanded>` + a content `<div>` toggled via a class and
`display: none`/`block`) would need custom JS for: click handling, `Enter`/`Space` keyboard
activation, and setting `aria-expanded` correctly on every state change. `<details>`/`<summary>`
provides all of that natively:

- Clicking `<summary>` (or pressing `Enter`/`Space` while it's focused) toggles the parent
  `<details>`'s `open` attribute — built into every evergreen browser, no JS required.
- The default-collapsed state is simply the *absence* of the `open` attribute in markup — for a
  panel with no header controls (Discovery, RTSP), this means **zero JavaScript is needed at all**
  for the disclosure behavior itself; `mountDisclosure()` is only still called for API uniformity
  (a consistent `DisclosureController` to program against later, matching this codebase's existing
  `src/component/switch/` convention of "every X goes through one mount function").
- A `toggle` event fires natively on state change, used here for the optional `onToggle` callback.

This repo's extension already targets evergreen Chrome/Edge only (`README.md`), so there is no
browser-support concern with relying on `<details>` (SRS NFR-3).

## Why progressive enhancement, not a config-driven full render

Consistent with `src/component/switch/`'s established approach in this codebase (see
`docs/switch-component/MRD.md`'s "Alternatives considered" and `MEMORY.md`'s entry on that choice):
`mountDisclosure()` never generates the `<details>`/`<summary>`/content markup — it only sets the
initial `open` state, guards the two optional header controls, and wires `onToggle`. The three
panels are authored directly in `window.html`, keeping their existing element ids (`debug`,
`result`, `rtsp`, `use_debug`, `clear_debug`) exactly as they were, so every pre-existing
`document.getElementById(...)` call site in `window.ts` (the debug-log append code,
`scrollbottom()`/`scrollbottomrtsp()`, `oncleardebug()`, `onchangeusedebug()`) keeps working
unchanged — only their DOM *position* moves (into a `<details>`'s content area), never their id or
behavior.

## The `<summary>`-click-bubbling problem

Putting an interactive control (Debug Information's "Use" checkbox / "Clear" button) inside
`<summary>` creates one real problem: `<summary>`'s native toggle activates on *any* click that
bubbles up through it, so clicking "Clear" or the "Use" checkbox would also collapse/expand the
panel as an unwanted side effect. `mountDisclosure()`'s `headerCheckboxId`/`headerButtonId` options
(SRS FR-5) solve this with a single `event.stopPropagation()` listener per named control:

```ts
function guardHeaderControlClick(id: string): void {
  const el = document.getElementById(id);
  if (el === null) return;
  const clickTarget = el.closest('label') ?? el;
  clickTarget.addEventListener('click', (event) => event.stopPropagation());
}
```

`#use_debug`'s actual markup is `<label for="use_debug" class="field">Use<input type="checkbox"
id="use_debug"></label>` — the checkbox is *nested inside* its label, not a sibling pointed at by
`for`. Clicking the label's text fires a click on the `<label>` element itself, which bubbles
independently of the synthetic click the browser also dispatches on the checkbox — guarding only
`#use_debug` itself would miss that path and the panel would still toggle when the "Use" text is
clicked, not just when the checkbox square itself is clicked. `closest('label')` finds that
ancestor when it exists and falls back to the control itself otherwise (the case for
`#clear_debug`, a plain `<button>` with no wrapping label).

## Idempotency

Guarded by a `data-disclosure-mounted` attribute on the `<details>` element, same convention
`src/component/switch/`'s `mountSwitch()` uses (SRS FR-7) — a second `mountDisclosure()` call for
the same `containerId` is a no-op past the first call (its own `onToggle`/header-guards are not
re-wired), though the returned controller's `isOpen()`/`open()`/`close()`/`toggle()` still work
correctly since they read/write the live DOM rather than cached state.

## Human interface design

- **Default state: collapsed** (`defaultOpen: false` at all three call sites) — user-confirmed
  decision; see [MRD.md](MRD.md).
- **No state persistence** — user-confirmed decision; see [MRD.md](MRD.md).
- **Chevron**: `∨` (collapsed, click to expand) / `∧` (expanded, click to collapse) — rendered
  purely by CSS off the native `[open]` attribute, no JS state duplication.

## Components (Files)

- `src/component/disclosure/disclosure.ts` — `mountDisclosure()`, types, `DisclosureController`.
- `src/component/disclosure/disclosure.css` — `.disclosure`/`.disclosure-summary`/
  `.disclosure-title`/`.disclosure-chevron`/`.disclosure-content` rules.
- `src/shared/window.html` — the three `<details id="debug_disclosure">`/`#discovery_disclosure`/
  `#rtsp_disclosure"` panels, plus the `<link rel="stylesheet" href="css/disclosure.css">` tag.
- `src/shared/window.ts` — the three `mountDisclosure()` calls in the `DOMContentLoaded` setup
  block, next to the existing `use_debug`/`clear_debug` wiring.
- `scripts/build.js` — `copySharedWebAssets()` copies `disclosure.css` into both `dist/` outputs'
  `css/` directory, same as `switch.css`.
