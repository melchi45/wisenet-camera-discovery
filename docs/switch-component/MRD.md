# MRD — Switch Component

| | |
|---|---|
| Title | Switch Component — Market Requirements Document (MRD) |
| Abstract | Why `window.html`'s switch-looking controls needed unifying, and the three implementation shapes considered for the replacement. |
| Status | Implemented |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [PRD](PRD.md) · [SRS](SRS.md) · [DESIGN](DESIGN.md) · [TC](TC.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-28 | Youngho Kim | Split out of the original single-file `docs/switch-component.md` into the MRD/PRD/SRS/DESIGN/TC set, matching `docs/star-topology/`/`docs/native-https-proxy/`'s convention; added Title/Abstract/Author/Milestone/History metadata. |

## Market context

`window.html`/`window.ts` had five switch-looking controls (dark mode, HTTP/HTTPS, Live/Playback,
the Playback 1 Day/3 Month range, SUNAPI On/Off) built on **three unrelated mechanisms** that only
happened to look alike:

| Control | Old mechanism |
|---|---|
| `#toggle` (dark mode) | iOS-style knob, `.theme-switch`/`.slider` CSS, plain checkbox |
| `#http_radio`/`#https_radio` | 2 `<input type="radio">`, `.segmented-toggle` pill CSS, static markup |
| `#live_radio`/`#playback_radio` | 2 `<input type="radio">`, same `.segmented-toggle` pill CSS as HTTP/HTTPS |
| `#search_timeline_range_oneday`/`threemonth` | 2 `<button>`, `.active` class toggled by JS, no native input at all |
| `#use_sunapi_client_checkbox` | 1 checkbox, progressively enhanced by `segmentedToggle.ts`'s `mountSegmentedCheckboxToggle()` |

None of the three mechanisms offered a way to configure a 3+-option switch or render a dot instead
of text, and there was no single place to read "how does a switch work here" from — a maintainer
touching a fourth switch would have had to pick one of three existing patterns to copy, or invent a
fourth. This is what motivated a single reusable component.

## Alternatives considered

| Approach | Why it was or wasn't chosen |
|---|---|
| **A custom element** (`<ws-switch>`, `customElements.define`) | Declarative and self-contained, but a custom element normally owns and generates its own markup — adopting it would have meant rewriting every one of `window.ts`'s ~35 existing `.checked`/`:checked`/`classList.contains("active")` read/write call sites across the 5 controls to go through a new element API instead. Rejected for the migration-risk cost. |
| **A config-driven full-render function** (`renderSwitch(container, config): HTMLElement`) | Same underlying problem as the custom element: generating fresh markup from a config object means the existing ids/names the ~35 call sites depend on would either need to be threaded through as more config, or those call sites would need to change to read the new function's return value instead. Rejected for the same reason. |
| **A progressive-enhancement function** (chosen) | Mirrors what `segmentedToggle.ts` already did for its one case (the SUNAPI checkbox): enhance whatever's already in the container rather than generate new markup. Every original id/name/value attribute survives untouched, so all ~35 call sites needed **zero** changes. Lowest integration risk of the three, and the user explicitly chose this approach for that reason. |

## Why full migration, not just new call sites

The alternative to migrating all 5 existing switches was to build the new component for *future*
switches only, leaving the 3 old mechanisms in place. Rejected: the whole point of unifying was to
have exactly **one** switch mechanism in this codebase going forward, not four (three old + one
new) — the user explicitly chose full migration, accepting the resulting `window.html`/`window.css`
churn in exchange for that outcome. See `MEMORY.md`'s entry on this component for the fuller
reasoning, including a 5th control (`#play_type_toggle`, Live/Playback) found mid-migration that
wasn't in the original 4-control ask but had to be migrated too — it shared the exact CSS classes
being retired, so leaving it behind would have silently broken its styling.
