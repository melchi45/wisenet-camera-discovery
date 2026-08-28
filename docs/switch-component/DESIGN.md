# DESIGN — Switch Component

| | |
|---|---|
| Title | Switch Component — Design Document |
| Abstract | Enhancement-target detection logic, the `containerId`-scoping bug found in review, CSS specificity handling, and the full migration mapping for all 5 pre-existing switches. |
| Status | Implemented |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [PRD](PRD.md) · [MRD](MRD.md) · [SRS](SRS.md) · [TC](TC.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-28 | Youngho Kim | Split out of the original single-file `docs/switch-component.md`; added Title/Abstract/Author/Milestone/History metadata. |

## Enhancement-target detection

`mountSwitch()` never generates a native `<input>`/`<button>` from scratch — it only enhances
whatever is **already** inside `containerId`, detecting one of three shapes (SRS FR-5/FR-6/FR-7):

1. **A single `<input type="checkbox">`** → 2-state only. `variant: 'slider'` adds a
   `.ws-switch-knob` div (or reuses one already present) and nothing else — the checkbox's native
   appearance is hidden and the knob's `:checked` CSS does the rest. `variant: 'segmented'` inserts
   two `<label for="checkboxId">` siblings after the checkbox (`.ws-switch-option-off` then
   `.ws-switch-option-on`, in that DOM order — a deliberate, harmless visual-order change from the
   old `mountSegmentedCheckboxToggle()`, which rendered On before Off).
2. **2+ `<input type="radio">` sharing a `name`** → N-state, matched by `value` attribute.
3. **2+ `<button>`** → N-state, matched by `data-value` attribute.

This is why every pre-existing `document.getElementById(id).checked` /
`querySelector('input[name="..."]:checked')` / `classList.contains("active")` call site elsewhere
in `window.ts` keeps working completely unchanged after migration — the original id/name/value
attributes are never touched, only sibling label/knob elements and CSS classes are added around
them.

## `containerId` scoping — the bug found in review

**`containerId` must point at a wrapper that holds *only* the switch's own input(s)/button(s)** —
nothing else. `variant: 'segmented'`'s pill styling (`border`/`border-radius: 999px`/`overflow:
hidden`) applies to the whole container, so an unrelated sibling inside the same element (e.g. a
field-name `<label>`) gets wrapped into the pill's rounded border too, breaking the visual.

This was exactly the SUNAPI On/Off bug found in review: it was first pointed at `#sunapi_info`,
which also held the `SUNAPI:` field-name label as a sibling of the checkbox, producing a visibly
broken pill (rendered as two disjoint boxes instead of one clean pill) once the page was actually
screenshotted — not visible from reading the markup/JS alone. Fixed by giving the checkbox its own
dedicated `<div id="sunapi_toggle">` inside `#sunapi_info`, mirroring how `#http_type_toggle`/
`#play_type_toggle` were already separate from their own field-name labels. See `MEMORY.md`'s entry
on this component for the fuller incident writeup.

## Idempotency and `destroy()`

**Idempotent**: guarded by a `data-switch-mounted` attribute on the container (same guard
`segmentedToggle.ts` used), so calling `mountSwitch()` twice for the same `containerId` is a no-op
past the first call (SRS FR-9). Note the second call's own `onChange` is **not** wired in that case
— only the first mount's listeners are attached; `getValue()`/`setValue()` still work correctly on
any subsequent controller returned, since they read/write the live DOM rather than cached state.

**`destroy()` is best-effort** — it only clears the mounted guard; no listener teardown is
performed, since nothing in this codebase currently unmounts a switch (all five are mounted once at
`DOMContentLoaded` and live for the page's lifetime).

## Migration: the 5 existing switches

| Control | `window.html` | `mountSwitch()` call | Existing `window.ts` call sites affected |
|---|---|---|---|
| Dark mode `#toggle` | `<label id="theme_switch" for="toggle">` wrapping `<input type="checkbox" id="toggle" checked>` | `mountSwitch({containerId:'theme_switch', variant:'slider', options:[{value:'light'},{value:'dark'}]})` | None — `changedarkmode`'s own `addEventListener("change", ...)` on `#toggle` is untouched. |
| HTTP/HTTPS `#http_type_toggle` | radios/ids/`value` attrs unchanged, old `.segmented-toggle*` classes dropped (`mountSwitch()` adds `.ws-switch*` at mount time) | `mountSwitch({containerId:'http_type_toggle', variant:'segmented', options:[{value:'http',label:'HTTP'},{value:'https',label:'HTTPS'}]})` | None — `changehttptype`/`onchangehttptype`/`onchangeprotocol`/`applyDiscoveredDeviceSelection`/the device-connect flow all keep reading/writing the same radios. |
| Live/Playback `#play_type_toggle` | same treatment as HTTP/HTTPS | `mountSwitch({containerId:'play_type_toggle', variant:'segmented', options:[{value:'live',label:'Live'},{value:'playback',label:'Playback'}]})` | None — `onchangeplaytype` and the other `name="play_type"` `:checked` reads are untouched. |
| SUNAPI On/Off `#sunapi_toggle` | checkbox wrapped in a dedicated `<div id="sunapi_toggle">` inside `#sunapi_info`, separate from the sibling `SUNAPI:` field-name label (see "`containerId` scoping" above) | `mountSwitch({containerId:'sunapi_toggle', variant:'segmented', options:[{value:'off',label:'Off'},{value:'on',label:'On'}]})` replaces `mountSegmentedCheckboxToggle({checkboxId:'use_sunapi_client_checkbox'})` | None — `on_change_use_sunapi_client`/`initSunapiManager`/`applyDiscoveredDeviceSelection` etc. keep reading/writing `#use_sunapi_client_checkbox.checked`. |
| Timeline range `#search_timeline_range_toggle` | buttons gain `data-value="oneday"`/`"threemonth"` (replacing the unused `data-range`), hardcoded `active`/`aria-selected` dropped (mount defaults the first option active) | `mountSwitch({containerId:'search_timeline_range_toggle', variant:'segmented', options:[{value:'oneday',label:'1 Day'},{value:'threemonth',label:'3 Month'}]})` replaces the two manual click listeners; the controller is kept in the module-level `timelineRangeSwitch` var | The now-dead `setTimelineSearchRange()` wrapper was deleted; `search_timeline_by_range()` reads `timelineRangeSwitch.getValue() === 'threemonth'` instead of `classList.contains("active")`. |

No behavior change to dark-mode persistence — there wasn't any before this component either;
`#toggle` still resets to its HTML default (`checked`, i.e. dark) on every page load.

## Style

- `src/component/switch/switch.css` defines every `.ws-switch*` class; it reuses `window.css`'s
  `--accent`/`--surface`/`--border-color-strong`/etc. custom properties and defines no colors of its
  own, so a switch always matches the page's current light/dark theme automatically (SRS NFR-4).
- **CSS specificity gotcha, carried over from the old `.segmented-toggle-option`**: every option
  rule is written as `.ws-switch .ws-switch-option` (specificity 0,2,0), not a bare
  `.ws-switch-option` (0,1,0) — `window.css`'s `.field label { font-size: 1.2rem; color:
  var(--text-muted); }` rule (0,1,1) would otherwise outrank a bare class selector and silently
  revert the option's font-size/color on any `<label>`-based switch nested inside a `.field` div.
  Keep this compound-selector shape when adding new rules here.
- Class reference: `.ws-switch` (base, always present) + exactly one of `.ws-switch--slider` /
  `.ws-switch--segmented` (variant) on the container; `.ws-switch-input` on the enhanced native
  input; `.ws-switch-knob` (slider variant only); `.ws-switch-option` (+ `.ws-switch-option-off`/
  `.ws-switch-option-on` for the checkbox-driven segmented case) on each label/button;
  `.ws-switch-dot` on a dot-mode option's indicator span (colored via the `--ws-switch-dot-color`
  custom property, set inline per-option from `dotColor`).

## Alternatives rejected

See [MRD.md](MRD.md)'s "Alternatives considered" — the custom-element and config-driven full-render
approaches were rejected there at the market/strategy level; this section is the pointer, not a
duplicate.

## Components (Files)

- `src/component/switch/switch.ts` — `mountSwitch()`, types, `SwitchController`.
- `src/component/switch/switch.css` — all `.ws-switch*` rules.
- `src/shared/window.html` — the 5 enhanced containers (`#theme_switch`, `#http_type_toggle`,
  `#play_type_toggle`, `#sunapi_toggle`, `#search_timeline_range_toggle`) plus the `<link
  rel="stylesheet" href="css/switch.css">` tag.
- `src/shared/window.ts` — the 5 `mountSwitch()` calls in the `DOMContentLoaded` setup block, plus
  `search_timeline_by_range()` reading through the timeline-range switch's controller.
- `scripts/build.js` — `copySharedWebAssets()` copies `switch.css` into both `dist/` outputs' `css/`
  directory, same as the other shared CSS files.
