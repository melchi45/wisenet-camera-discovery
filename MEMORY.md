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
