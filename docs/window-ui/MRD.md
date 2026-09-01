# MRD — Window UI Full Specification & Reimplementation

| | |
|---|---|
| Title | Window UI Full Specification & Reimplementation — Market Requirements Document (MRD) |
| Abstract | Why a complete from-scratch spec and parallel reimplementation of `window.html`/`window.ts` was undertaken, and the alternatives considered. |
| Status | Draft |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [PRD](PRD.md) · [SRS](SRS.md) · [DESIGN](DESIGN.md) · [TC](TC.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-28 | Youngho Kim | Initial MRD. |
| 1.1 | 2026-08-28 | Youngho Kim | Reversed "Why a parallel implementation, not an in-place rewrite" below: per explicit user instruction, `npm run build:shared-v2` now overwrites `dist/chrome-extension/`/`dist/nodejs/`'s shared web assets after `npm run build` runs — see [PRD.md](PRD.md)'s Non-Goals and `scripts/build.js`'s `buildSharedV2()`. |

## Market context

`src/shared/window.html`/`window.ts` is this repo's entire Chrome-extension/nodejs-example-server
UI — one HTML file and one ~3,700-line TypeScript file that has grown organically since before this
repo's `git` history begins (`MEMORY.md`'s jQuery-removal entry is the earliest recorded
archaeology on it). Several earlier docs in this repo already spec *pieces* of it in depth
(`docs/control-panel-data-binding.md`'s 4 data-binding triggers, `docs/star-topology/`'s discovery
view, `docs/switch-component/`/`docs/disclosure-component/`'s two extracted UI components), but no
single document has ever described the file's full control surface. A complete, systematic read of
both files (see this conversation's Explore-agent inventory, the direct source for `SRS.md`) found
that this gap wasn't just a documentation gap: it surfaced **real, previously-undocumented dead
controls** — buttons with no click handler, `onclick="fn()"` attributes referencing functions that
don't exist anywhere in the repository (`mediaRecordStop()`, `instantplayback_play()`,
`useWaitIcon()`, etc.), fields that are written but never read. None of this was visible without
reading the entire file end to end.

## Alternatives considered

| Approach | Why it was or wasn't chosen |
|---|---|
| **Keep documenting incrementally, feature by feature** (the pattern every prior doc in this repo followed) | Lower effort, but never produces a complete picture — each doc only covers what someone happened to be touching that session, and (as this pass found) dead controls specifically only surface by reading *everything*, not by following a task's own scope. |
| **A full SDD covering every control, with no reimplementation** | Would close the documentation gap alone, but the user explicitly wants the spec's completeness *proven* by an independent implementation passing the same tests — a doc nobody has to satisfy can drift from reality silently, the same failure mode this MRD's own trigger describes. |
| **Full SDD + a genuinely new implementation, verified equivalent via Playwright (chosen)** | The reimplementation is the actual test of the spec's completeness: any FR the SRS got wrong or omitted shows up as a real, observable test failure against the original page, not just a documentation review. See [PRD.md](PRD.md)'s Success Criteria. |

## Why a parallel implementation, not an in-place rewrite

`src/shared/window.html`/`window.ts` is live, shipping code — both `dist/chrome-extension/` and
`dist/nodejs/` build from it today. Rewriting `src/shared/` itself, in place, before the
spec/reimplementation had been validated against it would have risked shipping regressions with no
fallback. `src/shared-v2/` (see [DESIGN.md](DESIGN.md)) was therefore built and tested as a
separate source tree alongside the original, so validating it never put the existing product at
risk.

**Update (v1.1):** once `src/shared-v2/` reached feature parity plus the new Calendar flow
(`SRS.md` FR-7.8) and its own equivalence-test coverage, the user explicitly asked for the
*build output* to converge: `npm run build:shared-v2`, run after `npm run build`, now overwrites
`dist/chrome-extension/`'s and `dist/nodejs/examples/public/`'s `window.html`/`window.js`/
`scripts/socket.js` (and adds `css/calendar.css`) with the `src/shared-v2/` build — see
[PRD.md](PRD.md)'s Non-Goals and `scripts/build.js`'s `buildSharedV2()`. The *source* separation
above (why `src/shared-v2/` is a distinct tree, not an in-place rewrite of `src/shared/`) still
holds; only the shipped-output relationship changed, from "never wired in" to "overwrites after a
successful `npm run build`."
