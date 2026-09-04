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

## Native-host HTTPS proxy for self-signed camera certificates

A camera/NVR's self-signed HTTPS certificate makes Chrome block the SUNAPI request with
`ERR_CERT_AUTHORITY_INVALID` before any extension code runs — full spec/design in
`docs/native-https-proxy/` (PRD/MRD/SRS/DESIGN/TC), summarized here for the non-obvious part of
*why* it's built the way it is.

**The feasibility question was "can we do this without forking the vendored
`@melchi45/rtsp-over-websocket` package or monkey-patching global `XMLHttpRequest`" — and the
answer turned out to be yes**: that package's `SunapiManager` class already exposes `attach()` /
`getSunapiClient()` for substituting its internal HTTP client with anything implementing a small
`SunapiClientLike` interface (confirmed against its shipped `.d.ts`, not just its minified
source). Every SUNAPI call except the very first (`SunapiManager.init()`'s own
`/stw-cgi/attributes.cgi` GET, which always constructs its own client internally and can't be
redirected via `attach()`) goes through that substitutable client already. So
`src/shared/scripts/nativeSunapiClient.ts` only has to replicate `init()`'s few lines of device
normalization for that first call — everything after is unmodified existing code. This is the kind
of "the library already has the seam you need, read the `.d.ts` before assuming you'd have to
fork it" finding worth remembering if a similar substitution need comes up elsewhere against this
same vendored package.

**Security tradeoff, made deliberately, not by default**: the new native-host `httpRequest`
command bypasses TLS certificate validation entirely (`rejectUnauthorized: false`) for whatever
URL it's given. Two things keep that from becoming a general-purpose vulnerability rather than a
narrow, opt-in feature: (1) the extension UI only offers it behind an unchecked-by-default
checkbox, per device/session — never automatic; (2) the native host itself refuses to proxy to
anything that isn't a literal RFC1918/loopback/link-local IP address, so even a compromised
`window.html` couldn't turn this into an arbitrary-URL TLS-bypass fetch. It's also deliberately
**not** wired into `background.ts`'s `onMessageExternal` handler (which already accepts messages
from other extensions/pages for discovery) — only `window.ts`'s own dedicated native port can
issue it.

**Real bug found against an actual device, fixed**: the first version of this feature had no
timeout anywhere in the request path — neither the native host's `https.request()` (Node's HTTP
clients have no default timeout) nor `NativeSunapiClient`'s own wait for a response. Against a
real camera, a stuck request (host process wedged, or a response that never arrives for any
reason) left `initSunapiManager()`'s promise chain pending forever: no console output, no popup,
indistinguishable from the checkbox silently doing nothing — very hard to diagnose from a bug
report alone, since "nothing happened" and "still loading" look identical to the user. Fixed with
two independent timeouts (native host: 15s on the HTTP request itself; `NativeSunapiClient`: 20s
on the whole round trip, covering a wedged host too) plus `console.debug`/`console.warn` logging
at each step, so the same failure now surfaces as a real, loggable error. Worth remembering for
any other feature that adds a native-messaging or cross-process round trip to this codebase:
**always add a client-side timeout independent of whatever timeout the far side claims to have**
— a promise with no timeout at all is a silent hang waiting to happen, and "no error, no popup, no
console output" is nearly impossible to distinguish from "still working" without one.

## `#usegmttime` cascading-failure bug, second occurrence: `updateTimeline()`

A second, previously-unfound instance of the same failure class as this file's
`#broadcast`/`#usegmttime` entry above: `updateTimeline()` (drives the recording timeline view)
called `document.querySelector('select[id="usegmttime"]').value` five times, unguarded, inside
its `if(!document.getElementById("use_gmt").checked)` branch. `#usegmttime` has never had a
corresponding element in `window.html` — same dead reference `on_player_select()` already guards
elsewhere — so this threw `TypeError: Cannot read properties of null (reading 'value')` on every
call where "Use timezone" was left unchecked (the common/default case).

**Why this one was harder to spot than the original**: the throw happens *after*
`visTimeline.setItems(items)` (so the timeline still renders and looks fine) but *before*
`visTimeline.on("click"/"select", ...)` are reached — so the visible symptom was "timeline draws
correctly, but clicking an entry does nothing at all," not an obvious crash. The exception then
propagated up through `updateTimeline()`'s caller (`search_oneday_timeline()`'s `.then()`
callback) and surfaced as a *rejected* promise, logged by the existing `.catch()` as `"getTimeline
error: {}"` — an empty object, because `fastJsonStringfy()` (a thin `JSON.stringify()` wrapper) is
useless on real `Error`/`DOMException` instances: V8 defines `.message`/`.name`/`.stack` as
non-enumerable, so `JSON.stringify(realError)` reliably yields `"{}"` regardless of what the error
actually is. That made an unrelated-looking "SUNAPI request failed" message the only visible trace
of what was actually a plain null-reference bug several layers away. Added `errorDetails()` (uses
`JSON.stringify(error, Object.getOwnPropertyNames(error))`) alongside `fastJsonStringfy()` for
future catch blocks that need to show what an Error-like value actually contains.

**Lesson for this codebase specifically**: a `document.getElementById("usegmttime") !== null`-style
guard at one call site does not mean every call site referencing that same dead id is safe — worth
grepping for `usegmttime` (and `broadcast`) repo-wide after any future window.ts change, not just
trusting that the original audit caught every occurrence.

## Native-host relay extended to the video streaming `wss://` connection

The native-host HTTPS proxy above only covered SUNAPI REST calls — `<rtsp-over-websocket>` opens
its *own* `wss://<camera>/StreamingServer` browser WebSocket directly for the actual video stream,
independently subject to the same TLS validation. Confirmed against a real device this needed its
own fix: `ws://` worked, `wss://` failed, and — surprisingly — registering a manual browser
certificate exception for the same host (the "visit `https://ip/` once and click through" trick
that already fixes plain page navigation and `fetch`/XHR) did **not** make the `wss://` connection
start working. Worth remembering: don't assume a browser TLS exception is scheme/API-universal for
a given host — it can cover regular HTTPS traffic while still leaving a WebSocket upgrade on the
same host failing, at least as observed here (root cause not confirmed, just the empirical result).

**Second `attach()`-style seam found, one layer lower**: `@melchi45/rtsp-over-websocket`'s
`Transport.createWebSocket(serverAddr)` (`src/player/network/transport/Transport.ts` in that
package's own source) is a `protected` method whose own doc comment already says *"Overridable
factory so tests can inject a fake socket instead of opening a real connection"* — and
`StreamPlayer`'s constructor already accepts an optional `transportFactory`, defaulting to
`(serverAddr) => new Transport(serverAddr)`. The only gap was that the custom element's `play()`
never threaded a `transportFactory` through to its internal `new StreamPlayer(...)` call. Unlike
the SUNAPI case, this one **did** need a small, additive change to the vendored package itself (a
`transportFactory` property on the element, mirroring `sunapiClient`'s existing getter/setter
pattern) — but still no fork of third-party code (it's the user's own package) and no
reimplementation of `Transport`'s RTSP/RTP interleaved-frame demultiplexing: `NativeTransport`
subclasses the real `Transport` and overrides only `createWebSocket()`.

**Vite-bundling trap avoided**: the natural way to reference `Transport` from the new
`nativeWebSocketTransport.ts` (Vite-bundled into `window.js`) would be a real `import { Transport }
from '@melchi45/rtsp-over-websocket'` — but that would pull real runtime code from the vendored
package into `window.js`'s bundle, risking exactly the Worker-asset re-inlining CSP break this
repo's "`@melchi45/rtsp-over-websocket` stays un-bundled" decision (see this file's earlier entry)
was written to avoid. Fixed by extending `legacy-globals-bridge.js` (already the established
pattern for `SunapiManager`/`SunapiError`/etc.) to also expose `window.Transport`, and declaring it
ambiently in `types/globals.d.ts` — `nativeWebSocketTransport.ts` subclasses the ambient global,
never importing the class as a real value. `import type { WebSocketLike, TransportFactory }` for
the *types* is fine and used freely — type-only imports are fully erased before Vite's bundler
ever runs, so they carry none of that re-inlining risk; only a value import does. Confirmed after
the fact by checking the built bundle for `ffmpeg`/`audiotranscoderWorker` strings (the real
player's own Worker/wasm asset references) — none present, so the real 2.4MB player build did not
get pulled in a second time.

## Two real bugs found testing the WSS relay against a real device

**`ReferenceError: Transport is not defined`, aborting all of window.js's setup (discovery
included)** — `nativeWebSocketTransport.ts`'s `NativeTransport` class was originally declared at
module top level: `class NativeTransport extends Transport { ... }`. A class's `extends` clause
evaluates immediately when the class statement itself runs, unlike a reference inside a method
body — and `window.js` (a classic, non-deferred script, so it runs as soon as the parser reaches
it) executes before `legacy-globals-bridge.js` (a deferred `<script type="module">`) has had a
chance to set `window.Transport`. So this threw the moment `window.js` loaded, aborting everything
after it — same failure class as this file's `#broadcast`/`#usegmttime` entries above, just via a
class declaration's `extends` clause instead of a top-level `document.getElementById(...)` call.
`nativeSunapiClient.ts` avoided this by only ever referencing its ambient global
(`SunapiError`) *inside a method body* (`initDevice()`), which only runs later, well after both
deferred scripts finish — `nativeWebSocketTransport.ts` broke that same discipline by putting a
class *declaration* (not just a reference) at module scope. Fixed by moving the class declaration
inside `createNativeTransportFactory()` itself, so `extends Transport` only evaluates when that
function is actually called (from `initSunapiManager()`, long after page load). **Lesson**: when a
value can only safely be referenced after deferred scripts finish, that includes `extends
SomeAmbientGlobal` in a class declaration, not just plain reads of the global — both need to live
inside a function body that only runs later, not at module top level.

**`ffmpegAAC.decoder.js` → `net::ERR_FILE_NOT_FOUND`** — `scripts/build.js`'s vendor-asset copy
step hardcodes the list of `rtsp-over-websocket` files to copy out of `assets/` next to it
(`ffmpeg.js`/`.wasm`, `ffmpegAAC.transcoder.js`/`.wasm`, `minizip-asm.js` — see that function's own
comment on *why* they need to sit next to `assets/`, not inside it). `ffmpegAAC.decoder.js` exists
in the vendored package's own `dist/player/` output but was missing from this hardcoded list — a
stale allowlist that happened not to matter until something actually exercised the AAC decode path
this build. Added to the list. **Lesson**: this hardcoded-list pattern needs re-checking against
`node_modules/@melchi45/rtsp-over-websocket/dist/player/`'s actual file listing after any version
bump of that package, not just assumed to still be complete — `ls` that directory and diff against
the list in `scripts/build.js` when something like this comes up again.

## `socket.ts`: unhandled promise rejection flooding the console on every discovered device

`onDevice()` and `start()` both call `chrome.runtime.sendMessage(id, ...)` (no callback argument)
for each id in `socket.playerExtensionIds` — those are optional companion "player" extensions, so
not being installed is the *normal* case, not an error. Called with no callback, this API returns
a Promise that *rejects asynchronously* when no listener exists ("Could not establish connection.
Receiving end does not exist."). Both call sites wrapped this in a synchronous `try/catch`, which
does nothing for an async rejection — only a synchronous throw. The result: one unhandled
rejection per discovered device per configured player-extension id, logged as `Uncaught (in
promise) Error: ...` — at real-device volume (dozens of devices, repeated broadcasts) this was the
dominant source of console noise, at one point over 1,900 entries, which is itself what made
several of this file's other entries hard to diagnose (the real signal was buried under this).
`displayResult()`, two call sites away in the same file, already had the fix
(`sendResult.catch(function () {})`) — `onDevice()`/`start()` just never got the same treatment.
Fixed by applying the identical pattern to both.

**Lesson**: `try/catch` around a call that returns a Promise only catches a *synchronous* throw
from making that call, never the Promise's own eventual rejection — those need their own
`.catch()` (or `await` inside another try/catch), full stop, regardless of how much surrounding
error handling already exists. Worth checking any other `chrome.runtime.sendMessage(...)` /
`chrome.runtime.sendMessage(id, ...)` call sites the same way if this class of noise shows up
again — `grep -n "sendMessage(" src/shared/scripts/socket.ts src/shared/window.ts
src/chrome-extension/background.ts` to re-audit all of them at once.

## Discovery result "Star Topology" view: `vis.Network` was already bundled, no new dependency

Added a second view (alongside the existing table) for the discovery result list — a node-link
diagram, toggled via `#discovery_view_type` in `window.html`, rendered by
`renderDiscoveryTopology()` in `window.ts`. Two findings worth remembering:

**`vis.Network` needed zero new dependencies.** `package.json`'s `vis` package (the old
monolithic vis@4.x bundle) already ships `Timeline`, `DataSet`, *and* `Network` in one module;
`window.ts` only ever used the first two (`vis.Timeline` for the playback timeline). Since
`window.ts` already does `import * as vis from 'vis'`, Vite already bundles the whole module
regardless of which properties are accessed off it (property access on a wildcard import can't be
tree-shaken) — so `new vis.Network(...)` was reachable immediately, confirmed by the built
`build/shared/window.js` bundle size being unchanged before/after adding the topology code. Worth
checking what a `import * as X from 'pkg'`-style dependency actually contains before assuming a
new visualization/utility need requires a new package — this repo had already paid the bundle-size
cost for the whole `vis` library, just wasn't using all of it.

**No real parent/child device data exists to build a topology from.** SUNAPI UDP discovery
replies are a flat list — each camera/NVR reports itself once, with no field linking an NVR to its
attached camera channels (see `src/sunapi/response.ts`'s `toLegacyDeviceObject()`; the only
NVR-adjacent field, `nMaxChannel`, is a channel *count*, not per-channel identity, and isn't even
forwarded into `window.ts`'s `dataSet` today). So "topology" here is a client-side derived
grouping — hub node per `/24` subnet (`IPAddress`'s first 3 octets), each discovered device as a
leaf under its subnet's hub — not a reflection of actual network wiring. Hub nodes are
deliberately **not** connected to each other, to avoid implying a link that isn't real. If a future
ask wants genuine NVR→channel topology, that needs new data: per-NVR channel enumeration via a
SUNAPI call (the codebase already has a channel-list SUNAPI flow gated behind "Use SUNAPI" in the
Control panel, just not wired into the discovery list/dataSet).

**Follow-up: made grouping generic (`#discovery_topology_group_by`: Name/IP/MAC/Port/Protocol)
and wired the existing search box into the topology view.** Two more findings from that change,
worth keeping alongside the above:

**MAC address wire format confirmed colon-separated, not written down anywhere else in the repo.**
Needed for the new MAC-grouping option's OUI (first-3-octet) extraction. `src/sunapi/protocol.ts`'s
`FIELDS` table sizes `chMAC` at 18 bytes, a null-terminated wire string (`STRING_FIELDS`) — and
`"00:09:18:AB:CD:EF"` is exactly 17 characters plus a null terminator, i.e. the only format that
fits. Confirmed by field-sizing arithmetic, not by observing a real device reply — worth
re-verifying against an actual captured packet if a future change depends on this more critically
than a display-grouping key.

**Search filtering reuses the table's existing row-match predicate as-is, instead of writing a
second matching rule per `groupBy` type.** The ask was: typing a search prefix should show *every*
currently-matching hub at once (e.g. `"192."` spanning several `/24` hubs, or `"P"` while grouped
by Name spanning `"PNM"`/`"PNO"`/`"PND"`), not just the nearest/first one. The table's filter
(`renderDiscoveryTable()`: does any cell in a `dataSet` row contain the search text) already
produces exactly this once reused for the topology's leaf-inclusion test, *because every hub label
is itself derived from a literal substring of its leaves' own field values* — so a leaf-level
substring match automatically keeps every hub that should match, with no per-type prefix-parsing
logic needed on top. `visNetwork.fit()` after `setData()` then bounds the camera to whatever
combination of hubs/leaves survived the filter, one cluster or several, satisfying "filter and
zoom, together" without special-casing either count. Worth remembering as a general pattern: when
a new view needs to "search" the same underlying list a table already searches, check whether the
table's existing predicate already implies the new view's desired behavior before writing a
second, view-specific one.

**Second follow-up (superseded by the third, below — kept for the "don't repeat this" lesson):**
hovering a node looked like it was zooming in/out. First guess was that `vis.Network`'s default
per-node `chosen` behavior grows border width on hover (this old vis@4.20 build has no shipped
`.d.ts`, so guessing instead of reading types was the mistake). "Fixed" by
`options.nodes.chosen = false` plus manually swapping each node's `color` via
`hoverNode`/`blurNode` handlers calling `visNodesDataSet.update({id, color})`. **This made things
worse, not better**: reading the actual source
(`node_modules/vis/dist/vis.js`'s `Node.getFormattingValues()`) afterward showed the default
`chosen: true` hover path only ever swaps `values.color`/`values.borderColor` at *draw time* —
never touches border width, and never touches the `DataSet`. The `DataSet.update()` calls this
"fix" added were themselves a new source of churn: every hover/blur mutated the live `DataSet`,
which is exactly the kind of change that can perturb the physics engine (see third follow-up).
**Lesson**: for a vis-network version with no `.d.ts`, read `node_modules/.../dist/vis.js`
directly before hypothesizing about its default behavior — a wrong guess here didn't just fail to
fix the reported bug, it added a second one.

**Third follow-up, the real fix: the graph visibly "jumping" (nodes suddenly repositioning /
the camera suddenly zooming) was never about hover or click themselves — it was
`visNetwork.fit()` racing physics.** `renderDiscoveryTopology()` used to call `.fit()`
synchronously right after `setData()`, but `stabilization: {iterations: 150}` runs
asynchronously — on a real device count this can still be mid-flight when `.fit()` computes
bounds, especially on a search-triggered re-render (every render starts physics over from
scratch, since it's a brand-new `vis.DataSet` each time). The camera would lock onto the graph's
bounds while barnesHut was still actively moving nodes underneath it; the mismatch surfaced
whenever the canvas next redrew, most easily via a hover or click nudging a redraw, which read as
"hovering/clicking causes the jump" without either interaction actually being the cause. Fixed by
moving `.fit()` **into** the `stabilizationIterationsDone` handler (fires once physics has
actually finished moving nodes for the current data) instead of calling it unconditionally right
after `setData()`, and disabling physics there too (`physics: {enabled: false}`) so there's
nothing left running to drift out from under a settled camera. `stabilization.fit: false` in
`options.physics` stops vis's own built-in auto-fit-on-stabilize from also firing and duplicating/
racing this. Physics re-enables itself on the next `renderDiscoveryTopology()` call
(`options.physics` carries no `enabled: false` of its own, and `setOptions(options)` runs before
`setData()` on every render after the first), so this refires and re-freezes-in-sync after every
search/group-by/new-device update, not just the first render. **Lesson**: when an async layout
engine (physics, in this case) is involved, gate any one-time "now do X" call (fit, snapshot,
whatever) on the engine's own "I'm done" event — never on "I just called setData(), so it must be
ready by now."

**Fourth follow-up: after a search re-render, clicking still occasionally misbehaved (wrong
device selected).** `params.nodes` in vis-network's `click` event is resolved from hit-testing
done at click time against wherever nodes are positioned *then* — if a click lands while the
layout is still mid-stabilization (e.g. right after typing into the search box, before that
render's `stabilizationIterationsDone` has fired), several unrelated nodes can still be bunched
near their shared starting position, so `params.nodes[0]` isn't reliably "the node the user
actually clicked." Fixed by re-querying `visNetwork.getNodeAt(params.pointer.DOM)` inside the
handler — an authoritative, current-position hit-test — instead of trusting `params.nodes[0]`
as-is; `applyDiscoveredDeviceSelection()` only ever runs if that independently confirms a real
node id under the pointer. Confirmed with the user that this must not interfere with dragging (a
node, or the canvas itself to pan) — it doesn't, since drag/pan position updates in vis-network
are handled by the interaction/manipulation module directly from pointer deltas, entirely separate
from both the `click` event and the physics engine `stopSimulation()`/`enabled: false` calls in
the third follow-up above.

**Fifth follow-up, the actual fix: after a search re-render, *every* interaction was wrong —
hover, click, click-and-drag, all of it, not just the specific cases the third/fourth follow-ups
above targeted.** That breadth was the tell that the previous two fixes had been treating symptoms
of the same underlying problem rather than its cause: `renderDiscoveryTopology()` was reusing the
existing `vis.Network` instance across renders (`visNetwork.setOptions(options);
visNetwork.setData(data);` in an `else` branch, only constructing `new vis.Network(...)` the very
first time). Something about repeated `setData()` calls on the same long-lived instance left stale
internal state behind — most likely mouse/canvas coordinate handling, physics, or both, though
this old vis@4.20 build ships no changelog or `.d.ts` to confirm exactly what without a real
browser to instrument. Fixed by calling `visNetwork.destroy()` and setting `visNetwork = null`
before *every* render, then always constructing a fresh `new vis.Network(...)` (with the
`click`/`stabilizationIterationsDone` listeners re-registered each time, since they were
previously only attached once inside the `visNetwork === null` branch) — every render now starts
from the exact same known-good state the very first render always did, eliminating whatever the
stale-state mechanism was rather than continuing to chase individual symptoms of it. **Lesson**:
when several seemingly-different interaction bugs all share one precondition ("only after X"), stop
patching them one at a time — look for what X actually changes structurally (here: reusing one
long-lived widget instance across data updates) before trying a fourth narrower fix.

**Third follow-up (2026-09-01): `ip` grouping now nests hubs `/8`→`/16`→`/24` by real subnet
containment, deliberately breaking the "hub nodes are never linked to each other" rule from the
original entry above — but only for `ip`.** User request: `192.168.214.x` should visually nest
under a `192.168/16` hub, which should nest under a `192/8` hub, not sit as an unlinked flat `/24`
hub the way it always had. The original "never linked" design (see above, and SRS FR-7/PRD's
Non-Goals) was a deliberate call, not an oversight — its rationale was that grouping is a derived
convenience, not real topology, so linking hubs would misleadingly imply a real relationship that
doesn't exist. IP-subnet containment is the one case where that concern doesn't actually apply:
`/24` ⊂ `/16` ⊂ `/8` is a real, computable relationship read directly off the existing `/24` group
key (`"192.168.214"`'s first 1/2/3 dot-segments), not a fabricated cross-group link — so hub-to-hub
edges for *this one grouping* don't undermine the "not real topology" framing everywhere else.
Implemented as `getIpHubChain(key)` (new, both `src/shared/window.ts` and
`src/shared-v2/modules/discovery.ts` — this feature predates `shared-v2` and had to be ported by
hand, not regenerated from a spec, since `docs/star-topology/` has no `shared-v2`-specific section)
expanding a `/24` key into `["a", "a.b", "a.b.c"]`, walked once per device inside
`renderDiscoveryTopology()`, deduped via a new `hubSeen` map keyed by the same `'hub:' + key` id
scheme every hub already used — so a `/16`/`/8` shared by multiple `/24`s (or `/16`s) still gets
exactly one node, not one per device. Also changed hub *color* to cycle by the chain's root (`/8`)
entry rather than the full `/24` key, so a `/16` hub and its `/24` children read as one visual
branch instead of one arbitrary color per `/24` — this was a secondary fix once the hierarchy made
the old per-`/24` coloring look wrong (a `/16` hub with two differently-colored `/24` children no
longer visually reads as "these belong together"). Every other `groupBy` (`name`/`mac`/`port`/
`protocol`) is completely unaffected — they still get the original single unlinked hub per group.
See `docs/star-topology/DESIGN.md`'s "The `ip` grouping's hub hierarchy" section for the full
algorithm write-up.

## Three small copy-paste/wiring bugs in the playback controls, found in one pass

Not one bug with a deep root cause like the entries above — three unrelated, shallow ones that
happened to surface together while chasing a "Playback video doesn't play" report, worth
recording together since they're the kind of thing a quick `grep` for the pattern elsewhere would
have caught sooner:

- **`onchangeendtime()` read `#start_time`, not `#end_time`.** `getSelectedPlayer().endTime =
  endDate + 'T' + document.getElementById("start_time").value + "Z"` — applying/changing the
  Manual End Time field actually set the player's `endTime` using the *start* time's value,
  collapsing the playback range toward zero length. A straight copy-paste from the sibling
  `onchangestarttime()` that was never updated. This was the actual root cause of the reported
  playback failure.
- **`#audio_shift` had zero event listeners.** The input existed in `window.html` and
  `rtsp-over-websocket`'s element supports an `audioshift` setter for A/V sync, but nothing in
  `window.ts` ever read the field or assigned it — a UI control that looked functional but did
  nothing. Added `setaudioshift()` wired to the input's `change` event.
- **`set_use_universal_time()` chained through `.GMT` unnecessarily**:
  `getSelectedPlayer().GMT.coordinatedUniversalTime = ...`. `.GMT` returns a plain string (e.g.
  `"9"`), and assigning a property onto a string primitive throws in strict mode —
  `TypeError: Cannot create property 'coordinatedUniversalTime' on string '9'`.
  `coordinatedUniversalTime` was never nested under `.GMT` to begin with; it's `RTSPOverWebSocket`'s
  own independent setter. Fixed by dropping the `.GMT.` link entirely.

**Lesson**: `grep` for a handler's own name across the file after fixing one instance of a
copy-paste bug — `onchangestarttime`/`onchangeendtime` are exactly the kind of near-duplicate
pair where a fix to one raises the odds the sibling has the same mistake, and `#audio_shift`
being wired to nothing at all wouldn't have thrown or logged anything — it just silently never
worked, which is why it went unnoticed until someone asked "does the UI account for X" rather
than hitting a visible error.

## `SearchByUTCTime` capability and the capabilities-response object-vs-string trap

SUNAPI's Timeline Search only honors a `Z`-suffixed (UTC) date on devices whose
`/stw-cgi/attributes.cgi` capabilities response declares `SearchByUTCTime=true` (confirmed by
fetching the actual SUNAPI Application Programmer's Guide §8.6 — an internal-only host,
`http://55.101.56.209:8080/...`, reachable via plain `curl` but *not* through the WebFetch tool,
which force-upgrades `http://` to `https://` and that host doesn't speak TLS at all — worth
remembering if a future doc-lookup against an internal SUNAPI host gets a spurious
`WRONG_VERSION_NUMBER` from WebFetch: try `curl` directly before concluding the host is
unreachable). `window.ts` had a `#use_gmt` "Use timezone" checkbox that appends that `Z`
throughout every search/timeline call, with **no check at all** against this capability — see
`docs/architecture.md`'s "Playback controls" section for the fix
(`applySearchByUTCTimeCapability()`).

The more general finding underneath that fix, worth remembering on its own: **this codebase has
no XML capabilities parser** (a previous ~2500-line one was deliberately removed — see the
comment trail at `window.ts`'s `deviceInformation.attributes.IsAndroid` call site inside
`initPromise.then(attributes => ...)`), so `attributes` is a parsed object on JSON-firmware
devices but a raw XML *string* on others, and every existing `deviceInformation.attributes.X`
read (`MaxChannel`, `IsAndroid`) already silently degrades to `undefined` on the latter. Adding
`SearchByUTCTime` the same naive way would have had the identical silent-failure problem, so
`getCapabilityValue(attributes, name)` handles both shapes (direct property access on an object,
a targeted regex extraction on a string) instead — deliberately not a general parser, just enough
to read one named attribute out of either representation.

## Removing a button in favor of a segmented toggle: grep every reference to its old id first

Collapsing the standalone "Search 3 Month" button into the new 1 Day/3 Month segmented toggle
(see `docs/architecture.md`'s "Playback controls" section) removed `id="search_three_month_timeline"`
from `window.html`. Two `document.getElementById("search_three_month_timeline").disabled =
true/false` call sites elsewhere in `window.ts` (initial-state setup, and re-enabling once
`search_date()`'s calendar search confirms recorded data exists) were missed on the first pass —
same failure class as this file's `#broadcast`/`#usegmttime` entries: a property assignment on
`null` throws and aborts the *entire* enclosing function, in this case a
`document.querySelectorAll("rtsp-over-websocket").forEach(...)` setup callback, so the crash
surfaced as `Uncaught TypeError: Cannot set properties of null (setting 'disabled') ... at
NodeList.forEach` — several layers removed from the actual one-line cause. **Lesson, restated
because it keeps recurring in this file**: removing or renaming an `id` requires grepping *every*
`getElementById`/`querySelector` reference to it across the whole file before deleting the
element, not just the call sites you remember wiring up yourself in the same change.

## vis-timeline restyle: `groupTemplate()`'s `font-size: 3px` was a bug, not minimalism

While giving the Playback recording timeline (`vis.Timeline`, not `vis.Network` — see
`docs/architecture.md`'s pointer to `timeline.css`) a modern restyle, found that
`updateTimeline()`'s `groupTemplate()` set the group label and its "Hide" button to `font-size:
3px` via inline styles (`label.style.fontSize = "3px"`). Inline styles beat any external
stylesheet rule regardless of specificity, so no amount of CSS restyling could have fixed this —
it had to be removed at the source. There's no comment or test tying this to intentional
behavior (unlike some of this file's other "looks like a bug but isn't" entries), and 3px is
below any plausible legible size, so this reads as a genuine leftover mistake rather than a
preserved quirk. Replaced with CSS classes (`.timeline-group-label`/`.timeline-group-hide-btn` in
`timeline.css`) so the group label/button are both actually readable and themeable.

## Switch component: unifying 3 ad hoc toggle mechanisms into one, and why progressive enhancement was chosen

`window.html` had 5 switch-looking controls (dark mode, HTTP/HTTPS, Live/Playback, the Playback
1 Day/3 Month range, SUNAPI On/Off) built on 3 unrelated mechanisms that only happened to look
alike — a hand-rolled iOS-slider (`.theme-switch`), static `.segmented-toggle` radio/button
markup, and `segmentedToggle.ts`'s one checkbox-only helper. None of the three could express a
3+-option switch or a dot-instead-of-text option, and there was no single place to read the "how
does a switch work here" answer from. Replaced by `src/component/switch/`'s `mountSwitch()` — see
`docs/switch-component/` (MRD/PRD/SRS/DESIGN/TC) for the full spec.

Three implementation shapes were considered for the new component:

1. **A custom element** (`<ws-switch>`, `customElements.define`) — declarative, but would have
   meant rewriting every one of `window.ts`'s ~35 existing `.checked`/`:checked`/
   `classList.contains("active")` read/write sites across the 5 controls to go through a new
   element API instead, since a custom element normally owns and generates its own markup.
2. **A config-driven full-render function** (`renderSwitch(container, config): HTMLElement`) —
   same problem: generating fresh markup from a config object means the existing ids/names the
   ~35 call sites depend on would either need to be threaded through as more config, or the call
   sites would need to change to read the new function's return value instead.
3. **A progressive-enhancement function** (chosen) — mirrors what `segmentedToggle.ts` already did
   for its one case: `mountSwitch()` never generates a native `<input>`/`<button>`, only enhances
   whatever's already in the container (adding sibling labels/knob + CSS classes). Every original
   id/name/value attribute survives untouched, so all ~35 call sites needed **zero** changes.

The user explicitly asked for progressive enhancement over the other two, citing this exact
lowest-integration-risk reasoning, and asked for a **full migration** of all pre-existing switches
onto the new component rather than leaving them on the old mechanisms and only using
`mountSwitch()` for new call sites going forward — deliberately accepting the markup/CSS churn in
`window.html`/`window.css` in exchange for there being exactly one switch mechanism in this
codebase afterward, not four (three old + one new).

One non-obvious 5th control was found mid-migration: `#play_type_toggle` (Live/Playback) uses the
exact same `.segmented-toggle` CSS classes as HTTP/HTTPS but wasn't mentioned in the original ask
(which named 4 controls). Migrating it was necessary, not optional scope creep — removing the old
`.segmented-toggle*` CSS rules from `window.css` (superseded by `switch.css`) would have silently
unstyled it otherwise, since it depended on those same class names. **Lesson**: before deleting a
CSS class's rule block, grep the *whole* `window.html`/`window.ts` for every other element still
wearing that class, not just the elements the task description named — same "grep every reference
before deleting" lesson this file already records for element ids.

**Found in first real-world use (screenshot review), fixed same session**: the SUNAPI On/Off
switch was first mounted on `#sunapi_info` — the existing `.field` div that holds *both* the
`SUNAPI:` field-name `<label>` and the checkbox — instead of a dedicated wrapper around just the
checkbox. `mountSwitch()`'s `'segmented'` variant puts `border`/`border-radius: 999px`/`overflow:
hidden` on the whole container, so the field-name label ended up inside that rounded-pill border
too, rendering as two disjoint boxes instead of one clean pill (visibly different from HTTP/HTTPS
and Live/Playback, whose containers only ever held their own radios). Every other migrated control
already had a container scoped to just itself; SUNAPI didn't, and that mismatch wasn't visible from
reading the code — it only showed up once the page was actually rendered and screenshotted. Fixed
by adding `<div id="sunapi_toggle">` around just the checkbox, inside the existing `#sunapi_info`.
**Lesson**: `containerId` must be scoped to only the switch's own input(s), same requirement now
called out in `docs/switch-component/DESIGN.md` — and this class of CSS-scope bug is easy to miss
by reading markup/JS alone; a real render is what actually caught it here.

## Disclosure component: native `<details>`/`<summary>` chosen over a hand-rolled `aria-expanded` widget

Added `src/component/disclosure/` (`mountDisclosure()`) to make the Debug Information/Discovery/
RTSP log panels in `window.html` collapsible — see `docs/disclosure-component/` (MRD/PRD/SRS/
DESIGN/TC) for the full design.

**Built on native `<details>`/`<summary>`, not a custom `aria-expanded` button + CSS toggle.** The
browser already provides open/close, `Enter`/`Space` keyboard activation, and correct
expanded/collapsed semantics for free — reinventing that with a `<button aria-expanded>` + a
manually toggled content `<div>` would mean hand-writing all of it, purely to end up with the exact
same behavior the native element already has. This extension only targets evergreen Chrome/Edge
(`README.md`), so there's no compatibility reason not to rely on `<details>`. The only real problem
`mountDisclosure()` has to solve in JS is that `<summary>`'s native click-to-toggle activates on
*any* bubbling click, so an interactive control placed inside it (Debug Information's "Use"
checkbox / "Clear" button) would otherwise also collapse/expand the panel as a side effect of being
clicked — fixed with one `event.stopPropagation()` per named header control.

**Non-obvious part of that fix**: `#use_debug`'s checkbox is *nested inside* its own `<label
for="use_debug">`, not a sibling the label points at. Clicking the label's "Use" text fires a click
on the `<label>` element itself, which bubbles independently of the synthetic click the browser
separately dispatches on the checkbox — guarding only the checkbox's own click would still let the
label-text click through and toggle the panel. `guardHeaderControlClick()` walks up via
`closest('label')` and guards that ancestor instead when one exists, falling back to the control
itself otherwise (the case for `#clear_debug`, a plain unwrapped `<button>`).

**Two UX decisions confirmed with the user before building** (AskUserQuestion, matching the same
approach used for the switch component): all three panels **start collapsed** (they're diagnostic/
log output, not needed on every page load), and collapsed/expanded state is **not persisted**
across reloads — this codebase has no existing precedent for persisting this kind of UI-only
convenience state (contrast `#auto_discovery_toggle`, which persists to `chrome.storage.local`
because it's a functional setting, not a UI convenience), so not adding one here keeps the
component's behavior simple and matches the rest of the page.

Progressive enhancement, same convention as `src/component/switch/`: `mountDisclosure()` never
generates the `<details>`/`<summary>`/content markup, only sets initial `open` state and wires the
two optional header-control guards — `#debug`/`#result`/`#rtsp` and `#use_debug`/`#clear_debug`
kept their exact ids and only moved position in the DOM, so every pre-existing
`document.getElementById(...)` call site in `window.ts` needed zero changes.

## docs/ standardized: every `.md` file gets an MRD/PRD/SRS/DESIGN/TC directory + a metadata header

Two things changed across all of `docs/`, both user-requested:

1. **`docs/switch-component.md`/`docs/disclosure-component.md` (flat single files) were split into
   `docs/switch-component/`/`docs/disclosure-component/` directories**, each a full
   MRD/PRD/SRS/DESIGN/TC set — matching `docs/star-topology/`/`docs/native-https-proxy/`'s existing
   convention, which those two components hadn't followed originally (written before that
   convention's weight was fully appreciated for a component-sized doc, not just a full feature).
   Content mapped over near-1:1 (the original "Why this exists"/MRD-flavored material → MRD, the
   functional spec's interface → SRS, the enhancement-detection/migration-table/style material →
   DESIGN); the one genuinely new material was each set's `TC.md` — neither original flat doc had
   a test-case table, so both were written fresh, including an honest "not yet exercised by a live
   control" row for switch's 3+-option/dot-mode capabilities (implemented and validated, but no real
   `window.html` control uses them yet).
2. **Every `.md` under `docs/` (22 files) gained a standard metadata header**: `Title`/`Abstract`/
   `Status`/`Author`/`Milestone`/`Related docs` as a table right after the `# TYPE — Title` line,
   followed by a `## History` table. This was scoped as broadly as possible on purpose (confirmed
   via `AskUserQuestion` — the alternative was limiting it to just the two newly-split component
   sets) specifically because **none** of this repo's existing docs, including the already-mature
   `star-topology`/`native-https-proxy` sets, had ever carried this metadata; leaving them out would
   have made the two new sets inconsistent with the very convention they were just made to match.
   `History` rows for already-git-tracked files are real, pulled from `git log --follow --format='%as
   %s' -- <path>` (oldest first) rather than invented — e.g. `docs/architecture.md` got 4 content
   rows spanning 2026-08-12 through 2026-08-27 plus a final metadata-addition row, not just a single
   "1.0 initial" placeholder. `Milestone` reflects the git tag nearest the content's *most recent*
   real revision (not its origin) — `docs/architecture.md` is `Unreleased (post v1.0.2)` despite
   originating alongside the `v1.0.0` initial commit, because it kept being updated through
   2026-08-27, after the `v1.0.2` tag.

**Lesson, same class as this file's other "grep every reference before deleting" entries**: deleting
the two old flat `.md` files required finding and updating every cross-reference to them first —
`grep -rln "switch-component\.md\|disclosure-component\.md"` turned up 6 files
(`CLAUDE.md`/`README.md`/`MEMORY.md`/the skill file/`docs/architecture.md`/
`docs/control-panel-data-binding.md`) plus 4 source-code comments (`scripts/build.js`, both
`switch.ts`/`switch.css`, both `disclosure.ts`/`disclosure.css`, and one `window.ts` comment) — none
of which would have been obvious from just working inside the new `docs/switch-component/`/
`docs/disclosure-component/` directories. A stray, unrelated duplicate bullet was also found and
fixed in `README.md` while doing this pass — a leftover from an earlier session's transient
WSL/DrvFs write retry (see `CLAUDE.md`'s own note on that class of issue), not something this
change introduced.

## `src/shared-v2/`: a spec-driven, independent reimplementation of `window.html`/`window.ts`

A parallel front end at `src/shared-v2/`, built from scratch against a full SDD spec
(`docs/window-ui/` — MRD/PRD/SRS/DESIGN/TC), not copy-pasted from `src/shared/`. Builds to a side
artifact (`dist/shared-v2-preview/` via `npm run build:shared-v2`) — see `docs/window-ui/MRD.md`
for why the *source tree* is parallel, not an in-place rewrite. Its *build output*, however, is no
longer isolated from the real `dist/chrome-extension/`/`dist/nodejs/` outputs — see
["`npm run build:shared-v2` now overwrites the shipped `dist/` outputs" below](#npm-run-buildshared-v2-now-overwrites-the-shipped-dist-outputs)
for why and how that changed. Verified against the original for functional equivalence with a
Playwright suite (`tests/window-ui-equivalence/`, `npx playwright test`), backed by
`tools/mock-sunapi-server/` (canned SUNAPI HTTP responses, endpoint paths/params read directly out
of the vendored `@melchi45/rtsp-over-websocket` bundle, not guessed) and
`tools/equivalence-test-server/` (a generic static+WS server, reused for both pages, that replays
two fixed fixture devices over `/discover` instead of real UDP broadcast — WSL2 can't reach real
devices anyway, see this file's networking notes elsewhere).

**Real bugs found in the shipped original while building this**, confirmed live via Playwright, not
just read from source — each is deliberately *not* reproduced in `src/shared-v2/`, and the
equivalence test for it asserts the resulting asymmetry (old fails/crashes, new succeeds) rather
than cross-page equality:
- **NVR device type + "Use SUNAPI" always fails on the original.** `initSunapiManager()`'s
  `getDateInfo()` `.then()` branch (`window.ts` line ~2087) reads `element.device === 'nvr'`, where
  `element` is a stray reference to an outer-scope variable that's actually `undefined` at call
  time — not a stale-but-valid element as first assumed from reading the source. `element.device`
  throws a real `TypeError`, converted by the chain's own `.catch()` into an unconditional
  `use_sunapi_client_checkbox.checked = false`. Every NVR-type device fails to bootstrap SUNAPI, not
  just in some narrow edge case.
- **Playback `STOPPED` state can get buttons stuck.** `onstatechange()`'s `STOPPED` case calls
  `document.getElementById("timestamp_date").remove()`/`"timestamp_time"` unguarded — if a real
  stream never entered 'live' mode's `ontimestamp()` first (which is what lazily creates those two
  elements), this throws and aborts the rest of the `STOPPED` branch, potentially leaving
  Play/Stop/Pause/Resume disabled-state stuck. `src/shared-v2/videoControl.ts` uses `?.remove()`.

**One real spec gap found only by running the reimplementation, not by reading source carefully
enough**: an entire startup initialization block in the original (`window.ts` ~L380-414— today's-
date defaults for `#start_date`/`#end_date`/`#seeking_date`, initial `disabled`/`checked` state for
about a dozen controls across Audio/Video Control/Playback/Device) was missed by the first SRS pass
entirely, because it isn't attached to any one control's own event handler — it's the kind of thing
that's easy to skim past reading linearly but immediately visible as a wrong `#end_date` value once
two live pages are compared. Traced from one failing equivalence test (`TC-17`) back to the missing
block, not spotted proactively — the lesson being that "read the source" and "compare live
behavior" find genuinely different classes of gaps, and this SDD's Phase 4 iterate-to-green loop
exists specifically because of gaps like this one.

## `updateTimeline()`'s "hardcoded to today" bug that wasn't — a misdiagnosis, then a self-inflicted one

A user reported (against a **real device**, not the mock server) that Search Timeline returned
valid data but `vis.Timeline` showed nothing. Two separate investigations happened, in order:

1. **Reading `src/shared/window.ts`'s source** showed `updateTimeline()`'s `vis.Timeline` options
   hardcode `start`/`end` to *today's* calendar day and never adjust them afterward — a plausible-
   looking explanation ("real recordings from any other day render outside the visible window").
   A `visTimeline.fit(...)`/`setWindow(...)` call was added to `src/shared-v2/playback.ts` to "fix"
   this, and passed against `tools/mock-sunapi-server/`'s (then only 3-item) fixture.
2. **The user then reported real performance numbers from testing** with genuinely large data.
   Investigating that surfaced the *actual* bug: the real device's `getTimeline()` response is
   wrapped as `{TimeLineSearchResults: [...]}`, but `src/shared-v2/playback.ts` was passing the
   whole wrapper (not `.TimeLineSearchResults`) into `updateTimeline()`, which silently did nothing
   (`undefined.length`, swallowed by the outer `.catch()`). The mock server's fixture had the exact
   same unwrapped shape, so this was invisible to equivalence testing on either side. **Fixing this
   one line was the entire real fix.**
3. Scaling the mock fixture to ~150 items (matching the real report's volume) to verify the
   envelope fix then revealed that step 1's `fit()` "fix" was itself broken — it rendered **zero**
   `.vis-item` elements at that volume, versus the original's (correct, unmodified) full render.
   `vis.Timeline` (this vendored 4.20 build) already auto-fits its window to real item data the
   first time `setItems()` runs with actual items — the hardcoded `start`/`end` options only ever
   mattered before any items existed. The "bug" in step 1 never actually existed at runtime;
   `fit()`/`setWindow()` was removed entirely, and rendering matched the original exactly once both
   the real bug (2) was fixed and the fake one (1) was un-fixed.

**Lesson**: a plausible bug found by reading source alone, without a live side-by-side comparison
against real (or realistically-sized) data, produced a fix for a problem that didn't exist — and
that fix then became a second, real, more severe regression once real data volume exposed it. Both
`docs/window-ui/DESIGN.md`'s "Deviations from legacy behavior" and `SRS.md`'s FR-7.6 carry this as
a retracted entry rather than silently deleting it, specifically so this reasoning trail (why it
looked right, and what live testing had to reveal to unwind it) isn't lost. See
`docs/window-ui/TC.md`'s TC-18 for the equivalence test at realistic volume that this whole thing
turned into.

## "vis.Timeline is slow" turned out to be redundant network round trips, not rendering

A follow-up to the entry above: after the envelope-unwrap fix, the user reported vis.Timeline
still *felt* slow against a real device (`requestAnimationFrame`/reflow console violations). Rather
than guessing again, this was profiled directly:

- **Chrome DevTools Protocol `Profiler` via Playwright** (`newCDPSession(page)` +
  `Profiler.start()`/`.stop()`, sampled during the actual `#search_timeline` click) showed ~95% idle
  time and under 50ms of real JS/layout work for a 150-item render — identical on both
  `src/shared/` and `src/shared-v2/`. vis.Timeline itself was never the bottleneck.
- **Counting actual HTTP requests** (`page.on('request', ...)` against
  `tools/mock-sunapi-server/`) during the same flow showed `initSunapiManager()`'s
  ~6-7-round-trip chain (attributes → videosource → videoprofilepolicy → videoprofile → timezone →
  dateinfo) firing **multiple times** for one user flow — the original has no guard against this at
  any of its ~12 call sites (every one only checks the target field/session state, never "is a
  chain already running"). Near-free on localhost/mock; each redundant chain is a real, compounding
  cost against actual camera network latency.
- One specific, very findable-only-live trigger: clicking `#use_sunapi_client_checkbox` right after
  typing credentials moves focus away from `#password`, and the **browser's own native
  blur-triggered `change` event** fires there even though nothing was edited — the original's
  unconditional re-init on that event turns it into a second full chain, effectively every time a
  user turns SUNAPI on right after typing a password.

Fixed with two narrow, independent guards in `src/shared-v2/` (a `sunapiInitInFlight` re-entrancy
flag in `state.ts`, and a same-value check in `session.ts`'s username/password handlers) — not a
rewrite of the many call sites' own pattern. See `docs/window-ui/DESIGN.md`'s "Deviations from
legacy behavior" (4th entry) and `docs/window-ui/TC.md`'s TC-27, which counts real network requests
rather than just checking DOM state, specifically because DOM-state-only equivalence checks had
already missed this class of problem entirely.

**Lesson**: when a performance complaint doesn't match where you'd instinctively look (here: "the
chart library must be slow"), profile before fixing — CPU sampling ruled out the suspected
component in one pass, and request-counting pointed straight at the real one. Both are cheap to set
up via Playwright + CDP and are worth reaching for before further source-reading guesses, especially
after the previous entry's lesson about what pure source-reading missed.

## Playback's Calendar search (`src/shared-v2/`-source-only) — why it's additive, not a replacement

Requested directly by the user: Playback + SUNAPI On gets a Calendar-driven search flow (pick a
day with recordings, rest fetches automatically) instead of the existing manual date-range flow
(`#playback_control`: type a date range, click Search Overlapped Id, click Search Timeline). Two
decisions worth recording, both confirmed via `AskUserQuestion` rather than assumed:

- **The old flow stays completely intact, reachable whenever SUNAPI is Off** (even in Playback
  mode) — this was explicitly *not* "the calendar replaces the old flow everywhere," because the
  calendar's own `calendarsearch`/`eventrules.cgi` calls need a live SUNAPI session to mean
  anything; without one there's nothing for it to show. `#playback_control` and the new
  `#playback_control_calendar` are separate markup with separate element ids on purpose (see
  `docs/window-ui/DESIGN.md`'s FR-7.8 section) — nothing about the old panel's ids or behavior
  changed to make room for this.
- **The Rule dropdown merges two different SUNAPI endpoints** (`getDynamicRulesOptions()` — what a
  channel *can* report — and `getDynamicRules()` — what's actually *configured*) because neither
  alone is enough: an unconfigured-but-supported event type is invisible from `getDynamicRules()`
  alone, and `getDynamicRulesOptions()` alone only has the less-friendly `Type_<Language>` label,
  not a configured rule's own `RuleName`/`EventName_<Language>`. The two sample JSON responses the
  user supplied don't even agree on which field holds the localized name
  (`Type_English` vs `EventName_Korean`) — the merge logic tries both, falling back to the raw
  `Type` value, rather than assuming one naming convention.

This whole feature has no `SunapiManager.ts` (`rtsp-over-websocket`) changes at all — every call it
needs (`getDeviceInfo`, `getDynamicRulesOptions`/`getDynamicRules`, `getCalendarSearch`,
`getOverlappedIdList`, `getTimeline`) already existed before this feature was scoped, confirmed by
reading `SunapiManager.ts` directly rather than assuming a new method would be needed.

**Real, only-found-by-running-the-suite conflict**: `tests/window-ui-equivalence/`'s pre-existing
FR-7.1-FR-7.7 tests (TC-15/16/18/27) had always turned SUNAPI on *before* exercising
`#playback_control`'s manual buttons — the natural order, and exactly the state this new feature
now shows the Calendar panel in *instead*. Four tests broke. The fix was on the test side (drive
`#search_overlapped_id`'s/`#hostname`'s own self-init guard instead of the checkbox, still
exercising the identical `initSunapiManager()` chain) rather than reconsidering FR-7.8's own
design — replacing the manual flow in that exact state is what was actually requested, so
`#playback_control` being genuinely unreachable there (not just hidden alongside a still-usable
alternate path) is correct, not a bug. Same lesson as this file's other "found live, not by
reading source" entries: a spec change's downstream effect on an *existing, passing* test suite is
easy to miss until the suite actually runs.

## `npm run build:shared-v2` now overwrites the shipped `dist/` outputs

`docs/window-ui/MRD.md`'s original "parallel, not in-place" call (`src/shared-v2/` builds to its
own `dist/shared-v2-preview/`, never touching the real `dist/chrome-extension/`/`dist/nodejs/`) was
explicitly reversed by the user, after the Calendar feature above landed and the equivalence suite
was green: `npm run build:shared-v2` (run after `npm run build`, or via `npm run start` which now
chains both) also overwrites `dist/chrome-extension/`'s and `dist/nodejs/examples/public/`'s
`window.html`/`window.js`/`scripts/socket.js` and adds `css/calendar.css` — see
`scripts/build.js`'s `buildSharedV2()`.

**Why**: the user wanted the real, actually-loaded Chrome extension (and the `npm run start`
example server) to show the new Calendar UI, not just a side preview at
`dist/shared-v2-preview/`/`http://localhost:8080/shared-v2/`. This request came at the end of an
escalating troubleshooting thread — the user kept building with `build:shared-v2` and checking
`npm run start`'s normal root URL, not realizing that command had always been a deliberately
separate, non-shipping artifact; repeating "they're separate build targets" several times across
that thread was the wrong response to keep giving once the actual ask became clear.

**What did *not* change**: `src/shared/` itself is untouched, and `src/shared-v2/` is still a
separate source tree/build target (not folded into plain `npm run build`) — only the *build
output's* relationship changed. The overwrite is conditional on `dist/chrome-extension/`/
`dist/nodejs/examples/public/` already existing, so `npm run build:shared-v2` run standalone (no
prior `npm run build`) still just produces `dist/shared-v2-preview/` alone.

**Known gap this creates, surfaced but not yet addressed**: `tests/window-ui-equivalence/` only
ever drove the nodejs/WebSocket runtime path (`IS_EXTENSION=false`); the extension-only
`IS_EXTENSION`-gated code paths in `src/shared-v2/` (native-host bypass checkbox, `chrome.*` APIs)
were implemented for spec completeness per `docs/window-ui/PRD.md`'s original Non-Goals but never
live-tested. Now that the overwrite makes those paths load-bearing in the real shipped extension,
that gap is a live risk, not just a documented non-goal — worth loading the extension unpacked and
manually exercising before relying on it in production.

## Playback Calendar's Rule dropdown: `getDynamicRules()`+channel filter, 1-based `Rule<N>`, not a `getDynamicRulesOptions()` merge

The Rule dropdown design in this file's "Playback's Calendar search" entry above (merge
`getDynamicRulesOptions()` + `getDynamicRules()` by distinct `EventSources[].Type`, e.g.
`"MotionDetection"`, use the raw `Type` as the value sent to `getTimeline()`) was never actually verified against a real device's
Timeline endpoint — only against the mock server, whose fixture never validated what `Type` values
the real endpoint accepts. The user reported directly, with the real request/response: a real
device's `recording.cgi?msubmenu=timeline` only accepts `Type=Rule<N>` — a rule identifier derived
from `eventrules.cgi?msubmenu=dynamicrules`'s `Rules` array, never an `EventSources[].Type` string.
`MotionDetection` etc. are never valid values there at all.

**The fix** (`src/shared-v2/modules/playbackCalendar.ts`): drop `getDynamicRulesOptions()` from
this flow entirely. `getDynamicRules(language)`'s own `Rules` array already has everything needed
per entry — `Rule` (→ dropdown value, prefixed `"Rule"`), `RuleName` (→ dropdown label, the
user-configured display name like `"움직임 감지 (CH1)"`), and `EventSources[].Channel` (→ filter: only
show rules whose `EventSources` include the currently-selected channel). This surfaced a second,
related gap: the Rule list is now inherently channel-scoped, but nothing previously refreshed it on
channel change — `device.ts`'s `changechannel()` now also calls
`refreshRuleSelectForChannelChange()` (no-op if the calendar panel isn't visible, to avoid a wasted
request in Live mode).

**A third, immediate follow-up correction**: the user reported, right after the above landed, that
the `Rule<N>` numbering the Timeline endpoint expects is **1-based**, one higher than
`getDynamicRules()`'s own 0-based `Rule` field — `Rule: 0` is `Type=Rule1`, not `Type=Rule0`. The
dropdown's value is `'Rule' + (entry.Rule + 1)`. Two off-by-similar-but-distinct real-device facts
surfaced back to back here (which endpoint/field to use at all, then its exact numbering base) —
neither guessable from the sample JSON alone, both only surfaced by the user actually running a
query against a real device.

**A fourth follow-up, also from the user**: `#event_rules_type` had no way to search *every* event
type at once — only one specific Rule at a time. `getTimeline()`'s own `type` parameter already
defaults to `"All"` when omitted (`SunapiManager.ts`'s `buildTimelineUri()`), so `"All"` (value
`"All"`) is now always the dropdown's first, default option, ahead of the channel-filtered Rule
entries — matching the exact query the user specified
(`recording.cgi?msubmenu=timeline&...&Type=All`).

**Lesson, consistent with this file's other "found only against a real device" entries**: the mock
server's fixture matched the *shape* of a real response (the user's own sample JSON) but nothing
validated the *query semantics* on the other end (what the Timeline endpoint's `Type` param
actually accepts, its numbering base, or that an "any type" option needed to exist at all) until a
real device was hit. A structurally-correct-looking design built from sample response JSON alone
can still encode a wrong assumption about how a *different* endpoint consumes that data — and can
miss adjacent requirements (like an explicit "search everything" option) that only become obvious
once someone is actually trying to use the feature.

## Intermittent real-device 401s (getCalendarSearch, then getTimeline): a shared-state race in the vendored `rtsp-over-websocket` library, not this app

The user reported, against a real device: `getCalendarSearch()` (Playback Calendar's month search,
SRS.md FR-7.8.4) came back `401 Unauthorized` while every other concurrent/nearby request succeeded —
and, when asked, confirmed it "doesn't always happen" (their own words: "항상 발생하는 것은 아닙니다").
That detail was the key clue: a deterministic bug would fail every time; an intermittent one meant a
timing-dependent race, not a wrong request.

**Root cause, found by reading `@melchi45/rtsp-over-websocket`'s `SunapiClient` source directly (not
guessed)**: `authCount`, meant to cap HTTP Digest retries *per logical request* (an unauthenticated
probe → `401` with a challenge → one retry with credentials, give up if that also fails), is actually
unscoped **instance** state on `SunapiClient`, shared across every call made through that client —
and there is no request queue/lock anywhere in `SunapiClient` or `SunapiManager` to prevent two calls
from being in flight at once. `playbackCalendar.ts`'s `initPlaybackCalendarPanel()` fires
`getDeviceInfo()` (via `fetchLanguageAndRules()`) and, essentially simultaneously — `mountCalendar()`
fires its first `onMonthChange` synchronously as part of mounting — `getCalendarSearch()` (via
`runMonthSearch()`). If this is the first time in a while either needs a *fresh* digest challenge
(no cached `authInfo` yet), both fire unauthenticated probes and both get `401` back; whichever is
processed first increments the shared counter and correctly retries with credentials, but whichever
is processed second sees the counter already at its cap and fails outright — its authenticated retry
is never sent. Which one loses is timing-dependent (an interleaving of two independent request
lifecycles), matching exactly "doesn't always happen."

**The fix, and why it's a call-site mitigation rather than a library fix**: `SunapiClient` is a real
bug — this exact race could in principle hit any two concurrent SUNAPI calls anywhere in this app,
not just this one call site — but it lives in `@melchi45/rtsp-over-websocket`, a separately
versioned, privately-published GitHub Packages dependency; fixing it there wouldn't take effect here
without a version bump and republish, out of scope for what was actually asked. Instead,
`playbackCalendar.ts` gained a `firstShowBarrier`: the very first `getCalendarSearch()` each time the
panel is (re-)shown now waits for `getDeviceInfo()`'s own request to settle before firing, guaranteeing
one request warms the shared digest-auth cache before its sibling fires. This only delays that one
first call — the calendar grid itself still renders synchronously. **Not reproducible in Playwright**:
`tools/mock-sunapi-server/` returns `200` directly, with no digest challenge/response modeled at all
(see `docs/window-ui/TC.md`'s "Not verifiable in this environment" list) — this fix is verified by
code review and against the real device only.

**A second occurrence, same root cause, that corrected the above's "safe once cached" assumption**:
the user then reported the identical symptom again, this time against `getTimeline()` specifically,
triggered by a day click — well after the panel's initial show, i.e. NOT the one cold-start window
`firstShowBarrier` guards. Two details the user gave along the way ruled out other explanations
before landing on the same root cause: pasting the exact failing URL directly into the browser's
address bar returned a normal `200` (rules out bad credentials, a malformed URL, or a camera-side
problem — the request is valid in isolation), and the browser itself had no errors (rules out a
CORS/mixed-content/certificate issue). Both point squarely back at *this app's own concurrent
request pattern*, not the request's content. `runOverlappedAndTimelineSearch()`
(`playbackCalendar.ts`, FR-7.8.5) fires `getOverlappedIdList()` and `getTimeline()` concurrently on
**every single day click**, not just once — so the original "once a challenge is cached, concurrent
calls are safe" belief above doesn't hold in practice; a fresh camera-side challenge/nonce
apparently isn't durable across arbitrary later requests the way that reasoning assumed (plausibly
nonce rotation or single-use enforcement server-side — not confirmed from source, since that logic
lives on the camera, not in the vendored library). **The fix**: sequence `getTimeline()` to fire only
after `getOverlappedIdList()`'s own request settles, on every call now, not just the first — the same
technique as `firstShowBarrier`, applied per-click instead of once-per-show. Side effect, not a
concern: `getTimeline()`'s `overlappedId` argument now reflects the just-fetched list from *this*
click rather than a stale value from a previous one.

**Standing takeaway**: this is a real bug in `@melchi45/rtsp-over-websocket`'s `SunapiClient` (see
that repo's own `MEMORY.md` — the shared, unscoped `authCount` retry counter), documented there as
not yet fixed. Any *other* place in this codebase that fires two-or-more independent SUNAPI calls
concurrently is a candidate for the same intermittent failure — FR-7.1/FR-7.3's own
`getOverlappedIdList()`/`getTimeline()` pattern in `playback.ts` fires them concurrently too and has
not been reported as failing, but that doesn't mean it's actually safe, only that it hasn't been hit
yet. If it comes up again, sequencing (as done twice here) is the known, tested mitigation; a real
fix requires a version bump + republish of the vendored library, which has been deferred twice now
in favor of the immediate, real-device-blocking fix.

**A third occurrence, predicted by the takeaway above, this time predating both of the fixes
already in place**: the user reported the identical symptom (real device, `attributes.cgi` AND
`system.cgi?msubmenu=deviceinfo` both `401`) one step earlier in the flow than either prior
instance — `initSunapiManager()`'s own `attributes.cgi` probe (`SunapiManager.init()`) racing
`fetchDeviceLanguage()`'s `getDeviceInfo()` (`system.cgi`). Root cause: SRS.md v2.16 moved
`fetchDeviceLanguage()` to fire "as soon as SUNAPI turns On" — `device.ts`'s
`on_change_use_sunapi_client()` calls `initSunapiManager()` then `fetchDeviceLanguage()`
back-to-back, synchronously — without accounting for `initSunapiManager()` itself needing a fresh
digest challenge for `attributes.cgi` at that exact moment (turning SUNAPI on is, by definition,
always a "cold" digest-cache moment for that device). Same fix pattern as before: `fetchDeviceLanguage()`
now fires from inside `initSunapiManager()`'s own `attributes.cgi` success handler (`device.ts`)
instead of from `on_change_use_sunapi_client()` directly, so it's sequenced *after* the request that
was already guaranteed to need a fresh challenge, rather than racing it. See docs/window-ui/DESIGN.md
v1.43/SRS.md v2.26. This confirms the takeaway's warning generalizes beyond the two call sites
already fixed — worth checking any future new SUNAPI call site fired at/near SUNAPI turning On,
not just ones added inside the Calendar panel.

## Playback Calendar's own grid was laid out horizontally — a stray `class="field"`, not a component bug

The user reported (with a screenshot): the month/weekday header and the day-number grid inside
`#playback_calendar` were rendering side-by-side in one row instead of stacked vertically. The
component itself (`src/component/calendar/calendar.ts`) was correct — its `render()` appends three
separate block-level children (`.calendar-header`, `.calendar-weekday-row`, `.calendar-grid`) that
should simply stack. The actual cause: `src/shared-v2/window.html`'s `<div class="field"
id="playback_calendar">` — `.field` (`window.css`) is `display: inline-flex; align-items: center`,
meant for label+input pairs elsewhere on the page, accidentally copy-pasted onto this container too.
That turned the calendar's three stacked sections into flex items laid out in a row, vertically
centered — which is also why the header/weekday content visually landed next to the *middle* row of
the day grid rather than above it (its small height, centered against the much taller multi-row
grid, put it near the grid's vertical midpoint). Fix: removed `class="field"` from that one div;
`calendar.css`'s own layout was never the problem, and no code in `calendar.ts` needed to change.

## `vis.Timeline` item positioning bug — real, reproducible, confirmed pre-existing, root cause not found

The user reported, against a real device, at ~150-item volume: every `.vis-item` in `#timeline`
renders (correct count, correct classes, correct text content) but every single one collapses to
the *exact same* pixel position — no `left`/`top` inline style is set on any of them at all (`vis`
positions items via `position: absolute` + inline styles; without one, all default to the same
spot). This was found while implementing the user's requested `updateTimeline()` redesign (merge
Normal/Event into one auto-stacked "All" group, dynamic per-Type coloring — see the FR-7.6 v1.14
entries in `docs/window-ui/SRS.md`/`DESIGN.md`), initially suspected as a regression from that
change.

**Confirmed NOT a regression from that redesign** — this was the single most important finding,
worth the effort spent reaching it: temporarily restoring the exact original, untouched two-group/
subgroup `updateTimeline()` code (matching what shipped before this session touched the function at
all) reproduces the identical failure, in the identical real-app context, at the identical volume.
Whatever this is, it predates today's work entirely and was never actually verified with real (or
even mock, ~150-item) data by a human looking at the rendered result — `tests/window-ui-equivalence/`'s
own TC-18/TC-32 only assert `.vis-item` *count*, never actual position, so this has been silently
passing undetected the whole time FR-7.6/FR-7.8 existed.

**What was individually ruled out** (each tested in isolation against the real running app, not
guessed): `stack: true` vs `false`; `groups` present vs. entirely removed; `subgroup` fields present
vs. absent; `maxHeight` from `60px` to `300px`; `#timeline`'s own `min-height` (`0` vs. an explicit
`60px` — the container itself measures a perfectly normal, non-zero width and height at construction
time regardless); the `new vis.DataSet(options)` vs. `new vis.DataSet()` constructor-argument quirk
(a previously-documented "confirmed harmless" pattern — still confirmed harmless, not the cause);
calling `.redraw()` after `.setItems()`; forcing a synchronous reflow (`void container.offsetHeight`)
before constructing the `Timeline`; `container.scrollIntoView()` immediately before construction, at
both `block: 'nearest'` and `block: 'center'` (confirmed via direct `getBoundingClientRect()`
logging that the container really is fully within the viewport when this is done — still broken);
item volume (reproduces identically with only 5 items, not just 150 — ruling out any
performance/virtualization-at-scale theory); calling `updateTimeline()` twice per action (confirmed,
via a call counter + stack trace log, that it's called exactly once); headless vs. headed
(`--headless=false`) Chromium; and `document.fonts.ready` timing (custom webfont not yet loaded at
measurement time). None of these changed the outcome.

**What was NOT successfully isolated**: a from-scratch minimal reproduction — same vendored
`vis.js`/`vis.css`, same exact 150-item data shape/timing, built through the exact same Vite/Rollup
IIFE bundling this app uses (ruling out an ESM/CJS-interop bundling explanation directly) — renders
every item correctly positioned and spread across the full width. Progressively adding back pieces
of the real app's actual ancestor chain around `#timeline` (`#container`/`#right_panel` with
`position: absolute; right/top/bottom; width: 70%`, nested `.panel-stack`/`.panel`/`.panel-body`
with `display: flex; flex-direction: column`) still rendered correctly in isolation — meaning
whatever the real trigger is, it depends on some aspect of the live page's actual state/DOM/CSS this
reproduction attempt didn't capture (a real device screenshot from earlier in this same session,
before this specific redesign, appeared to show a working, well-populated timeline — though that was
never confirmed against this exact ~150-item/1-day-search combination, so it isn't proof the bug is
new; it may simply never have been looked at closely enough before).

**Status: unresolved, reported to the user as such rather than silently shipped as fixed.** The
FR-7.6 v1.14 redesign (single auto-stacked group, dynamic coloring) is unaffected by this bug either
way and was kept — it's a real, independently-justified change the user asked for, not a workaround
for this issue. Whoever picks this back up next should start from "confirmed pre-existing,
reproducible at 5 items, not caused by groups/stack/height/scroll/volume/redraw/reflow/font-timing/
headless-mode, not reproducible in an isolated same-library same-bundling same-approximate-CSS test"
rather than re-deriving any of that.

## `updateTimeline()`'s v1.14 auto-stacked "All" group still wasn't enough — replaced with `stack: false` + per-Rule# rows

Immediately after the v1.14 redesign above shipped (single `"All"` group, `stack: true` for
automatic overlap-only sub-rows), the user reported the timeline was **still** too tall, and asked
for two more things: (1) `"All"` should show Normal + every Rule# together on one literal line, with
per-rule-type coloring, and (2) when the result set contains more than one distinct Rule#, each
Rule# should get its own additional row.

The root realization: `stack: true`'s "only stack where items overlap" was exactly the source of the
remaining height problem — a busy channel's Normal/Event segments overlap in time constantly, so
`"All"` kept growing new sub-rows anyway, just fewer than the old fixed 2-row layout. The fix was
`stack: false` (a single itemSet-wide `vis.Timeline` option, not per-group — confirmed by reading
`node_modules/vis/dist/vis.js`'s `Group`/`ItemSet` source: every `Group` shares its parent
`ItemSet`'s `options` object directly, so there is no way to stack one group and not another), which
forces every row to a literal single line regardless of overlap. Per-Rule# rows are then just
additional `vis.DataSet` groups (sorted by trailing rule number, e.g. `"Rule2"` before `"Rule10"`),
populated by adding each non-`"Normal"` event a **second time** with a different `id` (DataSet ids
must be unique) under `group: <its own Type>` — `"All"` and the Rule-specific row both hold their own
copy of the same event, which is why selecting/clicking either behaves identically (same
`start`/`end`/`className`, `select`'s handler already read `className` not `group`, so it didn't need
to change). `assignEventColorClass()` also moved from "whichever type is seen first this render gets
color 0" to parsing the trailing digits out of the type string (`"Rule3"` → palette index 2), so a
given Rule keeps the same color across separate searches instead of shifting with event order.
Finally, `maxHeight: '60px'` (right-sized for the old single-row assumption) became `height: 'auto'`
+ `maxHeight: '300px'`, so total height now tracks however many rows (`"All"` + N distinct Rules)
this particular render actually needs.

One test consequence worth flagging for whoever touches this next:
`tests/window-ui-equivalence/video-playback-audio.spec.ts`'s TC-18 used to assert the new page's
total `.vis-item` count equals the old page's exactly — that's no longer true by design, since
Rule#-typed items now render twice (once in `"All"`, once in their own row). The test was rewritten
to compare the old page's total against just the new page's `"All"`-row count (`.vis-foreground >
.vis-group` — one direct-child div per `vis.Timeline` group, `"All"` always first since it's added
first), asserting that's an exact match, and separately that the new page's grand total is strictly
higher. See `docs/window-ui/SRS.md` FR-7.6 v1.15, `DESIGN.md` v1.16, and `TC.md` v1.11.

## `vis.Timeline` replaced entirely by a new custom widget — the still-open positioning bug's fate

Right after the v1.15 change above shipped, the user attached a screenshot of a different
application's dark "ONVIF Timeline" view — a collapsible "ALL EVENTS" mini-overview row (a density
strip with a highlighted zoom-viewport range and a playhead), per-event-type named rows below it
with colored bars/duration labels, and explicit zoom controls — and asked for that visual style.
Offered a choice (`AskUserQuestion`) between reskinning `vis.Timeline`'s colors or a full custom
rebuild, the user chose the full rebuild, and separately chose to exclude the reference's per-event
thumbnail images (no data source for them — SUNAPI's `getTimeline()` returns no per-event image).

The reskin option wasn't just less-preferred, it was actually impossible to fully satisfy: grepping
the vendored `node_modules/vis/dist/vis.js` for `minimap`/`overview` returns zero matches — `vis.
Timeline` has no overview/minimap sub-widget at all, so the requested "ALL EVENTS" viewport-highlight
strip can't be reached by any amount of CSS restyling. This was the deciding factor recommended back
to the user before they chose.

Built a new component, `src/component/event-timeline/` (its own MRD/PRD/SRS/DESIGN/TC set,
`docs/event-timeline-component/`), hand-rolled vanilla DOM/TS matching `calendar`/`switch`/
`disclosure`'s no-charting-library convention. The core design insight: the overview row and the
detail rows are drawn on **two different scales sharing one zoom-window state** — the overview row
always scales to the *full data extent* (never zooms) and draws a highlight rectangle mapping the
current zoom window onto that same full-extent scale; every detail row scales to the *current zoom
window* instead. Dragging the overview's highlight rectangle (body = pan, edges = resize/zoom) is
therefore the same mechanism as the "ALL EVENTS" viewport display, not a second bolted-on scrollbar
widget. `updateTimeline()` in `playback.ts` still computes the exact same `"All"` + per-Rule#
`rows`/`items` shape the v1.15 change above established (`assignEventColorClass()`'s Rule#-keyed
coloring unchanged) — only the rendering layer changed, from a `vis.DataSet`/groups pair to this
component's own `rows: EventTimelineRow[]`/`items: EventTimelineItem[]` options.

One directly relevant consequence for the still-open item-positioning bug documented above (every
`.vis-item` collapsing to the same pixel position in this app's real `#right_panel` layout, root
cause never found): **it no longer applies to `src/shared-v2/`**, simply because `vis.Timeline` is
no longer used for this feature here at all — there's no `vis.Timeline` instance left in this code
path for that bug to trigger against. This is not a fix in any general sense: the bug's root cause
was never found, and `src/shared/`'s own untouched original still uses `vis.Timeline` for its
equivalent feature and remains fully exposed to it, unaffected by this change. Anyone revisiting
that bug later should look at `src/shared/window.ts`, not `src/shared-v2/`.

Since a second `mountEventTimeline()` call for the same container does NOT reuse a previous
instance (unlike `calendar`'s `WeakMap`-cached idempotency) — `playback.ts` rebuilds this widget's
entire `rows`/`items` from scratch on every search anyway, so caching would need its own `setData()`
API for no real benefit — `updateTimeline()` now explicitly calls the previous `state.eventTimeline`'s
`destroy()` before mounting a new one, replacing the old code's implicit "just overwrite the
variable, the DOM was already wiped by `innerHTML = ''`" pattern with an explicit teardown (also
disconnects the new component's own `ResizeObserver`, which `innerHTML = ''` alone would have
leaked). See `docs/window-ui/SRS.md` FR-7.6 v1.16, `DESIGN.md` v1.17, `TC.md` v1.12, and
`docs/event-timeline-component/` for the new component's full spec.

## Timeline items displayed raw `"Rule3"` instead of the configured `RuleName`, and matched the wrong channel's same-numbered rule

Reported directly by the user with a real device's `eventrules.cgi?msubmenu=dynamicrules` response:
Timeline results (`recording.cgi?msubmenu=timeline`) label events by `Type: "Rule<N>"` (1-based),
but the UI showed that raw string verbatim instead of the rule's own configured `RuleName` (e.g.
`"MD 1"`) — the `Rule<N>` → `RuleName` lookup already existed (`playbackCalendar.ts`'s
`populateRuleSelect()`, for the Rule dropdown, see the entry below this one for its 1-based-offset
history) but was never wired into `updateTimeline()`'s own item/row labels at all.

Fixed by caching the last `getDynamicRules()` response on `state.dynamicRuleEntries` (populated by
`refreshEventRules()`, the same fetch the dropdown already used) and adding `resolveEventLabel()` in
`playback.ts`, which converts a `"Rule<N>"` `Type` to `Rule: N-1`'s `RuleName`, falling back to the
raw string if nothing matches. `"Normal"` items are left untouched — they aren't rule-triggered data
and were already correctly special-cased elsewhere (`assignEventColorClass()`).

The first cut matched candidates purely by `Rule` number, and the user immediately followed up: since
`getDynamicRules()` returns every rule configured on the *whole device*, not scoped to one channel,
and `Rule` numbering isn't guaranteed unique across channels, matching on `Rule` alone risks
resolving to a *different channel's* same-numbered rule on a multi-channel NVR. The fix ties back to
something already established the hard way in the entry below this one: `recording.cgi`'s own
`ChannelIDList` query param and `eventrules.cgi`'s `EventSources[].Channel` field are the *same*
0-based numbering space (`Number(player.channel) - 1`) — so `resolveEventLabel()` now additionally
requires the candidate rule's `EventSources` to include a row whose `Channel` equals the currently
selected player's own 0-based channel, the exact same value already sent as this search's own
`ChannelIDList`. See `docs/window-ui/SRS.md` FR-7.6 v1.17/v1.19.

Separately, unrelated to the Rule-matching fix but landed alongside it (same user, same session):
timeline item selection previously nulled `endTime` and disabled `#end_date`/`#end_time` specifically
for `"Normal"`-classed items — an undocumented `src/shared/window.ts` quirk with no rationale found
anywhere in the original, reproduced in `src/shared-v2/` up through v1.17 purely for parity.
`recording.cgi` always returns a real `EndTime` for every result row regardless of `Type`, so nothing
about the data justified singling out Normal. Reported as unwanted; `onSelect` no longer branches on
`className === 'normal'` — every item now sets and enables both Start and End Time. `src/shared/`'s
own untouched original keeps the old behavior. See `docs/window-ui/DESIGN.md`'s "Deviations from
legacy behavior" (FR-7.6 v1.18 entry).

## `#timeline` outlived Playback mode: moving it to a sibling position (for FR-7.8's two-panel split) fixed one hiding case but broke another

`#timeline`'s `<div>` was deliberately moved out from inside `#playback_control` to a sibling of both
`#playback_control`/`#playback_control_calendar` when FR-7.8 (the Calendar search panel) was added —
otherwise a `display:none` ancestor would hide it whenever the *other* Playback panel was the one
showing, defeating the goal of both panels rendering into the same shared timeline. That fix was
correct as far as it went, but it was also the only place `#timeline` visibility was ever wired to
anything: `updatePlaybackSunapiUIVisibility()` only ever set `style.display` on the two panels
themselves, and once `#timeline` was no longer nested inside either one, nothing in the codebase set
its `display` back to `'none'` under any condition. The result: switching Play Type from Playback to
Live correctly hid the Manual Start/End Time fields (they live inside `#playback_control`) but left a
previous Playback search's rendered timeline sitting on screen indefinitely, since a plain
`style.display = 'block'` (set by `updateTimeline()`/`runOverlappedAndTimelineSearch()` whenever a
search returns results) never gets touched again by anything outside the search flow itself.

Reported directly by the user, who noticed the exact asymmetry ("Date picker hides, timeline
doesn't"). Fixed with one added branch in `updatePlaybackSunapiUIVisibility()` (`playbackCalendar.ts`),
gated specifically on `!isPlayback` (Live mode) rather than the pre-existing `showCalendar`/`else`
branches, so the original sibling-placement behavior — never hiding `#timeline` when only switching
*between* the two Playback sub-panels — stays exactly as before. The lesson for next time a shared
element moves out from under a hide/show ancestor for one reason: check whether anything else was
implicitly relying on that ancestor to hide it too, not just the one case that motivated the move. See
`docs/window-ui/SRS.md` FR-7.8 v1.20 / `DESIGN.md` v1.20.

## Calendar's highlighted-recorded-days data had no channel-change refresh, unlike the Rule dropdown right next to it

`getCalendarSearch(YYYY-MM, channel)` (FR-7.8.4) — the request behind the Calendar's highlighted
"this day has recordings" days — is channel-scoped the exact same way `getDynamicRules()`'s Rule
dropdown is (FR-7.8.2, see the entry above about that dropdown's 1-based `Rule<N>` offset). The Rule
dropdown already had a channel-change refresh, `refreshRuleSelectForChannelChange()`, called from
`device.ts`'s `changechannel()` — but nothing equivalent existed for the Calendar's own month search.
Switching `#channel` while the Playback (SUNAPI) Calendar panel was showing correctly re-fetched the
Rule list, but the Calendar kept showing whichever channel's recordings it had last fetched, until the
user happened to navigate to a different month (which re-fetches for the new month anyway, incidentally
also picking up the new channel).

Reported directly by the user, who also proactively stated the precondition mid-request: every one of
these Playback (SUNAPI) Calendar requests — Language, Rule dropdown, Calendar month search, day-click
Overlapped Id/Timeline — must only ever fire while Play Type is Playback. That's exactly what the
existing `panel.style.display !== 'none'` guard in `refreshRuleSelectForChannelChange()` already
enforces (`#playback_control_calendar` is only ever shown when Play Type is Playback *and* SUNAPI is
On — see FR-7.8's `updatePlaybackSunapiUIVisibility()`), so the new `refreshCalendarSearchForChannelChange()`
(`playbackCalendar.ts`) reuses that identical guard rather than inventing a separate Play-Type check,
and re-runs `runMonthSearch()` for whichever month/year the mounted `CalendarController` currently
reports. Wired into `device.ts`'s `changechannel()` right alongside the existing Rule-dropdown refresh.
See `docs/window-ui/SRS.md` FR-7.8.4 v1.21 / `DESIGN.md` v1.21.

## Channel change during Playback: the Calendar-data refresh above was only 1 of 5 things that needed to reset

Immediately after the fix above shipped, the user came back with the complete scenario they actually
needed: switching `#channel` while Play Type is Playback should (1) refresh the Calendar's
highlighted days for the new channel — the fix above — plus (2) hide `#timeline`, (3) reset
Overlapped Id and hide its UI, (4) reset Manual Start/Manual End Time and hide their UI, and (5) stop
the player, since it may still be playing/paused on the *previous* channel's recording.

The interesting design question was scoping: FR-7.1–FR-7.7's manual Playback flow has its own
Overlapped Id (`#overlapped_id_area`) and Start/End Time (`#start_date`/etc.) — should (2)-(5) reset
those too, or only this Calendar panel's equivalents? Resolved by checking which targets actually
have a show/hide mechanism to reset: `#timeline` and the player instance are genuinely **shared**
between both Playback UIs (one element, one player, regardless of which flow last drove them), so
(2) and (5) run whenever Play Type is Playback, unconditional on SUNAPI state. But the manual flow's
`#overlapped_id_area`/`#start_date`/`#end_date`/etc. are static, always-visible field-rows with
**no** show/hide toggle at all — they're core permanent controls, not a progressively-revealed
search result like this Calendar panel's own `#calendar_search_area` (hidden until FR-7.8.4's first
month search resolves). "Hiding" fields that were never hideable would be inventing new behavior
nobody asked for, so (3) and (4) apply only when this Calendar panel is actually visible (SUNAPI On).

Implementation replaced the previous entry's `refreshCalendarSearchForChannelChange()` with a
broader `resetPlaybackSearchStateForChannelChange()` (`playbackCalendar.ts`) doing all 5 steps, same
call site in `device.ts`'s `changechannel()`. One real wrinkle found while implementing it:
`runMonthSearch()` (FR-7.8.4) already always re-shows `#calendar_search_area` once its own fetch
resolves, by original design — completely reasonable for its two pre-existing callers (initial
mount, month navigation), but it would have silently undone this new function's own step-4 hide a
moment later, since re-fetching the month for the new channel is itself the tail end of this same
reset. Fixed by giving `runMonthSearch()` a `revealSearchArea` parameter (default `true`, so both
pre-existing callers are untouched) and passing `false` from this new function's own re-fetch call —
refreshing highlighted days for the new channel should never re-reveal controls that have nothing to
show yet, since no day has been clicked for that channel.

See `docs/window-ui/SRS.md` FR-7.8.6 v1.22 and `DESIGN.md`'s new flow diagram (v1.22) for the full
implementation.

## Moving Rule into `#calendar_search_area` surfaced a day-click-vs-hidden-container race the previous entry's reset introduced

Right after the 5-part channel-change reset above shipped, the user asked for a smaller, related fix:
`#event_rules_type` (the Rule dropdown) lived in its own field-row next to `#event_rules_language`,
both appearing the instant the Calendar panel opened. That's correct for Language (a device-wide
`attributes.cgi` setting), but Rule is actually a Timeline search *filter* — read at day-click time by
`runOverlappedAndTimelineSearch()` exactly like Overlapped Id and Manual Start/End Time. The user
wanted it to appear at the same moment as those fields (once the Calendar has loaded, not immediately
on panel open) and positioned visually right before Overlapped Id.

The fix was structural, not behavioral: move `#event_rules_type`'s markup into `#calendar_search_area`
(same id, same `getDynamicRules()` population, unaffected by DOM position), positioned first. Since
that container already had exactly the show/hide timing being asked for (hidden until FR-7.8.4's month
search resolves, hidden again by the previous entry's FR-7.8.6 channel-change reset), the move alone
satisfied both the timing and positioning requests with no new visibility logic needed.

But this exposed a genuine, previously-latent bug from the *previous* entry's own reset:
`#calendar_search_area` is deliberately left hidden after a channel change until the next month
navigation re-reveals it (so the reset doesn't immediately undo itself). A highlighted calendar day,
however, stays clickable the entire time, completely independent of that container's own visibility —
`onCalendarDayClick()` never checked it. Before this fix, clicking a day right after a channel change
(with no month navigation in between) would populate Rule/Overlapped Id/Manual Start-End Time into a
still-`display:none` container: the underlying state (player.overlappedId, the search results) would
all be correct, but the user would see nothing, since the whole thing was invisible. This was a real,
if narrow, timing window created by the previous entry's own fix, not a pre-existing issue — it only
became reachable once `#calendar_search_area` could be left hidden across a day click at all (before
that entry, the container was shown once early and never hidden again for the rest of the session).

Fixed with one line: `onCalendarDayClick()` now unconditionally re-shows `#calendar_search_area` as
its very first step, before touching any of the fields inside it. Cheap and idempotent when the
container was already visible (the common case — a month navigation almost always precedes a day
click), and correct in the one case it wasn't. See `docs/window-ui/SRS.md` FR-7.8.2/FR-7.8.5 v1.23 and
`DESIGN.md`'s corresponding note.

## Rule dropdown had no `change` listener at all -- changing it silently did nothing until the next day click

Immediately after the Rule-move entry above, the user pointed out the actual functional gap it made
visible: `#event_rules_type`'s value was only ever read inside `runOverlappedAndTimelineSearch()`, at
day-click time. Changing the dropdown afterward — say, narrowing an already-searched day down to one
specific Rule — had zero effect; the `#timeline` results already on screen (from whatever `Type` was
selected at the last click) just sat there stale until the user clicked a day again. Reported directly
by the user with the real `recording.cgi?msubmenu=timeline...&Type=All` request, pointing out `Type`
should reflect the Rule dropdown's current selection.

Fixed by splitting `runOverlappedAndTimelineSearch()` into three pieces: `buildCalendarSearchTimeRange()`
(the existing `#calendar_start_date`/time + GMT-conversion logic, now shared, returning `null` when no
day has been clicked yet so callers can silently no-op), `runCalendarTimelineSearch()` (just the
`getTimeline()` call + `updateTimeline()` redraw, using whatever Overlapped Id/date range/Rule are
currently set), and `runOverlappedAndTimelineSearch()` itself (day click) now just calls
`getOverlappedIdList()` first — same digest-auth-race sequencing as before, see the `runMonthSearch()`/
`getOverlappedIdList` entries above — then delegates to `runCalendarTimelineSearch()` as its tail step.
`#event_rules_type` gained a `change` listener calling `runCalendarTimelineSearch()` directly.

One deliberate scope decision: a Rule change does **not** re-fetch Overlapped Id. Overlapped Id
identifies which overlapping recording session to search within, entirely independent of the
Timeline's own `Type` filter — re-fetching it on every Rule change would just be a wasted, redundant
request for data that hasn't changed. See `docs/window-ui/SRS.md`/`DESIGN.md` FR-7.8.2 v1.24.

## A real device's Timeline response mixed in a different channel's Rule events -- `resolveEventLabel()`'s channel check wasn't enough on its own

Reported directly by the user with a screenshot of the live app: with Channel 1 selected/queried
(`ChannelIDList=0`), the rendered `#timeline` showed `Rule5`/`Rule6`/`Rule8`/`Rule9` rows alongside
CH1's own `MD 1 (CH1)`/`MD 2 (CH1)` rows — but those four Rules are configured on Channel 2, per
`eventrules.cgi`'s own `EventSources[].Channel`. The v1.19 fix a few entries above (channel-matching
in `resolveEventLabel()`) only affects the *label* shown for a Rule# row/item — it doesn't stop the
row/item from being built in the first place. Since `resolveEventLabel()` falls back to the raw
`Type` string when no channel-matching rule is found, a cross-channel Rule event still rendered, just
unresolved (`"Rule5"` instead of a real name) — exactly what the screenshot showed.

The real question this raised: is a channel's Timeline response from the device itself supposed to
be scoped by `ChannelIDList`, with these appearing due to a device-side quirk, or is this expected and
purely a client-side filtering gap? Either way, the client has no way to *request* a narrower
response than the device already returned, so the fix has to be client-side regardless: added
`eventAppliesToChannel()` (`playback.ts`), using the exact same `state.dynamicRuleEntries` cache/
0-based-offset lookup as `resolveEventLabel()`, and filtering `results[0].Results` down to
`channelResults` at the very top of `updateTimeline()`, before either the row-building or
item-building loop ever sees the array. Two deliberate "don't filter" cases, both erring toward
showing rather than hiding when uncertain: `"Normal"` (never rule-triggered, always belongs to
whichever channel was actually queried) and a `Rule<N>` with **no** entry in `state.dynamicRuleEntries`
at all — as opposed to an entry that exists but for a different channel. The former is a genuine
"can't tell" case (rules not cached yet, e.g., calendar panel not yet opened this session); filtering
it would only ever hide data incorrectly, never correctly, since there's nothing to compare against.
See `docs/window-ui/SRS.md` FR-7.6 v1.25.

## v2.0 Playback search redesign: "move Manual Start/End Time into the widget" turned into retiring FR-7.1-7.3's entire manual search UI

The user's original 5-item request (screenshot of the live Calendar panel) looked scoped to the
Event Timeline widget alone: fix cross-channel leakage (the entry above), make its 1H/6H/1D/1W/1M/1Y
buttons trigger a real re-fetch, and move "Manual Start Time"/"Manual End Time" into the widget as
"Selected Time." Reading the existing code suggested `#start_date`/`#end_date` (FR-7.1's manual
flow) served two roles at once — typed search-range input for `search_overlapped_id()`/
`search_date()`/etc., *and* the display overwritten by a timeline item click — so a clarifying
question was asked about how to handle the search-input role if the fields moved.

The user's answer reframed the whole feature: *"start_time isn't a search feature ... search should
default to 1 day, using the timeline's own preset buttons."* This wasn't just answering the question
asked — it asserted the *target* design directly, which turned out to mean `#start_date`/`#end_date`
were never meant to be a search-range input at all in the intended design, only ever the click-to-
play display (their apparent dual-role in the *existing* code was incidental, not something to
preserve). Tracing every call site confirmed the real scope: `search_overlapped_id()`/
`search_date()`/`search_oneday_timeline()`/`search_three_month_timeline()`/
`search_timeline_by_range()`/`runTimelineSearch()`/`onchangestarttime()`/`onchangeendtime()`/
`onchangesupportendtime()` — essentially all of FR-7.1-7.4 — had no reason to keep existing once
`#start_date`/`#end_date` were retired, since that was their *only* remaining role after the display
role moved to the widget.

Given the size of what this implied (retiring ~9 functions and ~10 markup elements, unifying two
previously-separate Playback UIs onto one search mechanism, and — discovered only by grepping test
files — rewriting roughly 40 Playwright assertions across `video-playback-audio.spec.ts` (29 refs),
`event-timeline.spec.ts` (its `openNewPageWithTimeline()` helper and TC-3/TC-9), and
`playback-calendar.spec.ts` (TC-28/31/32/34/36)), this went through `EnterPlanMode` before any code
changed — the plan called out the scope explicitly rather than silently expanding a "move a UI
element" request into a UI-removal one. Two more targeted questions during planning (the preset
buttons' anchor point — "now," confirmed by the user — and whether to preserve open-ended/no-End-
Time playback — yes, confirmed) filled in the remaining design gaps before implementation started.

**What landed**: both Playback UIs (manual FR-7.1, Calendar FR-7.8) now source their search range
from one mechanism — a default "1 day ending now" search auto-fires the moment either panel becomes
visible (`playback.ts`'s `updateManualPlaybackPanelVisibility()`, mirroring
`playbackCalendar.ts`'s existing `panelInitialized` pattern), and the Event Timeline's own preset
buttons re-fire that same search for `[now-preset, now]` on click via a new `onRangePresetSelect`
callback (`docs/event-timeline-component/SRS.md` FR-5 v2.0) — the component still makes no network
calls itself (NFR-1 intact), it only hands the caller `Date` math. "Selected Time" (FR-13) is the
widget's own input pair, used by `onSelect` (item click) and a new `onSelectedTimeChange` (manual
edit) alike, string-based (`YYYY-MM-DD`/`HH:mm:ss`) to avoid a new timezone-conversion surface — the
widget never becomes SUNAPI/GMT-aware, `playback.ts` still owns all of that. A genuine latent bug
surfaced and got fixed as a side effect, not a separate task: the old `onSelect` handler always
wrote to `#start_date`/`#end_date` (the *manual* flow's ids) regardless of which Playback UI was
actually showing, so selecting an item while the Calendar panel was active silently updated hidden,
wrong fields the entire time this feature existed. One canonical Selected Time, owned by the widget
both flows share, makes that class of bug structurally impossible now.

Since the widget is destroyed and rebuilt on every search (`docs/event-timeline-component/`'s own
"not idempotent by design," unchanged), Selected Time would otherwise reset to "now, no end" on
every single refresh (a Rule change, a preset click, ...) — `playback.ts`'s `lastSelectedTime`
persists the last real selection and re-applies it via `setSelectedTime()` right after each remount,
the same general pattern already used for the SUNAPI/GMT-agnostic split elsewhere in this codebase.

See `docs/window-ui/SRS.md`/`DESIGN.md` v2.0, `docs/event-timeline-component/SRS.md`/`PRD.md`/
`DESIGN.md`/`TC.md` v2.0, and the plan file this session used
(`functional-seeking-milner.md`) for the full implementation.

## v2.0's auto-fired search surfaced two real bugs that a user-triggered button had always masked

Turning FR-7.1's manual search from "a button the user clicks" into "a search that fires
automatically the instant Playback mode is entered" (the v2.0 redesign above) exposed two real,
pre-existing assumptions in `search_overlapped_id()`'s own logic that a human clicking a button had
always incidentally satisfied, but an unconditional auto-fire does not:

1. **`state.deviceInformation.attributes.MaxChannel` threw when read before it existed.**
   `state.deviceInformation.attributes` is only populated deep inside `initSunapiManager()`'s own
   ~6-7-request async chain (`device.ts`) — that function is fire-and-forget (`void`, no Promise),
   so `runManualTimelineSearch()`'s very next line, checking `Number(state.deviceInformation
   .attributes.MaxChannel) === 1` to decide whether to omit the `channel` argument for single-
   channel cameras, read `undefined.MaxChannel` and threw on this function's *first-ever* call each
   session. The original `search_overlapped_id()` has the exact same code, but a human only ever
   clicked it well after SUNAPI had already finished initializing via the checkbox flow, so the race
   was never actually reachable in practice. Caught by the (pre-existing) try/catch, so the visible
   symptom wasn't a crash — the search silently never ran, and `#timeline` never populated. Fixed
   with optional chaining (`state.deviceInformation.attributes?.MaxChannel`), falling through to the
   `else` branch (explicit `channel` argument) when not yet loaded — the same behavior every
   multi-channel device already takes.
2. **Auto-firing before any device is even selected surfaced real connection-error popups.**
   Switching Play Type to Playback is a perfectly normal thing to do *before* picking a device row
   (e.g., exploring the radio buttons first) — `state.getSelectedPlayer()` still returns a real,
   non-null player element in that state, just with an empty `hostname`. Auto-firing
   `initSunapiManager()`/`getOverlappedIdList()` against that blank device surfaced real
   `SunapiError`/`RTSPOverWebSocketBaseError`/connection-failure `popup()` calls from deep inside
   `initSunapiManager()`'s own chain, for a state that was never actually an error — found live via
   Playwright (`#myModal` intercepting a later, unrelated click). A user-triggered button never hit
   this either, for the same reason as bug 1: nobody clicks "Search Overlapped Id" before selecting
   a device. Fixed with a guard in `updateManualPlaybackPanelVisibility()`:
   `player !== null && player.hostname` before firing. Known remaining gap, not chased further
   (no test needs it, and every realistic flow selects a device before touching Play Type): if the
   user picks Playback *before* a device, the guard correctly skips the auto-search, but nothing
   currently re-triggers it once a device is picked afterward — a manual mode switch (Live, then
   back to Playback) would still self-heal, since `manualPanelInitialized` only flips `true` on the
   guard's success branch.

The general lesson: converting a user-gated action into an automatic one doesn't just change *when*
it runs, it removes every implicit precondition a human satisfied by the sheer act of choosing to
click it — both of these were "obviously fine" as written for a decade of manual clicks and only
became reachable the moment the click was removed.

## Draggable current-time marker (FR-14): a design error, corrected before it shipped

`src/shared/window.ts` shows `#seeking_date`/`#seeking_time` (Playback's current-position readout)
in the Video Control panel, driven by `ontimestamp()`'s `'playback'` case. The user asked for two
things on top of that: (1) show that same position as a moving line inside `#timeline`, and (2)
dragging that line should seek `rtsp-over-websocket`, updating `seeking_date`/`seeking_time` as it
does. Implemented first, incorrectly, as: move the `#seeking_date`/`#seeking_time` *display itself*
into the Event Timeline widget (a new "Current Time" readout inside `event-timeline.ts`), reasoning
by analogy from the FR-13 Selected Time consolidation earlier that same session (which *was*
explicitly requested — collapsing several scattered fields into one widget-owned control). That
analogy did not hold here and the user rejected it sharply: "누구 맘대로 Current time 을 timeline
에 넣으라고 했어... 내 의도를 모르면 물어봐라" (nobody told you to put Current Time in the
timeline — if you don't understand my intent, ask). The actual request was narrower: leave
`#seeking_date`/`#seeking_time` exactly where they already are; the timeline only gains a
non-duplicating visual marker plus drag-to-seek behavior on it.

Corrected design (see `docs/event-timeline-component/SRS.md` FR-14, v2.1): `setCustomTime()` now
also accepts `null` to hide the marker; `playback.ts`'s `ontimestamp()` only updates it while
`readyState === PLAYING`; `videoControl.ts`'s `onstatechange()` explicitly clears it
(`setCustomTime(null)`) on `STOPPED`/`PAUSED`, since `ontimestamp()` simply stops firing once
playback isn't `PLAYING` and nothing else would ever clear a stale line otherwise. Dragging the
marker (`onCustomTimeSeek`, fires once on pointer release, matching an earlier
"drag continuously vs. once on release" clarification from the same user) writes straight into the
existing `#seeking_date`/`#seeking_time` inputs and calls `player.seekingTime`, mirroring the
existing `onDoubleClick` handler's GMT-aware branching and `readyState === PLAYING` guard rather
than inventing a new seek pathway.

The general lesson, stated directly by the user: a consolidation pattern validated for one field
(Selected Time) does not automatically license applying the same move to a different field (Current
Time) just because they look structurally similar (both are "a time associated with the timeline").
When a UI-placement decision isn't explicitly covered by what was asked, ask before moving something
out of where it already lives — don't extend an approved pattern by analogy.

## FR-14 follow-up: two more real bugs found testing the corrected design, one pre-existing and unrelated

Testing the corrected FR-14 marker (above) surfaced two more real bugs, reported directly by the
user, neither of which was actually caused by FR-14 itself:

1. **`#seeking_date`/`#seeking_time` (and Forward/Backward/Speed/BestshotFilter) were invisible
   whenever the Calendar/SUNAPI flow was active** — pre-existing since FR-7.8, just never reported
   until someone went looking for Seeking Date/Time specifically. `updatePlaybackSunapiUIVisibility()`
   hides all of `#playback_control` (`display:none`) whenever `showCalendar` is true, but that
   container held more than manual-flow *search* UI — the "Control:" field-row (Forward/Backward/
   Speed/ISO checkbox/Seeking Date/Seeking Time) and BestshotFilter are video-playback controls with
   no relationship to which search flow found the recording. Fixed by extracting them into a new
   sibling, `#playback_video_controls`, gated on `isPlayback` alone — the same "shared, gated only on
   Playback mode itself" pattern `#timeline` already used (see FR-7.8's own DESIGN.md note), just not
   yet applied to this block when the Calendar split was first built.
2. **The marker didn't visually cover the "ALL EVENTS" overview row** — a real layout bug in the
   FR-14 work itself, not a regression: `renderCustomTime()` appended the marker into `.event-timeline-rows`
   (the detail-rows container), which is a *sibling* of the overview row's own element, not an
   ancestor of it — so `top:0;bottom:0` only ever spanned the detail rows, even though visually
   abutting the overview row above made it look like one continuous line. Fixed with a new
   `.event-timeline-rows-wrapper` containing both the overview row and `.event-timeline-rows`; the
   marker now positions/appends relative to that wrapper instead.

Neither bug was caught by Playwright (`event-timeline.spec.ts`'s TC-6/7/TC-8 failures at the time
were the unrelated pre-existing viewport/pointer-capture issues, not these) — both were found only
by the user manually exercising Playback against a real device. General note for this pattern
specifically: a `display:none` toggle on a *container* silently takes everything nested inside it
down with it, including elements that have nothing to do with why the container exists — worth
double-checking what's actually inside a panel before gating its visibility on a condition that only
applies to *part* of its contents.

## `#seeking_date`/`#seeking_time` retired: unified into the shared `#timestamp_date`/`#timestamp_time` readout

Legacy `window.ts` has two functionally-identical but separately-implemented read-only current-
position readouts in `ontimestamp()`: `'live'` mode lazily creates `#timestamp_date`/`#timestamp_time`
in `#live_control`; `'playback'` mode writes to a separate, always-present static `#seeking_date`/
`#seeking_time` pair instead. `src/shared-v2/` ported both mechanisms faithfully at first. The user
asked, across several messages, to fully unify these into one pair — `playback.ts` now has a single
`updateTimestampReadout(dateStr, timeStr)` helper (lazily creates `#timestamp_date`/`#timestamp_time`
in `#live_control` exactly like `'live'` mode always did) that both `ontimestamp()` cases call, and
the Event Timeline's `onCustomTimeSeek` (FR-14) drag-seek handler now writes into the same pair
instead of the retired `#seeking_date`/`#seeking_time`, which were removed from `window.html`/
`setupPlayback()` entirely (no longer referenced anywhere).

Two things worth remembering about how this was reached:
1. **The user's intent took several rounds to pin down exactly**, and I nearly misdiagnosed the
   underlying report as a *visibility* bug (the `#playback_video_controls` fix above, which was real
   and needed) when the user separately, explicitly wanted the two mechanisms *unified*, not just
   made visible. When a user says a field "disappeared" and a plausible visibility bug exists, that
   doesn't rule out the field also being the wrong mechanism entirely — confirm which one (or both)
   before considering it resolved. `AskUserQuestion` correctly disambiguated Live vs. Playback here,
   but the actual instruction ("route playback's readout through timestamp_date/timestamp_time") only
   arrived once the user pasted the exact legacy code block and named the target fields directly —
   worth reaching for that level of concreteness sooner when a Q&A round doesn't fully resolve intent.
2. **A "reverse playback" symptom was reported for the new drag-seek feature** ("이걸 움직여 재생하면
   역으로 재생됩니다") that I could not conclusively root-cause without real hardware (WSL2 can't
   reach real devices — see CLAUDE.md). The most plausible cause found via code review: `#speed`'s
   dropdown has negative options (`-0.25x`..`-256x`) for intentional reverse playback, and
   `changespeed()` sets `player.playSpeed` from it directly with no reset on seek — a stale negative
   selection from earlier testing would persist across an unrelated seek. Mitigated by having
   `onCustomTimeSeek` force `#speed`/`player.playSpeed` back to `'1'` on every drag-seek. This is a
   best-effort fix based on the most plausible mechanism identified, not a confirmed root cause —
   flagged as such rather than claimed fixed, since it couldn't be verified against real hardware.

## `npm run build:shared-v2` alone does NOT refresh `src/component/*` CSS in the shipped `dist/`

Edited `src/component/switch/switch.css` (a new disabled-radio style, FR-12) and ran only
`npm run build:shared-v2` to ship it — `dist/nodejs/examples/public/css/switch.css` stayed
byte-for-byte the OLD version despite the build reporting success, no error anywhere. Root cause:
`switch.css`/`disclosure.css` are copied into `dist/chrome-extension|nodejs`'s `css/` by
`scripts/build.js`'s function for the **original** `src/shared/` page (`npm run build`'s own asset
step) — they're genuinely shared components used by both pages (CLAUDE.md's switch-component note
doesn't say "-v2 only" for a reason), copied once from `src/component/` since that lives outside
`src/shared/`'s own `copyDir`. `buildSharedV2()`'s own dist-overwrite step (the thing that runs
`npm run build:shared-v2` on its own actually touches) only overwrites `window.html`/`window.js`/
`scripts/socket.js`/`css/calendar.css`/`css/event-timeline.css` per CLAUDE.md — it does **not**
re-copy `switch.css`/`disclosure.css`/`window.css`, since those are assumed already current from a
prior full `npm run build`. If that full build is stale (or was never run this session), editing a
`src/component/*` CSS file and only re-running `build:shared-v2` ships nothing — confirmed via a
direct `grep` on the dist output before vs. after adding a plain `npm run build` in between, which
fixed it. Takeaway: any edit to `src/component/switch|disclosure|calendar|event-timeline` CSS needs
a **plain `npm run build` first**, then `npm run build:shared-v2` on top, even though the CLAUDE.md
build docs only explicitly warn about this ordering for `window.html`/`window.js` — CSS shared this
way is silently subject to the exact same trap.

## "Run discovery automatically" toggle: server-side background loop was fine, client never opened the WS

Reported directly by the user: this toggle works in the Chrome Extension but not via the nodejs
server as a plain web page. Traced by reading both sides of the transport (`docs/architecture.md`'s
IS_EXTENSION split): `server.ts`'s background UDP discovery loop was already correct and running by
default (`setAutoDiscoveryEnabled(AUTO_DISCOVERY_DEFAULT)` at boot, plus a proper "replay
`knownDevices`, then run one round, then keep streaming" sequence on every new `/discover` WS
connection — a deliberate mirror of `background.ts`'s `wisenet-request-known-devices` catch-up for
the extension). The bug was entirely on the **client** side: `toolbar.ts`'s
`applyAutoDiscoverySettingUI()` disabled `#init`/`#disconnect` when the setting was on, but never
actually called `socket.start()` — for the extension this is fine (a real `chrome.runtime` connection
already exists in `background.ts`'s own service worker, independent of whether `window.html` is even
open, and `discovery.ts`'s `chrome.runtime.onMessage` listener picks it up unconditionally), but
outside the extension nothing else opens this page's own `/discover` WebSocket. The net effect: the
toggle defaulting to "on" left the discovery table permanently empty *and* the one button that could
open the connection manually (`#init`) disabled — worse than doing nothing. Fixed by having
`applyAutoDiscoverySettingUI()` call `socket.start()`/`socket.stop()` itself when `!IS_EXTENSION`.

The general lesson: a toggle whose real effect lives in a background *process* (a service worker, a
server) rather than in the toggle's own UI code is easy to half-port when adding a second transport —
the extension case "worked" here because the process (`background.ts`) enforced the setting on its
own regardless of what the toggle's change handler did; the web case had no such independent
enforcer, so the toggle's UI code needed to be the actual enforcement, and wasn't.

## `disabled` blocks user clicks, not a scripted `.checked` assignment — the HTTP/HTTPS lock's real bug

Locked `#http_type_toggle` to `document.location.protocol` outside the extension (previous entry-
adjacent session work) by setting `.checked` + `.disabled = true` once in `setupDevice()`. The user
reported the lock "seems reversed" — but on investigation the *initial* lock was correct; it just
silently broke the instant a discovered device was clicked. `discovery.ts`'s
`applyDiscoveredDeviceSelection()` (FR-2.5) re-syncs the radios to *that device's own* advertised
`http`/`https` (`row_data[5]`) on every selection, and `disabled` on a native `<input>` only prevents
*user* interaction (clicks) — it does nothing to stop a script from still assigning `.checked`
directly, which is exactly what that handler does. So selecting a device whose discovered protocol
happened to differ from the page's own scheme flipped the "locked" toggle right back, looking exactly
like a reversed/backwards lock even though the lock's own boolean logic was never wrong. Fixed by
guarding just those two lines with `if (IS_EXTENSION)` in `discovery.ts`.

Two lessons: (1) `element.disabled = true` is not a substitute for auditing every OTHER place that
writes to the same element's state — it only stops the one interaction path (direct user clicks) most
people think of first. (2) When a user says a fix "seems reversed," don't assume the comparison/
boolean logic itself is inverted — ask what sequence of actions they took; here the bug wasn't in the
lock's own condition at all, it was a second, unrelated code path re-asserting a different value
right after the correct one was already set.

**Follow-up**: the `discovery.ts` guard above turned out to only be the first of *two* places
re-asserting the radios, and fixing just it wasn't enough — the user retested with an exact repro
(`http://localhost:8080`, selecting a discovered `https://192.168.x.x/index.htm` camera on port 443)
and the toggle still flipped. The real, deeper trigger was one hop further down the event chain:
`applyDiscoveredDeviceSelection()` sets `player.port` to the device's own port; the player custom
element's own attribute setter for `"port"` dispatches a `'changeport'` event as a side effect
(unconditionally, regardless of extension/web — this comes from the vendored
`@melchi45/rtsp-over-websocket` library itself, not this app's code); `playerEvents.ts`'s
`onchangeport()` handles that by writing `player.https = (port === 443)`; setting `.https` on the
player triggers *its own* attribute setter, which dispatches `'changeprotocol'`; and
`onchangeprotocol()` (device.ts) is what actually flips the radios in response to *that*. None of this
touches `discovery.ts` at all — a fix scoped to that one file could never have caught it. Fixed by
also guarding `onchangeport()`'s `.https =` write (the real fix — this is what keeps the actual
outgoing connection scheme consistent with the lock, not just the radios' visible state) and, for
defense-in-depth, `onchangeprotocol()` itself.

Sharper version of the lesson above: when a value gets re-asserted through a chain of `.property =`
assignments that each trigger a custom element's own dispatch -> listener -> another `.property =`
assignment, "guard the place I see the wrong value appear" (`discovery.ts`, or later
`onchangeprotocol()`) finds the last stop in the chain, not necessarily the actual source. Tracing
which attribute setter in the *vendored library itself* fires which event was necessary here —
grepping the bundled `rtsp-over-websocket.esm.js` for `dispatch("changeport"`/`dispatch("changeprotocol"`
is what surfaced the `port === 443 -> .https` link, not anything visible from this app's own source
alone.

**Follow-up 2**: the user also asked for `#port` itself to get the same lock, explicitly distinguishing
intent from the extension case: in the extension, a selected device's own port stays the default
(unchanged); outside it, the port should default to `80`/`443` matching the locked scheme, not the
device's own advertised port. Extended `applyDiscoveredDeviceSelection()` (`discovery.ts`) with an
`IS_EXTENSION` ternary right where `row_data[3]` was previously used unconditionally.

## "Normal" gets its own Event Timeline detail row too — not a reversal of the earlier All-row merge

An earlier session merged what used to be separate Normal/Event rows into one combined `"All"` row
(see this file's much earlier `vis.Timeline` history), and Rule#-triggered events later each got an
*additional* dedicated detail row alongside `"All"` (v1.15) — but `"Normal"` was deliberately excluded
from that per-type row treatment (`ruleGroupIds` explicitly filtered `key !== 'normal'` in
`playback.ts`), so it only ever showed up merged into `"All"`, never as its own row. The user asked
for Normal to get the same per-type row every Rule# already has. This is additive, not a reversal of
the original All-row merge — `"All"` still exists and still shows everything combined; Normal just
also now gets a second copy of each of its own items in a dedicated `"Normal"` row, exactly the same
mechanism (`colorClass === 'normal' ? 'Normal' : Type` picks the second copy's `rowId`) already used
for Rule# groups, gated the same way (`hasNormal` mirrors "only add a row for a type that actually
occurs"). Worth remembering because the two changes look superficially contradictory read out of
context ("merge Normal into one row" vs. "give Normal its own row") — they're actually orthogonal:
the merge was about not having *separate Normal-only and Event-only* rows any more; the per-type rows
are a *supplement* to the merged "All" row, and Normal simply hadn't been given one yet.

## Empty preset results were silently discarded — `updateTimeline()`'s data extent was purely item-derived

Reported directly by the user, alongside two smaller Event Timeline asks (wheel-zoom on the overview
row's own track, which had none; and a devtools-only `__web-inspector-hide-shortcut__` class the user
saw in the Elements panel, which is a Chrome DevTools "H" hide-element artifact, not anything this
codebase ever adds — nothing to fix there). The substantial one: "1H should show the full hour even
with no data, same for 6H/1D/1W/1M/1Y." Two independent bugs compounded to defeat this:

1. `mountEventTimeline()`'s `dataStart`/`dataEnd` (the full extent used for the overview scale *and*
   the outer zoom-clamp bound) were always computed purely from `config.items`' own min/max — with
   zero items, or items narrower than the requested period, the displayed extent silently shrank to
   match, never the actual requested `[fromDate, toDate]`.
2. `updateTimeline()` (`playback.ts`) skipped mounting the widget *entirely* whenever
   `results[0].Results` came back empty — just a "Result is empty" popup and nothing else. A 1H
   preset with genuinely zero motion events in the last hour (an entirely normal outcome, not an
   error) hit this every time, so there was no widget at all to even apply a wider extent to.

Fixed both: `MountEventTimelineOptions` gained an optional `dataRange: {start, end}` that seeds the
extent instead of it being purely item-derived; `updateTimeline()` narrowed its "is this an error"
check to just the outer envelope (`results.length === 0`) and now always passes its own requested
range through as `dataRange` from both call sites (the manual flow's `fromDate`/`toDate`, the
Calendar flow's `strSearchStartTime`/`strSearchEndTime` parsed to `Date`s).

**Follow-up, found immediately by re-running the Playwright suite** (not by the user): the first cut
of the `dataRange` fix *unioned* it with the item extent, "defensively, in case an item ever falls
outside the requested range." This union broke TC-6/TC-7 (click an item) and TC-8 (click a Hide
button) hard — every item rendered but crammed into an unusably tiny, overlapping sliver, so real
mouse/Playwright clicks landed on the wrong item or nothing at all. Root cause:
`tools/mock-sunapi-server/`'s Timeline fixture is a **fixed historical date** (`2026-01-15`,
hardcoded), while the actual test run's "now" was 2026-09-01 — a real server would never return items
outside its query window, so unioning was supposed to be a no-op, but this mock always returns the
same static fixture regardless of the query's actual date range (already documented elsewhere in this
file). Unioning a "now"-anchored requested range with a fixture dated ~7.5 months earlier produced a
combined extent spanning that entire gap, compressing all 150 real items into a sliver at one edge.
Fixed two ways: (1) dropped the union entirely — `dataRange`, when provided, is now the extent,
unconditionally, matching how a real, well-behaved server actually works; (2) also fixed the mock
fixture itself (`buildMockTimelineResults()`) to anchor its ~150-item, ~10-11-hour cluster to
`Date.now() - 20h` (computed once at server startup) instead of the fixed calendar date, so it stays
within a realistic "last 24 hours" window for as long as the mock server process stays up. Confirmed
safe against `CALENDAR_SEARCH_RESULTS`'s own use of the old `MOCK_DATE`-keyed object first —
`parseRecordedDaysFromCalendarSearch()` (`playback.ts`) only ever reads the response's `Result`
bitmask values, never checks that the object's own date *key* matches the currently-displayed
calendar month, so changing the Timeline fixture's anchor doesn't affect that calendar test at all.
Also had to add a *third*, unrelated fix to keep the same test suite green: `applyDiscoveredDeviceSelection()`'s
new FR-4.10 port lock (see the entry above) forces `#port` to `80`/`443` outside the extension on
every device selection — which broke every test that selects the mock device (whose "camera" is
really just the mock server itself, reachable only on its own non-standard port) and then relies on
live SUNAPI communication afterward. Fixed by having the test's own helper explicitly refill `#port`
back to the mock server's real port right after selecting the row (mirroring how it already
re-fills `#username`/`#password`), rather than weakening the FR-4.10 lock itself for a test-only
convenience it was never meant to accommodate.

The general shape of the ORIGINAL bug is worth remembering: a "full extent" that's silently *derived*
from the data (rather than the *request* that produced the data) looks correct for every
well-populated test case and is wrong in exactly the case nobody tests by hand — a short,
genuinely-empty window. Deriving the extent from data was fine back when every search was guaranteed
non-trivial (the original 3-month/1-day manual ranges); it stopped being fine the moment 1-hour
presets made "legitimately zero events" a routine outcome rather than an edge case. Separately, the
union follow-up is its own lesson: a "defensive" fallback added for a case that "should never happen
against a real server" can still be the thing that breaks against a *test double* that doesn't behave
like a real server at all — worth checking what the test fixtures actually simulate before assuming
defensive code is free.

## `eventAppliesToChannel()`'s cross-channel filter could itself wrongly drop same-channel events

Reported directly by the user, comparing a real device's raw `recording.cgi?msubmenu=timeline`
response against the rendered `#timeline` — the response was dense/continuous, but the rendered
result had visible gaps. Traced to `playback.ts`'s `eventAppliesToChannel()` (added earlier, see the
"real device's Timeline response mixed in a different channel's Rule events" entry above): for a
`Rule<N>` type, it did `state.dynamicRuleEntries.find(candidate => candidate.Rule === ruleNumber - 1)`
— finds the *first* entry with that Rule number, then checks only *that one* entry's
`EventSources[].Channel`. `getDynamicRules()` can list the same numeric Rule configured separately per
channel (the earlier cross-channel-leak bug only makes sense if it does), so when a different
channel's same-numbered entry happened to sort first in the array, `.find()` landed on it instead of
the actually-queried channel's own entry — wrongly rejecting a legitimate same-channel event as
"belongs to a different channel." `resolveEventLabel()` right above it never had this bug: its own
`.find()` predicate already required Rule number **and** `EventSources[].Channel` together in one
compound condition. Fixed `eventAppliesToChannel()` to match: `.filter()` down to every entry sharing
the Rule number first, then check whether *any* of them include the queried channel, instead of
picking one entry via Rule number alone and trusting it. General lesson: two functions solving the
"same Rule number, ambiguous across channels" problem right next to each other, only one of which
actually disambiguates correctly, is exactly the kind of inconsistency that's invisible reading either
function in isolation — worth checking that near-duplicate lookup logic in the same file actually
agrees before trusting a "this one's already been fixed" comment to also cover its neighbor.

## Event Timeline's Normal row had a different height than every other row — a bare `.normal` CSS class collision, not a component bug

Reported directly by the user, alongside two related layout complaints (row-title labels not lining
up across rows, and the overview row's collapse button not actually collapsing it — see below and
`docs/event-timeline-component/SRS.md` v2.9 for all three). This one took a real browser + DOM
inspection to find, not just reading the component's own source (`event-timeline.ts`/`.css`
individually looked correct in isolation): `src/shared-v2/`'s `window.html` loads `css/table.css`
reused as-is from `src/shared/` (same shared-asset convention as `socket.ts`), and that file has its
own, unrelated `.normal { height: 40px; border: 1px solid red; }` rule — meant for something else
entirely in the discovery result table. `playback.ts`'s `assignEventColorClass()` returns the bare
string `'normal'` as the Normal row's `colorClass`, which event-timeline.ts then adds as a literal,
un-namespaced CSS class on that row's label (`event-timeline-row-label normal`) and its items
(`event-timeline-item normal`) — a plain, single-class selector match, so table.css's rule applied
right alongside event-timeline.css's own (more specific, two-class) `.event-timeline-row-label.normal
{ color: ... }`, inflating just that one row's header height (measured live: 50px vs. 36px for every
other detail row) and painting a red border nobody asked for. None of the *other* color classes
(`motiondetection`, `ai`, `unknown`, ...) happened to collide with anything else on the page, which is
exactly why this stayed invisible until "Normal" specifically was added as its own detail row.
Fixed by namespacing every one of `EVENT_COLOR_CLASSES`/`assignEventColorClass()`'s color-class
strings with an `evt-` prefix (`evt-normal`, `evt-motiondetection`, ...) — matching the
`--evt-<class>-border`/`-bg` custom-property naming already used for the same classes — and updating
`event-timeline.css`'s selectors and the equivalence-test suite's own `.normal`-keyed locators to
match. General lesson: a component's own CSS/TS can be internally 100% consistent and still break
from a class-name collision with a completely unrelated, page-wide stylesheet it happens to share —
worth namespacing dynamically-assigned class tokens defensively rather than assuming a short, generic
name like `normal`/`ai`/`unknown` is safe just because nothing *inside* the component itself uses it
for anything else.

**Follow-up, requested directly by the user right after the `evt-` fix landed**: `table.css`'s
`.normal` rule had its `height: 40px` line deleted outright (its `border` line is untouched — only
the height was ever implicated), rather than leaving it in place now-unreachable behind the rename.
Same change also standardized every row to a fixed `height: 20px` (`.event-timeline-row`/
`.event-timeline-row-track`/`.event-timeline-overview-track`, previously auto/30px/25px
respectively) — see `docs/event-timeline-component/SRS.md` v2.10.

**Follow-up, requested directly by the user right after the `evt-` fix landed**: `table.css`'s
`.normal` rule had its `height: 40px` line deleted outright (its `border` line is untouched — only
the height was ever implicated), rather than leaving it in place now-unreachable behind the rename.
Same change also standardized every row to a fixed `height: 20px` (`.event-timeline-row`/
`.event-timeline-row-track`/`.event-timeline-overview-track`, previously auto/30px/25px
respectively) — see `docs/event-timeline-component/SRS.md` v2.10.

## Event Timeline row titles didn't line up, and the overview row's collapse button didn't actually collapse it

Two more parts of the same user report as the `.normal` collision above. Both root causes were
visible only by inspecting real rendered geometry (`getBoundingClientRect()`), not by reading the
CSS/TS in isolation:

- **Row-title alignment**: only the overview ("ALL EVENTS") row's header has a leading collapse
  button (`▾`); every detail row's header goes straight from its left edge to the label. That extra
  button (plus its `gap`) pushes the overview row's own label ~20px further right than every detail
  row's label starts, so the label column doesn't line up as the eye scans down the row headers.
  Fixed by giving every detail row header an invisible, same-width spacer
  (`.event-timeline-collapse-btn-spacer`) in the same position the real button occupies on the
  overview row — not by removing the button or restructuring the layout.
- **Collapse button**: `.event-timeline-overview-collapsed .event-timeline-overview-items { display:
  none; }` only ever hid the item markers, leaving the track itself (and the draggable
  zoom-window highlight inside it) at its original full height — clicking `▾` visibly changed
  nothing about the row's own size, just emptied it out, which reads as broken rather than as
  "collapsed." This was in fact the *documented, deliberate* v2.3-era design (SRS.md FR-3: "the
  highlight rectangle itself stays visible either way, since it's the pan/zoom control, not just a
  display") — reversed here per the user's direct, current request: the selector now targets
  `.event-timeline-overview-track` (items, highlight, and edge-handles together), so collapsing
  genuinely folds the row down to just its header, at the cost of the highlight/pan-zoom control
  also being unavailable while collapsed. Worth remembering next time this area changes again: this
  is the second time this exact behavior has flipped (v2.3 deliberately chose "keep the highlight
  visible", v2.9 deliberately reversed it) — check history before assuming either direction is
  obviously correct.

## Overlapped Id moved into the Event Timeline widget — remounting on Rule change nearly clobbered a manual pick

Requested directly by the user: move Overlapped Id (previously two separate, near-identical
`<select>`s DOM-built by `playback.ts`'s manual flow into `#overlapped_id_area` and
`playbackCalendar.ts`'s Calendar flow into `#calendar_overlapped_id_area`) into the shared Event
Timeline widget's own toolbar, immediately left of the 1H/6H/1D/1W/1M/1Y preset buttons — the same
single-canonical-control move `docs/event-timeline-component/SRS.md` v2.0 already made for Selected
Time. See that doc's FR-15 (v2.11) and `docs/window-ui/SRS.md` v2.14/DESIGN.md v1.28.

The one real design trap: `event-timeline.ts`'s `mountEventTimeline()` is **not** idempotent (FR-12)
— every `updateTimeline()` call fully destroys and rebuilds the widget, Overlapped Id select
included. `playbackCalendar.ts`'s Rule dropdown (`#event_rules_type`'s `change` listener,
`runCalendarTimelineSearch()`) redraws `#timeline` on every Rule change but deliberately does **not**
re-fetch Overlapped Id (`getOverlappedIdList()` doesn't depend on `Type`) — so a naive port would
have silently reset a user's manually-picked Overlapped Id back to the list's own default every time
they changed the Rule filter, since the freshly-remounted select has no memory of what was selected
before the destroy. Fixed by having `runCalendarTimelineSearch()` compute the query's own
`overlappedId` from `state.eventTimeline?.getOverlappedId()` (the *live*, pre-remount selection)
whenever it's still a member of the cached `currentOverlappedIds` list (true for a same-day Rule
change), falling back to that list's own default only when it isn't (a genuinely fresh day/preset
fetch just replaced the list) — and threading that same resolved value back into `updateTimeline()`'s
new `selectedOverlappedId` parameter (`event-timeline.ts`'s `setOverlappedIds(ids, selectedId)`) so
the remounted select keeps showing it instead of silently snapping to the default. General lesson:
whenever a stateful control moves into this component, check every caller that redraws `#timeline`
*without* also re-fetching that control's own data — FR-12's full-remount-every-time design means
"the control's value" and "the data used for the just-completed query" can silently diverge unless
the caller deliberately threads the query's actual value back through the next mount.

## `src/shared-v2/` build shipped with no sourcemaps — same gap as `@melchi45/rtsp-over-websocket`

Reported need: debug `playerEvents.ts`'s `element.addEventListener('timestamp', ontimestamp)` →
`playback.ts`'s `ontimestamp()` (FR-7.7) in the actual browser console — after the TS→JS build,
DevTools could only step through the bundled/minified `window.js`, not the original
`src/shared-v2/modules/*.ts`.

Root cause, and fix, is the same shape as `@melchi45/rtsp-over-websocket`'s own version of this gap
(see that package's own `MEMORY.md` — worked on directly earlier in the same session, initially
*in that repo* on a misidentified `onTimestamp` in its `src/player/react/Player.tsx`, which is a
different, unrelated no-op listener; the real ask was always this repo's `src/shared-v2` one).
`src/shared-v2/vite.config.ts` never set `build.sourcemap`. Fixed by adding `sourcemap: true`
(unconditional — `npm run build:shared-v2` and the new `npm run build:shared-v2:dev` both emit
`window.js.map`), converting the config to `defineConfig(({ mode }) => ({...}))` so a new
`build:shared-v2:dev` script (`scripts/build.js`'s `buildSharedV2({ dev: true })`, wired to
`node scripts/build.js shared-v2:dev`) can pass `--mode development` through to `vite build` and
set `minify: mode !== 'development'` — mirroring `@melchi45/rtsp-over-websocket`'s own
`build:player`/`build:player:dev` split exactly. `buildSharedV2()` also now copies
`rtsp-over-websocket.esm.js`'s sibling `.map` (guarded with an existence check, since an
older-installed copy of that package may predate its own sourcemap support) alongside the existing
`rtsp-over-websocket.esm.js` copy into `external-lib/rtsp-over-websocket/` — the Worker-chunk
sourcemaps under its `assets/` subdirectory were already covered by the existing wholesale
`copyDir()` call.

**Caught only by actually running the build and checking for the file**: `sourcemap: true` alone
was not sufficient — `buildSharedV2()` copies specific named files out of `build/shared-v2/` into
`dist/shared-v2-preview/` (and, in the overwrite loop, on into the real `dist/chrome-extension/`/
`dist/nodejs/examples/public/`) rather than the whole directory, and the original file list
(`window.html`, `window.js`, `scripts/socket.js`, ...) predates sourcemaps existing at all, so
`window.js.map` was silently never copied anywhere — Vite wrote it into `build/shared-v2/` and it
just sat there, unreferenced, while every `dist/` output shipped a `//# sourceMappingURL=
window.js.map` comment in `window.js` pointing at a file that didn't exist alongside it (a 404 in
DevTools' Network tab, not a build error — easy to miss without actually opening DevTools against
a real build). Fixed by adding `window.js.map` to both the initial assembly copy list and the
real-`dist/`-overwrite loop.

New `.claude/skills/window-ui/SKILL.md` added alongside this, mirroring the existing
`shared-window` skill's structure but scoped to `src/shared-v2/`/`docs/window-ui/` — no such skill
existed before despite `src/shared-v2/` being an actively-developed, separately-specced tree;
`shared-window`'s own text already explicitly disclaims covering `src/shared-v2/` changes, so this
fills a real gap rather than duplicating it. `docs/window-ui/DESIGN.md`'s "Build wiring" section
updated to match (v1.31).

**Known loose end, not addressed here**: while investigating this, `package.json`'s
`@melchi45/rtsp-over-websocket` dependency was temporarily pointed at `file:../rtsp-over-websocket`
(a sibling checkout) to pick up that package's own sourcemap fix without waiting on a registry
publish, per the user's explicit "temporarily" request — then reverted back to the registry
`^1.1.7` spec in `package.json`, but *without* a following `npm install`, so `node_modules/
@melchi45/rtsp-over-websocket` is (as of this writing) still a symlink to the local checkout even
though `package.json`/`package-lock.json` no longer say so. Debugging into that package's own code
(vs. just this repo's `src/shared-v2/modules/*.ts`) currently still works only because of that
stale symlink — a plain `npm install` run from here on would silently replace it with whatever's
actually published to the registry (no sourcemaps, unless that package has since been published
with its own fix). Worth reconciling deliberately (either commit to `file:...` for local player-repo
development, or run `npm install` for real and accept losing local-checkout debugging) rather than
leaving it in this mismatched state.

## Event Timeline current-time marker drifting from the playback readout it should match

`playback.ts`'s `ontimestamp()` (FR-7.7) computes two things on every `'playback'`-mode `timestamp`
event: the `#timestamp_date`/`#timestamp_time` readout (via `updateTimestampReadout()`) and the
Event Timeline's current-time marker (`state.eventTimeline.setCustomTime()`, FR-14). These used to
be computed by two *separate* code paths from the same `timestamp.detail.local`/`.timestamp`
payload — the readout via a plain `new Date(...).toISOString()` split into date/time strings, the
marker via a parallel `moment`-based calculation that branched on `#use_gmt`/device type
(`timestamp.detail.timezone`-derived UTC offset for the GMT case, `.utc()` otherwise). Reported
directly by the user with a screenshot: the marker sat far to the right of the actual playback
position, while the readout right next to it in the Video Control panel correctly showed the real
time. The practical fix, and what the user asked for directly, was to stop computing the marker's
Date separately at all: `updateTimestampReadout()` now moves the marker itself, reconstructing the
same instant its own `dateStr`/`timeStr` already represent. A new `moveTimelineMarker` parameter
(default `true`) preserves the existing "only move while actually PLAYING, else clear" guard the
`'playback'` case needs (a late in-flight timestamp must not re-draw a stale marker right as
`onstatechange()` clears it on PAUSED/STOPPED, per FR-14's own comment) — the caller passes
`elementPlayer.readyState === PLAYING` through instead of branching on it separately after the call.

**First attempt at this reconstruction was itself wrong, caught live by the user asking a follow-up
question.** `dateStr`/`timeStr` are produced by splitting a `'Z'`-suffixed `toISOString()` string
(`timestamp.detail.local`/`.timestamp`, both always ISO+`'Z'` regardless of any GMT setting), so
reappending `'Z'` when reconstructing (`new Date(dateStr + 'T' + timeStr + 'Z')`) looked like the
obvious round-trip. But the Event Timeline's own *items* (`updateTimeline()`'s
`new Date(timeline_element.StartTime)`) parse SUNAPI's actual wire format — a bare, timezone-less
`"YYYY-MM-DD HH:mm:ss"` string, no `'Z'` at all — which JS parses as **local** time, not UTC (see
`tools/mock-sunapi-server/server.js`'s `formatLocalSunapiTime()` comment, itself written after an
earlier live bug where the mock fixture's own `StartTime`/`EndTime` got this backwards). Appending
`'Z'` to the marker's reconstruction interpreted it as UTC instead, silently shifting the marker's
epoch by this machine's own UTC offset relative to how the surrounding items are positioned — the
exact same class of error already fixed once for the fixture itself, just relocated to the marker
side of the same timeline. The user then explicitly directed that this decision be tied to
`#universaltime_checkbox` (`player.coordinatedUniversalTime`) instead of being unconditional either
way: checked means this device's own timestamps are being treated as true UTC (append `'Z'`),
unchecked means local-styled digits (no `'Z'`, matching `formatLocalSunapiTime()`'s own convention).
Note that this checkbox's only other effect anywhere in the codebase is unrelated — it gates the
vendored `@melchi45/rtsp-over-websocket` player's own outgoing NVR backup/rangeClock request
formatting (`buildTimelineUri()`-adjacent code), nothing about the `'timestamp'` event's own
`local`/`timestamp` fields or how SUNAPI's Timeline response is parsed — but the user's own domain
knowledge of the intended semantics ("Coordinate UTC Time") took precedence over that code-only
reading, and this is the second follow-up question in this same fix that corrected an assumption a
pure read of the existing code led to (see the `'Z'`-appending mistake above) — a sign this specific
area is easy to get subtly wrong from code alone and worth double-checking against the user's own
understanding of the device/checkbox semantics before changing again. `updateTimestampReadout()`
also now `console.log`s the resolved marker Date on every move (prefixed `[FR-14]`), per the user's
own request, so the actual value can be checked live in the browser console against
`#universaltime_checkbox`'s state. **Removed later the same day**, once that log had done its job
diagnosing the camera seek bug below (it fires on every timestamp update — many times a second
during playback — and was pure noise once the real fix landed) — see the next entry and
`docs/window-ui/SRS.md` FR-7.7 v2.20.

## Camera playback seek silently landed on the wrong position — `useIsoTimeFormat` was never set

Reported directly by the user: dragging the Event Timeline's current-time marker (FR-14) to a new
position always resulted in playback landing on the same wrong spot, regardless of where the marker
was dropped — confirmed with two separate drags to two different targets (`16:06:22`, then
`16:37:27`), both reporting back the exact same actual playback position (`15:43:19.434`).

Root cause lives in the sibling `@melchi45/rtsp-over-websocket` package (a local `file:` dependency
here, `/mnt/e/workspace/rtsp-over-websocket`), not this repo's own code:
`RTSPOverWebSocket.ts`'s `seeking()` only updates the actual outgoing `rangeClock` for camera
devices when `player.useIsoTimeFormat` is truthy —

```ts
if (this._deviceType === 'camera') {
  if (this._useIso && this._useIso !== null) {
    this.info.media.requestInfo.rangeClock = this.seekingTime.replace(...);
  }
  // legacy: non-iso camera branch is a no-op (commented out)
}
```

— the non-ISO branch is dead code, preserved verbatim from the original legacy implementation.
Nothing in either `src/shared/` or `src/shared-v2/` ever set `useIsoTimeFormat` (confirmed by grep —
`#iso_date_time_checkbox` existed in both pages' markup but had no listener in either, one of
`src/shared-v2/`'s documented "Known dead controls"), so `_useIso` stayed `null` for the entire
session and every camera playback seek resent whatever stale `rangeClock` value already happened to
be sitting there instead of the just-requested target.

Diagnosed live, not by reading source alone: the user asked for a `console.log` at the exact
`rangeClock`-assignment site in `seeking()` first (rather than guessing at a fix), which is what
surfaced `useIso: null` alongside a `rangeClock` value that decoded to the *previous* actual playback
position, not the new seek target — proving the branch was a no-op rather than merely computing the
wrong value. Fixed in `src/shared-v2/modules/videoControl.ts` (`onchangeisodatetime()`, wired to
`#iso_date_time_checkbox`'s `change` event) by writing `player.useIsoTimeFormat` for real instead of
defaulting it on automatically — the checkbox still starts unchecked (matching legacy's own markup),
so camera playback seek requires checking it manually after this fix. See
`docs/window-ui/DESIGN.md`'s "Deviations from legacy behavior" and `docs/window-ui/SRS.md` FR-7.7.1.

## Stop during Playback sent a real TEARDOWN but never actually stopped the `<video>` tag

Reported directly by the user: clicking Stop while playing back a recording sent a real RTSP
`TEARDOWN` and received a real response (confirmed at the wire level), but the `<video>` element
kept looping its last ~2 seconds of already-buffered MSE data forever — new segments stopped
arriving (MSE wasn't being fed), yet nothing ever paused the tag or tore down its `MediaSource`.

Root-caused live, not by reading source alone: added a console trace across the entire RTSP-close
call chain (`RtspClient.ts`'s `Disconnect()` -> the `RtspResponseHandler` branch matching the
TEARDOWN response -> `clearTransport()` -> `connectionCbFunc()` -> `StreamPlayer.close()`'s
`Disconnect` callback -> `mediaRouter.terminate()` -> `VideoTagPlayer.close()`, all in the sibling
`@melchi45/rtsp-over-websocket` package) and asked the user to reproduce with it. The trace showed
`connectionCbFunc()` throwing:

```
RTSPOverWebSocket Error: invalid input parameter type, check your input parameter type
    at set startTime (...)
    at r2.onstatechange (videoControl.ts:215:33)
    at r2.dispatchEvent (...)
    ...
    at oa.connectionCbFunc (...)
```

`videoControl.ts`'s `onstatechange()` STOPPED branch (added earlier the same day, FR-6.9 v1.26) does
`player.startTime = null; player.endTime = null;` to reset a finished playback's stale range.
`endTime`'s setter has always accepted `null` for exactly this reason — but `startTime`'s setter
(`RTSPOverWebSocket.ts`) never did, an unnoticed asymmetry (`typeof v !== 'string'` threw
unconditionally for `null`, no `v !== null` escape hatch `endTime`'s check already had). Because
this assignment happens synchronously inside a `dispatchEvent` chain invoked from deep within
`connectionCbFunc()` itself, the thrown error unwound all the way back up through it — aborting the
function *before* it ever reached the `responseDisconnectCallback` firing code near its end, which is
what `StreamPlayer.close()` awaits before calling `mediaRouter.terminate()` (i.e. the actual
`<video>`/`MediaSource` cleanup, `VideoTagPlayer.close()`). The RTSP layer had genuinely finished
(TEARDOWN sent, response received, `currentState` transitioned) — the break was entirely downstream
of that, in an event-dispatch side effect nobody expected to be able to throw.

Two fixes, one in each repo:
- `@melchi45/rtsp-over-websocket`'s `startTime` setter now accepts `null` (`_startTime`'s type
  widened to `string | null | undefined`), matching `endTime`'s existing, correct behavior — see that
  package's own `MEMORY.md`.
- `videoControl.ts`'s STOPPED branch now also gates the `startTime`/`endTime` reset on
  `playType === PLAYBACK` (Live never sets these fields, so there's nothing to reset) and wraps it in
  its own `try`/`catch` — the exact same defensive pattern this branch's own
  `#timestamp_date`/`#timestamp_time` `.remove()` calls already use, documented right above it in
  `docs/window-ui/SRS.md` FR-6.9, for the identical failure class (a throw here aborts every
  button-state reset that follows it). Belt-and-suspenders: the root cause is fixed upstream, but this
  branch shouldn't be one throw away from silently breaking Stop again either.

`connectionCbFunc()`'s own `catch {}` (silent, no logging) is what let this go unnoticed for as long
as it did — upgraded to `console.error` alongside the diagnostic trace, and left that way rather than
reverted, since a swallowed exception here has real user-visible consequences and deserves to be
loud. See `docs/window-ui/SRS.md` FR-6.9 v1.27 and `docs/window-ui/DESIGN.md` v1.38.

**Follow-up (same day, v1.28)**: once Stop was fixed to actually stop, the user asked for a small UX
change on top of it — a subsequent plain Play should resume from where Stop was clicked, not require
picking a fresh Selected Time/timeline range every time. Their first instinct was to source that
resume point from the Event Timeline's Selected Time *end* fields (`#selected_end_date`/
`#selected_end_time`) — worth noting because those track the *originally selected search range's*
end, not the actual position playback had reached when Stop was clicked; the two can diverge
significantly (dragging the FR-14 marker around, or simply letting playback run past the searched
range's own end). They self-corrected to the right source before any code was written:
`#timestamp_date`/`#timestamp_time`, the live readout `playback.ts`'s `updateTimestampReadout()`
keeps in sync with the actually-playing position on every `timestamp` event. `onstatechange()`'s
STOPPED branch now reads those two fields' `.value` *before* removing them (same line that already
did the removal), and uses `${date}T${time}Z` as the new `startTime` when both are present, `null`
otherwise (e.g. stopped before the first `timestamp` event ever arrived this session). `endTime`
stays unconditionally `null` either way, so a resumed Play plays forward indefinitely rather than
staying bound to whatever range was originally searched for. See `docs/window-ui/SRS.md` FR-6.9
v1.28 and `docs/window-ui/DESIGN.md` v1.39.

## `#speed` never reflected a device-corrected RTSP `Scale`

Reported directly by the user with a real RTSP transcript: requesting `0.75x` playback speed sent
`Scale: 0.75` in the `PLAY` request, but the device's `200 OK` response echoed back `Scale: 1` — it
had clamped/rejected the requested speed and applied a different one instead. Nothing anywhere in
`@melchi45/rtsp-over-websocket` parsed a `Scale` header off an incoming response at all (confirmed by
grep — `Scale` only ever appeared in *outgoing* request-building code), so `#speed` kept showing
`0.75x` and `player.playSpeed` kept reporting `0.75` even though the device was actually playing at
`1x` — a real, silent UI/device desync with no existing mechanism to correct it.

Fixed entirely in the sibling package (this repo only adds a listener):
- `RtspClient.ts`'s `parseRtspResponse()` now parses a `Scale` header the same way it already parses
  `Session`/`Transport`/`RTP-Info` (`RtspResponseData.Scale`), threaded through
  `RtspClientErrorEvent.scale` into the three `RtspResponseHandler()` branches that represent a real
  `PLAY`-method response ("RTSP Play Streaming", "RTSP Seek Streaming" — covers seek/speed/forward/
  backward alike — and "RTSP Resume Streaming"; the `PAUSE`-method branch is untouched).
  `RTSPOverWebSocket.ts`'s `onRTSPOverWebSocketError()` `'0x0000'` case self-corrects `_playSpeed`
  from it when present and different from the requested value, then dispatches a new `changespeed`
  custom element event — matching this class's existing `change<Property>` pattern (`changetimezone`,
  `changeport`, etc.).
- The numeric-value -> named-speed-entry lookup previously inline in `set playSpeed(v)` was extracted
  into a private `resolvePlaySpeedEntry()` (legacy truncation quirks preserved verbatim) so the
  self-correction path can resolve the device's reported value without going through the public
  setter, which would re-send the request via `speed()` and just create a request/response loop —
  the self-correction must be silent from the RTSP layer's perspective, only observable locally.
- `wisenet-camera-discovery`'s `playback.ts` gained `onchangespeed()`, wired in `playerEvents.ts`
  next to `changetimezone`/`changeport`, updating `#speed`'s displayed value to match. See
  `docs/window-ui/SRS.md` FR-7.5 v2.23 and `docs/window-ui/DESIGN.md` v1.40.

## Double-clicking an Event Timeline item during playback seeked to the wrong time, and Selected Time never updated

Reported directly by the user with a console trace: double-clicking a 4-minute event
(`17:11:51`-`17:15:55`) while playback was already running seeked to `17:18:39` -- outside the
event's own range entirely -- and `#selected_start_date`/etc. (and `player.startTime`/`endTime`)
stayed on the previous, unrelated range instead of reflecting the double-clicked event.

Two independent bugs combined to produce this:

- `src/component/event-timeline/event-timeline.ts`'s `handleItemOrTrackActivation()` computed the
  double-click's `time` from `rowsContainer.getBoundingClientRect()` without subtracting
  `ROW_HEADER_WIDTH_PX` (150px, each row's label column) first -- every other pixel/ratio
  conversion in the file does. Since `rowsContainer`'s own bounding rect spans the label column
  *and* the track, this shifted every computed `time` later within the current zoom window by
  roughly (header-width / total-width) of its span -- large enough, at real window widths, to land
  well past a double-clicked item's own end.
- `src/shared-v2/modules/playback.ts`'s `onSelect` (which sets `startTime`/`endTime`/Selected Time
  from a clicked item) bails out entirely while `readyState === PLAYING` -- correct for a plain
  click (Selected Time is a pre-play config panel), but `onDoubleClick` had nothing to compensate:
  it only ever computed a `seekingTime` from the (buggy) pixel `time`, with no path back to the
  actually-clicked item at all.

Fixed on both sides:

- `mountEventTimeline()`'s `onDoubleClick` callback gained a second, optional argument -- the
  matched `EventTimelineItem` when the double-click landed on one -- alongside a corrected `time`
  computation (subtracts `ROW_HEADER_WIDTH_PX` like everywhere else does).
- `playback.ts` extracted `onSelect`'s body into `applyItemToSelectedTime(item)`; `onDoubleClick`
  now calls it too whenever the widget hands back an `item`, and seeks using that item's own
  `start` instead of the pixel-derived `time`. A double-click on empty track space (no item under
  the cursor) is unaffected -- still seeks using `time` as before, now just computed correctly.

See `docs/event-timeline-component/SRS.md` FR-8 v2.14/DESIGN.md v2.10 and `docs/window-ui/SRS.md`
FR-7.6 v2.24/DESIGN.md v1.41.

## Event Timeline's per-row Hide button removed; the overview row's collapse button retargeted a third time

Requested directly by the user, two changes to `src/component/event-timeline/event-timeline.ts`:

- The per-row "Hide"/"Show" toggle button (every row, overview and detail alike, `setRowHidden()`/
  `hiddenRowIds`) is removed outright -- no replacement, no `EventTimelineController` API added in
  its place. `.event-timeline-hide-btn`/`.event-timeline-row-hidden` are gone from
  `event-timeline.css` too.
- The overview ("ALL EVENTS") row's own `.event-timeline-collapse-btn` no longer collapses that
  row's own track at all -- it now collapses/expands `.event-timeline-rows` (the detail-rows
  container), hiding every per-Rule row at once while "ALL EVENTS" itself stays visible either way.
  The `.event-timeline-overview-collapsed` class/CSS is gone; `.event-timeline-rows-collapsed`
  (applied to `.event-timeline-rows` itself, not the overview row) replaces it.

Worth remembering: this is the **third** time this exact button's behavior has changed direction
(see the entry above, "Event Timeline row titles didn't line up..." -- v2.3 kept the overview
track's highlight visible while collapsed, v2.9 made the whole track fold instead). This time the
button doesn't touch its own row's track at all any more -- it was reinterpreted as "collapse
*everything below* ALL EVENTS," not "collapse ALL EVENTS itself." Check `docs/event-timeline-
component/SRS.md`'s history table (currently v2.15) before assuming any of the earlier behaviors
still apply.

See `docs/event-timeline-component/SRS.md` FR-3/FR-10 v2.15, DESIGN.md v2.11, TC.md v1.12, and
PRD.md v2.1.

## `#speed` still showed a stale speed after the v2.23 device-Scale self-correction fix

A follow-up to "`#speed` never reflected a device-corrected RTSP `Scale`" above. Reported directly
by the user with another real RTSP transcript, `Scale: 1.000000` requested and echoed back in the
`200 OK` this time -- not a clamped/rejected value, plain normal-speed playback -- yet `#speed`
still showed `0.25x`. Tracing the entire v2.23 callback chain end-to-end (`RtspClient.ts`'s `Scale`
header parsing -> the unconditional `errorCallbackFunc` call in the matching `RtspResponseHandler()`
branch -> the direct, unwrapped `info.callback.error` reference threaded through
`StreamPlayer.ts`/`RtspClient.SetErrorCallback()` -> `onRTSPOverWebSocketError()`'s `'0x0000'` case)
found no dropped step anywhere -- `error.scale` reliably arrives intact.

The actual bug was in `src/shared-v2/window.html`, not the callback chain: `#speed`'s `<option>`
list had no `selected` attribute on any entry, so a native `<select>` defaults to whichever
`<option>` comes first in DOM order -- `0.25x`, not `1x`. That default silently disagreed with
`RTSPOverWebSocket.ts`'s own internal `_playSpeed` default (`speed_1x`, value `1`). Since v2.23's
self-correction only dispatches `changespeed` when the device's echoed `Scale` *differs* from
`_playSpeed`, a fresh page load or a brand-new playback open -- where the device predictably echoes
back `Scale: 1`, matching `_playSpeed`'s already-`1` default -- never produced a mismatch for it to
catch. `#speed`'s wrong HTML-level default was therefore never touched by any code path, and stayed
on `0.25x` indefinitely regardless of how many times a correctly-`1x` PLAY response came back.

Fixed with one attribute: `<option value="1">1x</option>` now carries `selected`, matching
`_playSpeed`'s own programmatic default. `src/shared/window.html` has the identical missing-
`selected` issue in its own `#speed` markup -- left as-is, since that tree is untouched by this
reimplementation (see CLAUDE.md).

See `docs/window-ui/SRS.md` FR-7.5 v2.27 and `docs/window-ui/DESIGN.md` v1.44.

## Channel change during Playback stopped refreshing the Calendar — an unguarded `stop()` call aborted the rest of the reset function

Reported symptom: after switching `#channel` while in Playback + SUNAPI-on mode, `recording.cgi`'s
`msubmenu=calendarsearch` request (the Calendar's highlighted-recorded-days refresh) never fired at all —
confirmed by the user watching network traffic directly.

Root cause: `playbackCalendar.ts`'s `resetPlaybackSearchStateForChannelChange()` (called unconditionally from
`device.ts`'s `changechannel()`) calls `state.getSelectedPlayer().stop()` partway through, unguarded, followed
by the Calendar-refresh steps (`runMonthSearch()` etc.) later in the same function — all inside one shared
`try`/`catch` at the function's own top level. `RTSPOverWebSocket.stop()` throws `RTSPOverWebSocketError` 0x1000
("player object is not exist") whenever the element's internal `player` instance hasn't been created yet — which
only happens lazily inside `play()` — so changing channel *before ever clicking Play* for the currently selected
device (e.g. picking a channel while just browsing the Calendar, never having started playback) threw here, and
the function's own outer `catch` swallowed it silently, skipping every step written after `stop()` — including
the `getCalendarSearch()` re-fetch that was supposed to refresh the Calendar for the new channel.

This is the same general failure class as several fixes already made this session on the
`@melchi45/rtsp-over-websocket` side (an unguarded call that can throw, sitting mid-function, silently aborting
every step written after it) — just on this repo's own calling code this time, not the vendored player library.

Fix: wrapped the `stop()` call in its own local `try`/`catch` (logging and continuing) so a harmless "nothing to
stop yet" failure can't abort the rest of the channel-change reset. Matches this codebase's existing pattern for
"a throw here would abort every step below it" bugs — see `videoControl.ts`'s `onstatechange()` STOPPED-branch
guards (FR-6.9).

See `docs/window-ui/SRS.md` FR-7.8.6 v2.28 and `docs/window-ui/DESIGN.md` v1.45.

## `#iso_date_time_checkbox`/`player.useIsoTimeFormat` removed — the underlying property no longer exists

FR-7.7.1 (v2.19) originally wired this checkbox to work around a real camera drag-seek bug in
`@melchi45/rtsp-over-websocket`'s `seeking()`. DESIGN.md v1.37 already established the actual fix
landed entirely in that package, not in this checkbox's wiring, which stayed "correct but no longer
load-bearing." A further review this session (the user asking "isn't `_useIso` unnecessary?" while
auditing that package's `rangeClock`/`generateRTSPURL()` construction for possible consolidation)
found `_useIso === true` was a dead `// TODO: camera iso time style generate (legacy: unimplemented)`
stub in `generateRTSPURL()`'s camera branches — checking this box could produce a URL with no
start/end embedded in the path at all — and its only real nvr-side effect (millisecond-fraction
inclusion in the outgoing `rangeClock`) had no known real-device rationale.

`@melchi45/rtsp-over-websocket` removed `_useIso`/`useIsoTimeFormat` entirely and made every former
`false`-branch site behave the way `true` always did (see that package's own `MEMORY.md`). With the
underlying property gone, `#iso_date_time_checkbox`/`onchangeisodatetime()` (`videoControl.ts`) are
removed from `src/shared-v2/` — there is nothing left for them to control. `src/shared/`'s own copy of
this checkbox was never wired to anything to begin with (confirmed by grep, same as always) and stays
untouched, per this repo's own out-of-scope convention for that tree.

See `docs/window-ui/SRS.md` FR-7.7.1 v2.29 and `docs/window-ui/DESIGN.md` v1.46.

## Frame-step buttons crashed on a null player mid-stream — root cause was in `@melchi45/rtsp-over-websocket`, fix landed on both sides

Reported by the user from a live browser console trace: clicking `#forward` (FR-6.11) repeatedly
during camera playback eventually threw `TypeError: Cannot read properties of null (reading
'forward')`, surfacing in this repo at `videoControl.ts:68`'s `forward()` catch block, but rooted
several layers down in `@melchi45/rtsp-over-websocket`'s `MediaRouter.ts`. The user also noticed
Pause/Resume flipping to "playing" state around the same crashes — a real but separate symptom
(the camera's own Play/Pause ACKs for the forward-then-auto-pause step-request pair), not the cause;
see that package's own `MEMORY.md` entry for the full trace connecting the two.

Root cause: `MediaRouter.ts`'s `onWaiting()` (RTP-packet-loss handler) can `close()` and null its
internal player at any time video packets are reported lost (privacy/covert-mode teardown, gated on
`supportCovertAndOff`) — independent of the step-request state machine `forward`/`backward` reason
about. Those two `sendCommandData()` cases used a non-null assertion instead of a guard, so a step
click landing in that window crashed instead of no-op-ing.

Fixed in `@melchi45/rtsp-over-websocket` (both halves needed, not just the null-guard): the
`forward`/`backward` cases now guard on `player !== null` like every sibling case; separately,
`onWaiting()`'s `0x0107` notice now carries a `playerClosed: boolean` field, forwarded onto the
public `'waiting'` DOM event. This repo's half: `videoControl.ts`'s `onWaiting()` (previously a
debug-log-only no-op — FR-6.10) now disables `#forward`/`#backward` when it sees
`waiting.detail.playerClosed === true` for `media === 'video'`. No matching re-enable was added
here — the next `'statechange'` `PLAYING` event (already handled by `onstatechange()`'s existing
FR-6.9 logic once a new frame recreates the decoder) already re-enables both buttons for
`PLAYBACK`, so nothing else needed to change on this side.

See `docs/window-ui/SRS.md` FR-6.11 (this session's addendum) and `docs/window-ui/DESIGN.md`'s
"Deviations from legacy behavior" for the `src/shared-v2/`-side detail, and
`@melchi45/rtsp-over-websocket`'s own `MEMORY.md`/`docs/player/03-mediaSession-core-video.md` for
the underlying library fix.

## Frame-step buttons still flooded overlapping `forward()` calls after the null-crash fix above — rapid clicks/held-key repeat race a single shared step state machine

Direct same-day follow-up to the entry above, from a second live console trace taken right after
that fix shipped: the null-player `TypeError` was confirmed gone, but the trace showed a new
pattern — dozens of `[forward] request` log lines per second for several seconds straight,
`currentTimestamp` advancing by only ~50-100ms between each. Too fast and too regular to be
discrete human clicks; almost certainly a focused `#forward` button's held-key auto-repeat (Chrome
re-fires `click` on each repeated keydown while Space/Enter is held on a focused `<button>`), or
rapid manual re-clicking during testing.

Asked the user whether this was intentional stress-testing or a real problem to fix; they asked
for a fix rather than treating the flood as expected. Root cause: `@melchi45/rtsp-over-websocket`'s
`MediaRouter.ts` step state (`stepFlag`/`stepCmd`/`stepStatus`) is a single machine shared between
`forward()` and `backward()`, not one per direction — nothing in this repo's `videoControl.ts` (or
that library) previously stopped a second click from firing while a step was still in flight, so
overlapping calls could stomp which direction the in-flight step resolves as, and in the worst case
(held key) queue up an unbounded RTSP request flood.

Fixed entirely on this repo's side (no `@melchi45/rtsp-over-websocket` change needed this time):
`videoControl.ts`'s `forward()`/`backward()` now disable both `#forward`/`#backward` immediately
after a *successful* call — placed after the call, not before or in the `catch`, so a click
rejected for the wrong `playType` (still throws) never leaves the buttons stuck disabled with no
event left to re-enable them. Re-enabled by `onstatechange()`'s `STEP` case (this step actually
completed — previously only touched `#resume_button`/`#capture_button`/`#capture2_button`) or its
existing `PLAYING` case (already covers the v2.31-fix's stalled/player-teardown path above, so no
separate handling was needed there).

See `docs/window-ui/SRS.md` FR-6.11/FR-6.10 v2.32 and `docs/window-ui/DESIGN.md` v1.49.

## The debounce above still let a null-player crash through — an unrelated Pause ack could re-enable step buttons mid-buffer-refill, closed with a dedicated player-availability event

Direct same-day follow-up, from a fresh live console trace taken right after the debounce fix
above shipped: `backward()` still hit `Cannot read properties of null (reading 'backward')`, this
time after five successful backward steps and an RTSP `'Pause'` ack.

Root cause, worked out with the user: the debounce (disable-on-click, re-enable-on-STEP/PLAYING)
only closes the race *between a click and its own step's completion*. It does nothing about a
*second*, independent race: a step's own auto-`pause()` (`onRTSPOverWebSocketStep('complete')`,
`@melchi45/rtsp-over-websocket`) triggers a real PAUSED ack, and `onstatechange()`'s PAUSED case
*legitimately* re-enables the step buttons on any PAUSED (needed so a user who manually pauses,
not mid-step, can still start stepping) — but that PAUSED ack can arrive while a *separate*,
still-in-flight buffer-refill re-seek (triggered by an *earlier* step exhausting its local frame
buffer, via the same `stepRequestCallback('request', ...)` mechanism the very first click's
`stepRequest()` uses — not "first click only," as `@melchi45/rtsp-over-websocket`'s own docs
previously undersold it) still has `MediaRouter.player` null. There is no ordering guarantee
between two independently-timed async completions, so no amount of gating on `'statechange'`
readyState alone can close this — confirmed by asking the user directly whether the null-player
window itself could be eliminated: not at the object level (a new decoder can only be constructed
once new stream data confirms its parameters), so the fix instead had to make the *UI* provably
race-free regardless of event ordering.

Fixed with a new signal from `@melchi45/rtsp-over-websocket`: `MediaRouter.ts`'s `player`
getter/setter now fires a `playerAvailabilityCallback` on every null <-> non-null transition
(covering *both* ways it goes null — `onWaiting()`'s covert-mode teardown, and `initVideoPlayer()`
from `stepRequest()`/the `resume`/`seek` commands — since every internal assignment already went
through this one setter), forwarded as a new public `'playerstatechange'` DOM event. This repo's
`videoControl.ts` tracks it as a module-level `playerAvailable` flag (`onPlayerStateChange()`) and
routes every place that would enable `#forward`/`#backward` (`onstatechange()`'s PLAYING/PAUSED/
STEP cases) through a new shared `updateStepButtonsEnabled(playType)`, which only enables when
`playerAvailable && playType === PLAYBACK` — a plain synchronous check at the moment of each
enable attempt, not a race between two event streams. The earlier v2.31 fix's `onWaiting()`-
specific `playerClosed` disable was removed as fully redundant (same underlying setter call now
covered generically, and more correctly — the old special-case had no protection against a later
PAUSED/PLAYING/STEP re-enabling before the player actually came back).

See `docs/window-ui/SRS.md` FR-6.11/FR-6.10 v2.33 and `docs/window-ui/DESIGN.md` v1.50, and
`@melchi45/rtsp-over-websocket`'s own `MEMORY.md` for the library-side signal.

## Step buttons could still get stuck disabled after the player-availability fix above — added a frame-render fallback instead of chasing event ordering further

Direct same-day follow-up, reported by the user in plain terms: "Forward/Backward 버튼이
disabled 되고 영상이 보였는데도 여전히 disabled 입니다. 영상이 보이면 다시 해제 해야 합니다."
(the buttons got disabled and stayed that way even once video was visibly playing again).

The v2.33 fix (`playerAvailable`, sourced from `'playerstatechange'`) is correct in principle, but
depends on `'playerstatechange'`/`'statechange'` events being processed in a particular relative
order across two independently-dispatched event streams — exactly the class of problem v2.33 itself
was fixing between PAUSED and player-availability. Chasing this further with *more* event-ordering
logic would just relocate the same risk rather than remove it.

Fixed instead with a self-correcting fallback that doesn't depend on ordering at all:
`ontimestamp()`'s (`playback.ts`) `'playback'` case now calls a new `onPlayerFrameRendered(playType)`
(`videoControl.ts`) on every rendered frame, which unconditionally forces `playerAvailable` back to
`true` and re-runs `updateStepButtonsEnabled()`. The reasoning: a frame actually being decoded and
rendered is direct, first-hand proof a live player instance exists *right now* — stronger and
simpler evidence than any inference from a sequence of state-change events, and impossible to get
out of order relative to itself. This is additive, not a replacement — `onPlayerStateChange()`
still does the prompt disabling the moment the player actually goes away; this only ever pulls the
flag back to `true`, and only when there's real proof.

See `docs/window-ui/SRS.md` FR-6.11/FR-6.10/FR-7.7 v2.34 and `docs/window-ui/DESIGN.md` v1.51.

## Event Timeline's channel filter, added to fix a reported "cross-channel leak," turned out to be hiding real data -- reverted after a second look at real device data

Direct same-day follow-up. The earlier fix at `docs/window-ui/SRS.md` FR-7.6 v1.19/v1.25/v2.12
(`resolveEventLabel()`/`eventAppliesToChannel()` in `playback.ts`, `populateRuleSelect()`'s own
channel filter in `playbackCalendar.ts`) was built on a specific real-device report: querying
Channel 1's Timeline returned `Results[]` rows for `Rule5`/`Rule6`/`Rule8`/`Rule9`, Rules configured
(per `eventrules.cgi?msubmenu=dynamicrules`) on Channel 2. That was read as the device leaking a
different channel's events into the wrong query, so both the Rule dropdown and the rendered
timeline were filtered down to only the currently-selected channel's own Rules.

The user came back with the full `eventrules.cgi?msubmenu=dynamicrules` response for the device in
question (9 Rules: `Rule 0-3` on CH1 — EFD 1/2, MD 1/2 — `Rule 4-8` on CH2 — TD 1/2, Diff 1, MD 1/2)
and a live screenshot, and confirmed directly: those CH2-configured Rules showing up while CH1 was
queried are not a leak to filter out — they're real events that belong on CH1's own rendered
timeline. The device in question is a dual-sensor (optical + thermal) camera where both logical
channels share one physical recording/timeline; a Rule's *configured* channel (which lens/sensor
triggers it) is unrelated to which channel's Timeline query surfaces its results.

Reverted across three places: `resolveEventLabel()` now matches a `"Rule<N>"` Type to its
`RuleName` by Rule number alone, no channel check; `eventAppliesToChannel()` (the
`Results[]`-filtering helper) is deleted outright, so `updateTimeline()` renders every result the
device returns; and `populateRuleSelect()`'s Rule dropdown lists every configured Rule regardless
of channel, not just the selected one. `refreshRuleSelectForChannelChange()` still re-fetches on
channel change (kept for parity with `resetPlaybackSearchStateForChannelChange()`'s existing reset
ordering), even though the resulting list no longer actually differs by channel.

The lesson: a plausible-looking "cross-channel leak" diagnosis, even one that matched a real,
reproducible symptom, was wrong about *which* side was buggy — the device's actual behavior (shared
timeline across sensor channels) was correct, and the client-side filter added to "fix" it was the
real bug. Confirming against the device's own configuration data (the full Rule list, not just the
one symptom) before filtering is what caught it.

See `docs/window-ui/SRS.md` FR-7.6/FR-7.8.2 v2.35 and `docs/window-ui/DESIGN.md` v1.52, and
`docs/event-timeline-component/`'s own point-marker fix earlier the same day for the unrelated CSS
bug found while investigating this same screenshot.

## Event Timeline point (diamond) markers drew 5px right of their real time — vertical centering existed, horizontal did not

Reported directly by the user, from a real device's Timeline response and a screenshot: zero-
duration events (`StartTime === EndTime`, e.g. instantaneous Rule triggers) render as a small
rotated-square "diamond" marker (`event-timeline.ts`'s `buildItemEl()`, `isPoint` branch) rather
than a bar, and at a high zoom level (the reported case was ~x32) their positions visibly didn't
line up with the underlying data.

Root cause: `buildItemEl()` sets the point marker's `left` to the item's exact time (`timeToRatio(
item.start, ...) * widthPx`), same as a bar item's left edge. But unlike a bar, a point marker is a
fixed 10px×10px box meant to be *centered* on that time, not left-aligned to it.
`.event-timeline-item-point` (event-timeline.css) already did this correctly on the vertical axis
(`top: 50%; margin-top: -5px;`) but had no horizontal counterpart — no `margin-left: -5px;` — so
`left` landed on the box's left edge, and the marker's actual visual center (what a user reads as
"the event's time") sat 5px to the *right* of the real time. Bar items were unaffected — their
`left`/`width` are both computed from real start/end edges, not a fixed centered box. The pattern
this was missing already existed elsewhere in the same file for the same reason:
`.event-timeline-custom-time-hit` (the current-time marker's drag hit-target) uses `margin-left:
-3.5px` specifically so its own `left` targets the exact playhead position despite being wider than
1px.

Fixed by adding the missing `margin-left: -5px;` to `.event-timeline-item-point`.

See `docs/event-timeline-component/SRS.md` FR-3 v2.16, `DESIGN.md` v2.12, and `TC.md` TC-21.

## `#forward`/`#backward` stuck disabled forever on some cameras — real fix landed in `@melchi45/rtsp-over-websocket`

Reported live: after stepping, `#forward`/`#backward` never re-enabled, with no crash and no
RTSP-level error visible in either the console or `#rtsp`. The root cause was entirely on the
`@melchi45/rtsp-over-websocket` side — `StepBufferList.setBufferingLength()` never guarded against a
`NaN` input (a camera whose SDP has no optional `a=framerate:` line leaves `videoInfo.framerate`
`undefined`, and `undefined * 4` propagated as `NaN` forever, since `NaN` fails every clamp
comparison) — so a step's local frame buffer could never reach its (nonsensical, unreachable)
target size, `stepStatus` never reached `'complete'`, and the `STEP` statechange this app's own
`updateStepButtonsEnabled()` relies on to re-enable the buttons never fired. See that package's own
`MEMORY.md` for the full chain.

Temporary `console.log` diagnostics were added to `videoControl.ts`'s `onPlayerStateChange()`,
`onPlayerFrameRendered()`, and `onstatechange()`'s `STEP` case while investigating (real
`console.log`, not `changedebug()` — that only writes to the `#debug` textarea, invisible unless
that panel is open, so it wouldn't have shown up in the console trace the user was pasting). Left in
place for now, same reasoning as the upstream package's own diagnostics — cheap to keep, worth
confirming the real fix against the actual reporting device before stripping them.

## Mobile layout: `#left_panel`/`#right_panel`'s desktop 30/70 split doesn't fit a phone-width viewport

Requested directly by the user ("모바일에 맞게 레이아웃을 수정해야 합니다 ... 더 공간을 효율적으로
사용하는 레이아웃으로 수정해줘"), scoped after asking a clarifying question (`AskUserQuestion`) to
confirm the target was `src/shared-v2/`'s window UI and that the whole layout — not one specific
panel — was in scope.

`css/window.css`'s desktop layout (`#left_panel`/`#right_panel`, "Layout" section) pins both to a
fixed 30/70 `position: absolute` side-by-side split with a `#drag` resize handle. That split, plus
several fixed-`min-width` panels inside it, don't fit a phone-width viewport: 30% leaves the video a
sliver too narrow to read, and several controls areas either overflow uncontained or squeeze
illegibly. Added one `@media (max-width: 768px)` block each to `css/window.css`, `css/table.css`,
and `src/component/event-timeline/event-timeline.css` — CSS-only, no HTML/TS changes. Full rule list
in `docs/window-ui/DESIGN.md`'s new "Mobile layout" section (and the matching History entries there,
in `docs/window-ui/SRS.md` (new NFR-1), and in `docs/event-timeline-component/DESIGN.md`).

**Real bug found while verifying with a live Playwright screenshot at a 390px viewport (not just
reading the CSS): `#live_control`'s button group (Play/Stop/Pause/Resume/Download Img./Capture)
overflowed 132px past the viewport edge uncontained**, once `#left_panel`/`#right_panel` dropped
`overflow: auto` for `overflow: visible` (correct for the new stacked layout, but it stopped
clipping/scrolling anything that overflows within it). Root cause: `.field-row` already wraps its
`.field` children, but a single `.field` can itself contain a whole button group with no
`flex-wrap` of its own — fine on desktop where there's enough width, not at phone width. Fixed with
one more mobile-only rule, `.field { flex-wrap: wrap; }`, which fixes every such group at once
rather than special-casing `#live_control`. Confirmed fixed by re-screenshotting and checking
`document.documentElement.scrollWidth === document.documentElement.clientWidth` (390) both on the
default page and with SUNAPI on + Playback selected (the Calendar + Event Timeline row visible).

**Verified the equivalence suite's failures are pre-existing, not a regression**, before trusting a
first full run that showed 13 failures: `git stash`-ed just the 3 CSS files (reverting to the
pre-change baseline), rebuilt, and reran two of the failing spec files
(`session-device-profile.spec.ts`, `video-playback-audio.spec.ts`) — the identical 7 tests failed
with the exact same `#search_overlapped_id` timeout/"Target page ... closed" cascade, with zero CSS
changes in play (the `@media (max-width: 768px)` rules cannot fire at Playwright's default
1280×720 viewport regardless). Confirms these are a systemic pre-existing issue unrelated to this
change (most likely something upstream in the mock-SUNAPI flow — not investigated further, out of
scope for this change) rather than something this pass broke. `git stash pop` restored the mobile
CSS changes afterward.

See `docs/window-ui/DESIGN.md`'s new "Mobile layout" section for the full rule list.

## `gettimezonestring()`'s half/45-minute GMT offset bug (`src/shared-v2/` only)

`src/shared/window.ts`'s original `gettimezonestring()` (line ~2689) and `src/shared-v2/modules/
helpers.ts`'s port of it both built a SUNAPI-ready `±HH:MM` offset string by pattern-matching the
input rather than actually computing minutes. The "is this a 30-minute zone" regex
(`/\d*.?(\w{2})?/`) has every component optional, so it matches literally any string including the
empty one — the `"30"` branch it guarded was unreachable dead code, and every half-hour-offset
timezone (GMT+05:30, GMT-03:30, GMT+09:30, ...) silently rendered with `:00` minutes. Positive
offsets also came out with no `:` separator at all (`+0500`, not `+05:00`) since the original only
added the colon in the zero/negative branch. This fed straight into `moment(...).utcOffset(...)`
in `playback.ts`'s `formatManualSearchTime()`/`formatTick()` and `playbackCalendar.ts`'s
equivalent, so selecting a half-hour timezone silently shifted real SUNAPI search queries by up to
30 minutes.

A previous session had already found this (see the comment history at `helpers.ts`) but
deliberately preserved it bug-for-bug, since it wasn't listed in `docs/window-ui/DESIGN.md`'s
"Deviations from legacy behavior" and the equivalence-testing convention is to not "fix" undocumented
differences. The user later pasted a full Windows 101-entry GMT timezone list and asked directly
how to make `_gmt` (which behaved like a plain int) support real GMT offsets, which is the trigger
to actually fix it. Rewrote `gettimezonestring()` to compute `HH`/`MM` straight from the fractional
hour value (`Math.floor`/remainder×60) instead of regex-sniffing the input — correct for any
offset, not just 30-minute ones. Also fixed `device.ts`'s camera-reported-timezone parser (the
`dateInfo.TimeZoneIndex` branch), which had the same class of bug: it added a flat `+0.5` for any
non-zero minute part, which is wrong-signed for negative offsets (GMT-03:30 became `-2.5`, not
`-3.5`) and indistinguishable between 30- and 45-minute zones; now computed as a sign-aware
`hours + minutes/60`. Added the one 45-minute zone missing from `window.html`'s `#timezone` list
(`GMT+05:45`, Kathmandu, `value="5.75"`).

`src/shared/window.ts`'s original is left with the bug untouched — it's a frozen source tree per
repo convention, and this fix is `src/shared-v2/`-only. Checked `tests/window-ui-equivalence/`'s
TC-11 (the only spec touching `#use_gmt`/`#timezone`) before changing anything: it only asserts
`#timezone`'s own `value`/`disabled` DOM state, never the resulting query string, so this fix
needed no test rewrite — just a DEVIATION note added to TC-11's row and DESIGN.md's deviations
list so a future test targeting the query string itself doesn't get written expecting parity with
the legacy page. See `docs/window-ui/DESIGN.md` v1.56 and `docs/window-ui/TC.md` v2.13.

## `#container`/`#left_panel`/`#right_panel`/`#drag` — dynamic aspect-ratio-driven split layout replacing the fixed 30/70 split (`src/shared-v2/` only)

Reported by the user as a plain bug first ("이 윈도우 사이즈가 변경되어도 초기값 그대로 입니다" —
the video panel's height stays at its initial value across a window resize). Root-caused via an
isolated Playwright repro (a minimal standalone HTML file, not the real app, to rule out interference
from a concurrently-running build in this same checkout — see below) before touching any real code:
`<rtsp-over-websocket>` sets `display: block` on itself once its own script runs, but never a
`width`/`height` — reasonable, since only the embedding page knows how much space it should get — and
nothing in `window.html`'s CSS gave it (or its `.video.sameRow` wrapper, whose own `height: auto`
rule sizes it to content instead of stretching) any explicit size either. The whole chain fell back
to the inner `<video>` tag's native UA-default box, a fixed size unrelated to and unresponsive to any
container/window resize — confirmed via the isolated repro (`hostComputedDisplay: "inline"` in a
naive version without the component's own `display:block`; in the real component, still a fixed
150px-class height with `display:block` present but no height anywhere in the cascade).

Before this diagnosis could turn into a fix, **the user interrupted mid-investigation and redirected
to a much larger, explicitly-specified feature** ("아니 씨발.. shared-v2의 window.html 와 window.js
만 봐...정확히 말할께" — stop, look only at shared-v2, here's the real spec): `#container` should
continuously switch between a row split (video left, Control UI right) and a column split (video top,
Control UI bottom) based on the page's own live aspect ratio at *any* size — not the existing fixed
`768px` viewport-width breakpoint — with `#drag` resizing horizontally in row mode / vertically in
column mode, and the two orientations' ratios remembered independently. Three genuinely ambiguous
design points were asked via `AskUserQuestion` rather than assumed: whether this replaces the
existing `<=768px` stacked-breakpoint mechanism entirely (yes) or coexists with it, the column mode's
default ratio (60:40 video:control — video larger, an explicit choice not derivable from anything
existing), and whether row/column ratios persist independently across orientation flips (yes) or
share one value.

**Explicit scope constraint, taken literally: `src/shared-v2/` only, nothing in `@melchi45/
rtsp-over-websocket` or `src/shared/`.** This ruled out the "obvious" component-level fix for the
original height bug (a `:host`-equivalent default size in `RTSPOverWebSocket.ts`'s own injected
CSS — moot anyway, since that component appends styles to `document.head` in light DOM, not a real
shadow root, so `:host` wouldn't even apply) and, more importantly, ruled out editing
`css/window.css`/`window.html`'s existing `#container`/`#left_panel`/`#right_panel`/`#drag` rules in
place — that file is re-exported unmodified from `src/shared/css/` and linked by *both* `window.html`s
(confirmed via `docs/window-ui/PRD.md`'s Non-Goals / `docs/window-ui/DESIGN.md`'s "module structure"),
so an in-place edit would have changed `src/shared/`'s own page too. Solved by adding a brand new,
`src/shared-v2/`-only stylesheet (`src/component/split-layout/split-layout.css`, linked from
`src/shared-v2/window.html` only, immediately after `css/window.css`'s own `<link>`) whose
plain-`#id`-selector rules win the cascade over `window.css`'s by document order alone (equal
specificity, later position — `<link>` stylesheets always apply in document order regardless of
fetch timing or the meaningless `async` attribute on `<link rel="stylesheet">`) — the same
"supersede via a later file, don't edit the shared one" pattern `event-timeline.css` already
established for the Playback timeline widget. `scripts/build.js`'s `buildSharedV2()` needed a new
explicit `copyFile()` for it in two places (the shared-v2-preview assembly, and the overwrite loop
onto `dist/chrome-extension/`/`dist/nodejs/examples/public/`) — a brand-new shared-v2-only asset,
unlike `switch.css`/`disclosure.css`, isn't reachable by any existing copy step.

**DOM restructuring: `#drag` moved out of `#right_panel` to be a real flex sibling.** The original
(`src/shared/window.html`-derived) markup nests `#drag` as `#right_panel`'s first child, positioned
to visually straddle the panel boundary via `margin-left: -3px` — only workable because
`#right_panel` was absolutely positioned with a known `left` edge. For a flexbox row/column layout,
`#drag` needed to be a genuine sibling of `#left_panel`/`#right_panel` under `#container` so its own
`flex-basis` (6px) directly *is* its visible width/height, no positioning hack required. Confirmed
safe before moving it: grepped all of `src/shared-v2/` for `left_panel`/`right_panel`/`#container`
references — only `discovery.ts` (the old drag handler itself, since removed) touched any of them, so
nothing else assumed `#drag`'s old nesting.

**Two independent state fields, one `applyRatio()` choke point.** `state.rowSplitRatio` (default 30,
matching the legacy 30/70 split) and `state.columnSplitRatio` (default 60, per the user's explicit
choice) are separate so an orientation flip never clobbers a ratio the user deliberately set in the
*other* orientation. Every place that changes the visible split — initial `setupSplitLayout()`,
`updateOrientation()`'s re-application on every flip, and the drag handler's live updates — goes
through one function (`applyRatio()`, sets `#left_panel.style.flexBasis`) rather than three
independent call sites, so there's exactly one path that could desync the displayed split from
`state`'s own numbers.

**Two small, deliberate improvements over a straight port of the legacy drag handler, not scope
creep — this was a full rewrite, not a port:** (1) `mousemove` instead of the legacy `mouseover` for
the document-level drag-follow listener — `mouseover` only re-fires on entering a *different*
element, so it followed a fast drag far less smoothly than continuous `mousemove` does; (2) the drag
ratio is now clamped to `[10%, 90%]` — the original had no bound at all, letting a fast drag fully
collapse either panel to 0%.

**Orientation detection via `ResizeObserver` on `#container`, not a `window` `resize` listener** —
`#container`'s own box can change size for reasons a `window`-level event wouldn't fire for at all
(an extension popup/side-panel resizing independently), and observing the actual element being
measured is the more direct signal regardless of the embedding context.

**Concurrent-editing hazard hit mid-investigation, not caused by this change**: this checkout was
being actively modified by another process at the same time (uncommitted changes to `package.json`,
several other `src/shared-v2/modules/*.ts` files, and `docs/window-ui/*.md` appeared mid-session,
turning out to be the ONVIF Information debug panel work from a parallel session) — a `dist/nodejs/`
rebuild triggered mid-diagnosis raced with that other process and left `dist/nodejs/examples/public/`
briefly deleted (a `rm -rf` + reassemble step from the OTHER process's own build, not this one)
between an initial health-check `curl` succeeding and a follow-up Playwright run failing with
`ENOENT`. Solved by switching the live-verification technique to a from-scratch, dependency-free
temporary HTML file (`/tmp/gmtfix/repro.html`) for the *initial* isolated diagnosis (proving the
"unstyled custom element" theory in complete isolation from the real build), then re-running
`node scripts/build.js node`/`shared-v2` once before the *final* verification against the real app —
worth remembering generally: when a file that was just confirmed to exist suddenly 404s/ENOENTs in a
shared checkout, suspect a concurrent build racing the filesystem before suspecting your own last
edit.

**Verified**: `npx tsc -p src/shared-v2/tsconfig.window.json --noEmit` clean. Live Playwright
verification against the real built app (not just the isolated repro) confirmed, in one continuous
run: landscape (1200×800) renders row-mode with the pre-existing ~30% split and `<rtsp-over-websocket>`
correctly tracking `#left_panel`'s own live width/height (the original reported bug — height no
longer stuck at its initial value); resizing to portrait (800×1200) flips to column-mode with a ~60%
split and the video on top; dragging `#drag` vertically in portrait mode changes the split live;
resizing back to landscape restores landscape's own *original* 30% ratio, not the ratio just set
while dragging in portrait — confirming the independent-per-orientation memory works exactly as
specified. (`<rtsp-over-websocket>` no longer *stretches* to fill `#left_panel`'s full box, though —
see the follow-up below, requested right after this verification.) See `docs/window-ui/DESIGN.md`'s
"FR-2.6: Dynamic split layout" section for the full design writeup, and `docs/window-ui/TC.md`'s
TC-48–TC-51.

### Follow-up, same feature, same day: video positioned (centered row / top-anchored column) instead of stretched to fill the panel

Requested directly by the user immediately after the above: `<rtsp-over-websocket>` should not simply
stretch to fill `#left_panel` — in row mode it should sit vertically centered within `#left_panel`'s
full height, and in column mode it should sit anchored to the top of its (now much shorter, full-
width) strip. Asked one clarifying question first (`AskUserQuestion`): since a full `width:100%;
height:100%` stretch leaves no slack space for "centered" vs. "top" to ever look different, did the
user want the video element itself to shrink to its own aspect ratio (creating slack space to
position within) rather than fill the panel? Confirmed yes.

**Implementation**: `.rtsp-over-websocket` dropped its `height: 100%` for `aspect-ratio: 16 / 9` (a
placeholder ratio, only relevant before any real stream connects) plus `width: 100%` (still tracks
`#left_panel`'s own live width). `.video`/`.video.sameRow` needed no override at all here — removed
the earlier `height: 100%` override entirely and let `window.css`'s own pre-existing `.video.sameRow
{ height: auto }` rule do the job unmodified, now that "auto" is exactly what's wanted (content-
driven height, not stretched). `#left_panel`'s own `align-items: center` (already there, needed for
nothing else) now has actual effect since its child no longer fills 100% height; a new
`#container.split-portrait #left_panel { align-items: flex-start; }` override handles column mode
(its own flex-direction is still row — only `#container`'s direction changes — so `align-items`
there is always the *vertical* cross-axis alignment regardless of `#container`'s orientation).

**Dynamic real-resolution wiring, not just a static guess.** `onResize()` (`videoControl.ts`) already
existed (wired to the player's own `'resize'` event, reporting real decoded width/height) but only
ever wrote inert `width`/`height` HTML attributes with no layout effect. Extended it to also set
`element.style.aspectRatio` — an inline style, so it overrides `split-layout.css`'s `16/9` placeholder
the moment a real stream connects, without needing to touch the CSS rule itself (cascade priority
alone handles it).

**Verified** via `getBoundingClientRect()` math, not just visual inspection: at 1200×800 (row mode),
the video's top gap and bottom gap within `#left_panel` were both exactly 299.3px (perfectly
centered); at 800×1200 (column mode), the top gap was 11.0px — exactly `#left_panel`'s own 10px
padding plus a fractional rounding pixel, i.e. flush against the top edge, not centered. `npx tsc`
clean; `npx playwright test tests/window-ui-equivalence/event-timeline.spec.ts` (all 6 tests) still
passes after this change too (see the environment-instability entry below for why an earlier attempt
at this same check looked like a regression when it wasn't).

### Follow-up, same feature, same day: a "regression" chased for over an hour turned out to be self-inflicted process/port contention, not a code bug

While verifying `tests/window-ui-equivalence/event-timeline.spec.ts` (the one spec using an unusually
tall Playwright viewport, `1280×2200`, specifically to avoid a documented nested-scroll auto-click
limitation — see that file's own top comment) against the new split layout, the *first* run showed
real-looking failures: `#channel` never became a `<select>`, with browser console logs showing
`net::ERR_ABORTED` on every SUNAPI request once Playback mode was selected. Swapping the same test's
viewport to landscape (`2200×1280`) made it pass instantly, which looked like strong, clean evidence
that column/portrait mode specifically broke something. It didn't, in the end — the real cause was
running the *diagnostic* commands themselves: repeated `node scripts/build.js shared-v2` rebuilds and
several overlapping `npx playwright test` invocations (some silently backgrounded when a Bash
tool-call's own timeout elapsed, without their child `webServer` processes — `tools/mock-sunapi-
server/`, two `tools/equivalence-test-server/` instances — necessarily terminating with them) left
multiple stale server processes fighting over the same ports (`EADDRINUSE` on 9101/9301, then later
`net::ERR_CONNECTION_REFUSED` once a diagnostic `pkill` killed a server Playwright's own
`reuseExistingServer: true` config was still relying on, out from under an in-progress test). Once
every stray `playwright`/`mock-sunapi-server`/`equivalence-test-server` process was killed and exactly
one clean, uninterrupted, back-to-back pair of runs was done (portrait then landscape, touching
*nothing* concurrently, letting Playwright's own `webServer` orchestration cold-start every server
itself) — both passed, and both took several minutes doing it (4.6 and 6.9 minutes respectively,
matching each other closely), confirming the earlier "landscape is fast, portrait is broken"
impression was itself an artifact of landscape's runs having reused already-warm servers from earlier
attempts while portrait's ran cold combined with active interference.

**How to apply**: in a test harness with its own long-lived `webServer` processes
(`reuseExistingServer: true` or equivalent), never manually kill/restart those processes while
diagnosing a *different* suspected bug, and never run a project rebuild concurrently with an
in-progress test run against that same `dist/` output — both were done here, repeatedly, while trying
to isolate what turned out to be a phantom orientation-specific bug. When a Bash tool call's own
timeout causes a long-running command to "move to background," verify its actual child processes
(`ps aux`, `lsof -i :<port>`) rather than trusting the tool's own reported exit code/output alone —
several of these background transitions here left real orphaned server processes with no visible
sign in the captured output at all (empty log, "exited with code 0" for what was actually still a
live detached process). When a suspected regression's evidence involves network-level failures
(`ERR_ABORTED`, `ERR_CONNECTION_REFUSED`, `EADDRINUSE`) rather than an application-level assertion
failure, suspect the test *environment* before the application code — and confirm by fully quiescing
every related process and re-running once, cleanly, rather than trusting a result gathered mid-chaos.

### Follow-up, same feature, same day: `#left_panel`/`#right_panel` renamed to `#video-panel`/`#control-panel` (`src/shared-v2/` only)

Requested directly by the user once the dynamic split layout feature itself was confirmed working —
a pure rename, no behavior change, scoped to `src/shared-v2/` per the same standing "don't touch
`src/shared/`" instruction that governed this whole feature. Safe to do as a clean rename specifically
*because* `split-layout.css` already fully overrides every property `css/window.css`'s own
`#left_panel`/`#right_panel` rules set (position, flex, min-width/height, margin, padding, overflow,
display, align-items — confirmed by re-reading `window.css`'s original rules side by side with
`split-layout.css` before renaming) — so once the ids no longer match anything in `window.css` for
`src/shared-v2/window.html`, nothing was silently lost; `window.css`'s own `#left_panel`/`#right_panel`
rules just become unreferenced-but-harmless for that tree, exactly like several other rules already
documented that way in `docs/window-ui/DESIGN.md`'s "Deviations from legacy behavior".

Four files changed together: `window.html`'s two `id` attributes (plus a doc-comment), every selector
in `split-layout.css` (plus its header/inline comments), every `document.getElementById(...)` call
and doc-comment in `dynamicLayout.ts` (its local `leftPanel` variable renamed to `videoPanel` too, for
consistency with the new id it now holds), and the doc-comments in `state.ts`/`videoControl.ts` that
named the old id. `css/window.css` itself (the `src/shared/`-owned file) was correctly left completely
untouched — confirmed via a live Playwright check that `document.getElementById('left_panel')`/
`getElementById('right_panel')` both return `null` on the rebuilt `src/shared-v2/` page (the old ids
are genuinely gone, not just superseded), while `#video-panel`/`#control-panel`'s live behavior
(row/column split proportions, drag-resize, the centered/top-anchored video positioning from the
immediately preceding follow-up) measured pixel-identical to before the rename.

**Documentation**: went through `docs/window-ui/DESIGN.md`'s "FR-2.6: Dynamic split layout" section
paragraph by paragraph rather than a blind find-replace — several sentences there deliberately
describe `src/shared/`'s own still-unrenamed `#left_panel`/`#right_panel`, or describe *historical*
code (the now-deleted pre-`dynamicLayout.ts` drag handler, a debugging investigation from earlier in
this same day) that was accurate to the ids that existed *at that point in time* — those were left
alone; only the paragraphs describing `src/shared-v2/`'s current, live behavior were updated to the
new ids. Same care applied to `docs/window-ui/SRS.md`/`TC.md`: History-table rows describing prior
versions kept their original id names (accurate as of *that* version), only the live requirement text
and the FR-2.6 test cases (TC-48–TC-53) were updated.

**How to apply**: when a rename touches a file that's *shared* with another tree (here,
`css/window.css`, reused unmodified by `src/shared/`), renaming the id only in the tree-specific
markup/JS/CSS (never the shared file) is safe exactly when something else *already* fully
re-overrides every property the shared file's rule for that id would otherwise contribute — verify
that before renaming, not after. In a living design doc with a lot of accumulated history, a rename
sweep needs the same "is this describing current behavior or documenting what was true at a past
point" judgment call as any other edit — a mechanical find-replace across the whole file would have
silently rewritten historical debugging notes and version-specific History entries to claim ids that
didn't exist yet at the time being described.
