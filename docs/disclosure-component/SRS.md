# SRS — Disclosure Component

| | |
|---|---|
| Title | Disclosure Component — Software Requirements Specification (SRS) |
| Abstract | Functional and non-functional requirements for `mountDisclosure()`, derived from the original SDD's requirements-traceability table. |
| Status | Implemented |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [PRD](PRD.md) · [MRD](MRD.md) · [DESIGN](DESIGN.md) · [TC](TC.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-28 | Youngho Kim | Split out of the original single-file `docs/disclosure-component.md` (its §2 "Requirements traceability" table); added Title/Abstract/Author/Milestone/History metadata. |

## Definitions

- **Disclosure**: the WAI-ARIA "Disclosure (Show/Hide)" pattern — a control (here, a header) that
  reveals or hides a section of content, with a visible open/closed indicator.
- **Header controls**: interactive elements (a checkbox, a button) placed inside the disclosure's
  clickable header, alongside the title — e.g. Debug Information's "Use" checkbox and "Clear"
  button.

## Interface

```ts
export interface MountDisclosureOptions {
  containerId: string;                 // id of the existing <details> element
  defaultOpen?: boolean;                // default false (collapsed)
  headerCheckboxId?: string;             // id of an existing checkbox inside <summary>
  headerButtonId?: string;                // id of an existing <button> inside <summary>
  onToggle?: (open: boolean) => void;     // fires on the native 'toggle' event
}

export interface DisclosureController {
  isOpen(): boolean;
  open(): void;
  close(): void;
  toggle(): void;
}

export function mountDisclosure(config: MountDisclosureOptions): DisclosureController;
```

## Functional requirements

- **FR-1**: Debug Information/Discovery/RTSP each get a ∧∨ show/hide control, implemented as a
  native `<details>`/`<summary>` element per panel.
- **FR-2**: Debug Information's "Use"/"Clear" controls remain usable, passed as
  `headerCheckboxId`/`headerButtonId` config rather than hardcoded to that one panel.
- **FR-3**: All three panels start collapsed — `defaultOpen: false` at every call site.
- **FR-4**: Collapsed/expanded state is not persisted across reloads — no `localStorage`/
  `chrome.storage` read/write anywhere in this component.
- **FR-5**: A header control named via `headerCheckboxId`/`headerButtonId` does not toggle the
  disclosure when clicked — see [DESIGN.md](DESIGN.md) for the `<summary>`-click-bubbling problem
  and its fix.
- **FR-6**: `open()`/`close()`/`toggle()` set `details.open` directly and do **not** fire
  `onToggle` — matches assigning a native property directly, never a synthetic user interaction
  (same convention `src/component/switch/`'s `setValue()` uses).
- **FR-7 (idempotency)**: a second `mountDisclosure()` call for the same `containerId` is a no-op
  past the first call (guarded by `data-disclosure-mounted`) — its own `onToggle`/header-guards are
  not re-wired, though the returned controller's methods still work correctly.
- **FR-8 (no markup generation)**: `mountDisclosure()` never generates the `<details>`/`<summary>`/
  content markup — only sets the initial `open` state, guards the two optional header controls, and
  wires `onToggle`.

## Non-functional requirements

- **NFR-1 (keyboard accessibility)**: `<summary>` is keyboard-activatable (`Enter`/`Space`) for
  free, and `summary:focus-visible` gets the same accent-colored outline `window.css` already uses
  for every other interactive element.
- **NFR-2 (no new dependency)**: pure DOM APIs (native `<details>`/`<summary>`), no new
  `package.json` dependency.
- **NFR-3 (browser support)**: relies on evergreen Chrome/Edge support for `<details>`/`<summary>`,
  consistent with this extension's existing target (`README.md`).
