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

