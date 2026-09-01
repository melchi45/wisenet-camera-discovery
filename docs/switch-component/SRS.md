# SRS — Switch Component

| | |
|---|---|
| Title | Switch Component — Software Requirements Specification (SRS) |
| Abstract | Functional and non-functional requirements for `mountSwitch()`'s option config, variants, and enhancement-target detection. |
| Status | Implemented |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [PRD](PRD.md) · [MRD](MRD.md) · [DESIGN](DESIGN.md) · [TC](TC.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-28 | Youngho Kim | Split out of the original single-file `docs/switch-component.md`; added Title/Abstract/Author/Milestone/History metadata. |
| 1.1 | 2026-08-31 | Youngho Kim | Added FR-12: a disabled-radio visual style for the segmented radio-group target — needed by `device.ts` locking the HTTP/HTTPS toggle to the page's own protocol outside the extension (`docs/window-ui/SRS.md`). No `MountSwitchOptions` API change; the caller disables the native input(s) directly. |

## Interface

```ts
export interface SwitchOptionConfig {
  value: string;       // checkbox: options[0]=unchecked, options[1]=checked.
                         // radio group: must match a radio's `value` attribute.
                         // button group: must match a button's `data-value` attribute.
  label?: string;        // visible text (also the accessible name in dot mode)
  dot?: boolean;          // render a colored dot instead of the label text
  dotColor?: string;      // CSS color for the dot; defaults to var(--accent)
}

export type SwitchVariant = 'slider' | 'segmented';

export interface MountSwitchOptions {
  containerId: string;                // id of the EXISTING wrapper element to enhance
  variant?: SwitchVariant;             // 'slider' (checkbox only, 2 options) | 'segmented' (default)
  options: SwitchOptionConfig[];       // 2 = On|Off or Text1|Text2, 3+ = N-way
  onChange?: (value: string) => void;  // fires on user interaction only, not on setValue()
}

export interface SwitchController {
  getValue(): string;
  setValue(value: string): void;  // does not fire onChange, same as assigning .checked/.value directly
  destroy(): void;                 // best-effort; see DESIGN.md
}

export function mountSwitch(config: MountSwitchOptions): SwitchController;
```

## Functional requirements

- **FR-1 (basic On|Off)**: `options` of length 2, default labels `"Off"`/`"On"` when `label` is
  omitted, `variant: 'slider'` for the classic knob look or `variant: 'segmented'` for the pill
  look.
- **FR-2 (Text1|Text2)**: `options` of length 2 with custom `label`s (e.g.
  `{value:'http',label:'HTTP'}`/`{value:'https',label:'HTTPS'}`), `variant: 'segmented'` — a
  checkbox target is inherently 2-state, so this is the same code path as FR-1, only the labels/
  values differ.
- **FR-3 (N-way)**: any `options` array of length 3+, `variant: 'segmented'` only — a checkbox
  target (FR-1/FR-2) rejects more than 2 options (see FR-7); a radio group or button group is
  required for 3+.
- **FR-4 (dot mode)**: `dot: true` on any option renders a small colored circle (`dotColor`,
  default `var(--accent)`) instead of the option's `label` text; `label`, if given, is still used
  as the dot's `title`/`aria-label`.
- **FR-5 (checkbox enhancement target)**: a container holding a single `<input type="checkbox">` is
  enhanced as a 2-state switch — `options[0]` = unchecked, `options[1]` = checked.
- **FR-6 (radio-group enhancement target)**: a container holding 2+ `<input type="radio">` sharing a
  `name` is enhanced as an N-state switch — each radio is matched to an `options[]` entry by its
  `value` attribute; an existing `<label for="radioId">` is reused if present, otherwise created.
- **FR-7 (button-group enhancement target)**: a container holding 2+ `<button>` is enhanced as an
  N-state switch — each button is matched to an `options[]` entry by its `data-value` attribute;
  state is tracked via a `.active` class plus `aria-selected`, same mechanism the pre-existing
  timeline-range toggle already used.
- **FR-8 (validation)**: `mountSwitch()` throws if `options.length < 2`; if the enhancement target
  is a checkbox and `options.length !== 2`; or if `variant: 'slider'` is requested against a
  non-checkbox target.
- **FR-9 (idempotency)**: a second `mountSwitch()` call for the same `containerId` is a no-op past
  the DOM-enhancement step (guarded by `data-switch-mounted`) — see [DESIGN.md](DESIGN.md).
- **FR-10 (no markup generation)**: `mountSwitch()` never creates the native input(s)/button(s)
  themselves — only sibling label/knob elements and CSS classes around whatever already exists in
  `containerId` — see [DESIGN.md](DESIGN.md).
- **FR-11 (`setValue()` is silent)**: `SwitchController.setValue()` writes the underlying DOM state
  directly and does not fire `onChange` — matches assigning `.checked`/`.value` on a native input
  directly, never a synthetic user interaction.
- **FR-12 (disabled radio options, v1.1)**: for a radio-group target (FR-6), setting `.disabled =
  true` on the underlying `<input type="radio">`s natively prevents toggling (the radio is
  `display: none`, so this has no visual effect on its own without the option below) and is styled
  the same as this codebase's existing disabled-button look (`--button-disable-color`/
  `--button-disable-font-color`, not a new palette) via
  `.ws-switch--segmented input:disabled + .ws-switch-option`. There is no `MountSwitchOptions` flag
  for this — the caller disables the native input(s) directly, the same way it would on any other
  native form control; `mountSwitch()` doesn't need to know about it. Not implemented for the
  checkbox or button-group enhancement targets (no current caller needs it there).

## Non-functional requirements

- **NFR-1 (accessibility — button-group)**: `role="tablist"`/`role="tab"`/`aria-selected` preserved,
  matching the pre-existing timeline-range toggle.
- **NFR-2 (accessibility — checkbox/radio)**: real `<label for="...">` elements provide native
  label/control association.
- **NFR-3 (accessibility — dot mode)**: a dot-mode option is never text-only in the accessibility
  tree — its `aria-label`/`title` is always set from `label` (or the option's raw `value` as a
  fallback).
- **NFR-4 (theming)**: `switch.css` reuses `window.css`'s `--accent`/`--surface`/`--border-color-
  strong`/etc. custom properties and defines no colors of its own, so a switch always matches the
  page's current light/dark theme.
- **NFR-5 (no new dependency)**: pure DOM APIs, no new `package.json` dependency.
