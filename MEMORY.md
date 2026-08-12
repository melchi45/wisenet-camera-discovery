# Project memory

A log of non-obvious decisions and history for this repo — things that aren't visible just from
reading the code, kept here so future contributors (human or AI) don't have to rediscover them.

## jQuery + DataTables removal from window.ts

`window.ts` (the Chrome extension's main UI) originally loaded jQuery, DataTables, vis.js,
moment, and moment-timezone as separate `<script>` tags and used jQuery throughout (~563 call
sites). Removed entirely — vanilla DOM APIs everywhere, and a small purpose-built table
(search/sort/scroll/selection/dedup-add) in place of DataTables (DataTables itself required
jQuery).

Migration approach: a Node.js script did a two-pass regex conversion (id-based selectors →
`document.getElementById()`, then per-method-shape rewrites — `.val()`→`.value`,
`.attr()`→property assignment, `.on()`→`addEventListener`, etc.), applied to a scratch copy
first and diff-reviewed before touching the real file. The remaining irregular call sites (about
75 of ~940 total) were fixed by hand, using `tsc`'s shrinking error count as the checklist — each
`TS2339` pinpointed exactly one leftover jQuery-shaped call.

**Why bulk-regex first rather than one giant manual rewrite**: 563 sites across a 3,000-line file
would be unreviewable as a single diff and easy to introduce a silent behavior change in. The
regex pass handled the ~85% that followed a small number of mechanical patterns exactly; the
long tail of inline functions, multi-statement chains, and `$(this)` contexts needed human
judgment anyway.

## The `#broadcast`/`#usegmttime` cascading-failure bug

After the jQuery removal above, a user report ("selecting a discovered camera doesn't populate
the control panel; Play/Use SUNAPI/Light Mode don't work either") turned out to have one root
cause: `window.html` never had an element with `id="broadcast"` or `id="usegmttime"` (both
pre-existing, dating to the original migration commit — verified via `git log -p`). jQuery's
`$("#missing-id").click(fn)` is a silent no-op on an empty selection; the vanilla
`document.getElementById("broadcast").addEventListener(...)` throws `TypeError: Cannot read
properties of null` instead.

That throw happened at the very top of the first `DOMContentLoaded` handler — a synchronous
exception there aborted the *entire* handler, so none of the code after it ever ran: the
`<option>` never got appended to the dynamically-created player-list `<select>`, none of the
`rtsp-over-websocket` forEach loop's listener registrations happened (Play/Use SUNAPI/Light Mode
buttons), and `selected_player_id` stayed `null` forever, making `getSelectedPlayer()` always
return `null`. The discovery-table row-click handler then threw on its own first
`getSelectedPlayer().isplay` access, before ever reaching the code that fills in the hostname/
port fields.

**Fix**: wrapped both call sites in `document.getElementById(id) !== null` guards, restoring the
original silent-no-op behavior rather than deciding whether a Broadcast button or a
`usegmttime` field should actually exist (that's a separate, pre-existing product question, not
something this fix should relitigate).

**How this was actually diagnosed** (no real browser available in the sandbox that found it):
diffed every `getElementById("...")` argument in `window.ts` against every `id="..."` in
`window.html` to find genuinely-missing IDs, then ran the compiled `window.js` inside `jsdom`
(with `chrome`/`socket`/`moment`/`vis` stubbed) to get a real stack trace pointing at the exact
line. This diff-and-execute approach is worth repeating for any future "everything broke at
once" report in a jQuery-to-vanilla migration — jQuery's safety net makes missing elements
invisible until removed.

## Vite bundling: `this`-binding breaks under real ES modules

Introducing Vite to bundle `window.ts` (+ `vis`/`moment`/`moment-timezone`, replacing separate
`<script>` tags) required switching from a classic script compile (`module: "none"`) to a real
ES module (`module: "ESNext"`). One function, `initSunapiManager` (a top-level arrow function),
used `this.device.xxx` throughout — under the old classic-script compile, top-level `this` was
`window`, and `window.device` happened to be the exact same object as the file's own top-level
`var device = {...}` (classic-script top-level `var`s become `window` properties). Under real ES
module semantics, top-level `this` is `undefined`, so `this.device` would throw at runtime.
Fixed by referencing the module-scoped `device` variable directly (already in scope via
closure) — the faithful equivalent, not a behavior change, but a real bug that only a working
build (not `tsc --noEmit`, which doesn't care about `this`'s runtime value) would have caught.

Also found by the same migration: literal `window.addDiscoveredDeviceRow`-style expectations —
anything relying on classic-script global leakage (a function becoming a `window.*` property
just by being declared at top level) silently stops working once Vite wraps everything in an
IIFE closure. Audited for this: the only genuine case was one dynamically-created `<select>`'s
inline `onchange="on_player_select()"` HTML attribute string, converted to a real
`addEventListener('change', on_player_select)` call instead of trying to re-expose the function
globally.

## `@melchi45/rtsp-over-websocket` stays un-bundled

Deliberately kept as a separate `<script type="module">` tag rather than folded into the Vite
bundle above. The sibling `rtsp-over-websocket` repo's own `vite.config.ts` has a documented,
previously-shipped bug: Vite's default handling of asset references inside Worker chunks
base64-inlines them as `data:` URLs regardless of `assetsInlineLimit`, which this extension's
`script-src 'self' 'wasm-unsafe-eval'` CSP rejects outright. Re-bundling the already-built ESM
output risks Vite re-analyzing and re-triggering the exact same inlining, for a purely cosmetic
"one fewer script tag" win — not worth the risk.

## `src/shared/`: one `window.html`/`window.ts` for both the extension and the nodejs example

The nodejs package's example server (`src/nodejs/examples/`) originally had its own 102-line
throwaway static page. Deleted, and replaced with the same `window.html`/`window.ts` the Chrome
extension uses (`src/shared/`, copied into both `dist/` outputs at build time) — see
[docs/architecture.md](docs/architecture.md) for the full design.

This was a deliberate choice of the *larger* option over a smaller, lower-risk alternative: the
scoping discussion considered extracting just the discovery-table component (search/sort/
selection) into a shared module, leaving the nodejs example on its own minimal page. Full-page
sharing was chosen instead, on the reasoning that both sides already parse the identical raw
SUNAPI device shape (`src/sunapi/response.ts`), making the transport (native messaging host vs.
WebSocket) the only real gap to bridge — see `socket.ts`'s `IS_EXTENSION` branch. The tradeoff
accepted along with this: `src/nodejs/package.json` has no `"files"` allowlist, so the ~1.5MB
Vite bundle is now part of what `npm publish` would ship under `examples/` — acceptable since
that directory is explicitly "reference, not production" per its own docstring.

The nodejs example server also gained real persistent state it didn't have before (a
`knownDevices` cache and a background auto-discovery loop, mirroring `background.ts`'s role for
the extension) — a second deliberate scope decision (full auto-discovery parity, not just
manual "Start Discovery"), made for the same reason: matching the extension's actual behavior
mattered more here than keeping the example minimal.
