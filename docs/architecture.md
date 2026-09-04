# Architecture: the shared `src/shared/` UI

| | |
|---|---|
| Title | Architecture: the shared `src/shared/` UI |
| Abstract | What's shared between the Chrome extension and the nodejs example server, the `socket.ts` transport abstraction, discovery result views, control panel data binding, and the reusable UI components (switch, disclosure). |
| Status | Implemented |
| Component | `src/shared/`, `src/component/` |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-12 | Youngho Kim | Initial commit: WiseNet/Hanwha Chrome IP Installer + Node.js UDP discovery package. |
| 1.1 | 2026-08-26 | Youngho Kim | Native-host proxy bypasses untrusted TLS certs for SUNAPI + video streaming. |
| 1.2 | 2026-08-26 | Youngho Kim | Fixed unhandled promise rejections in `socket.ts` + verbose discovery logging toggle. |
| 1.3 | 2026-08-27 | Youngho Kim | Discovery result Star Topology view with Group by + search filtering. |
| 1.4 | 2026-08-28 | Youngho Kim | Documented the switch/disclosure components and control panel data binding; added Title/Abstract/Author/Milestone/History metadata. |

## Why this exists

This repo has two independent consumers of Wisenet SUNAPI UDP discovery:

- **The Chrome extension** (`src/chrome-extension/`) — a full camera/NVR player + discovery
  UI, loaded unpacked (`dist/chrome-extension/`).
- **The nodejs package's example server** (`src/nodejs/examples/server.ts`) — a small reference
  server demonstrating `UDPDiscovery` (`src/nodejs/udpDiscovery.ts`), originally with its own
  102-line throwaway static page.

Both discovery paths already parsed the exact same SUNAPI UDP wire format via the shared
`src/sunapi/` package (`response.ts`'s `toLegacyDeviceObject()`), so the raw discovered-device
shape — `chDeviceName`, `chIP`, `chMac`, `modelType`, `nHttpPort`, `nHttpsPort`, `httpType`,
`DDNSURL`, computed `url`/`rtspUrl`, etc. — was already byte-for-byte identical between them.
Given that, the standalone example page was deleted and the extension's full `window.html`/
`window.ts` UI was moved to `src/shared/` and made to serve **both** targets, each supplying its
own discovery *transport* and settings-persistence backend.

## What's shared vs target-specific

```
src/
  shared/                     <- built once, copied into both dist/ outputs
    window.html
    window.ts                 (the full UI: discovery table, player controls, SUNAPI, etc.)
    css/{window,modal,table,timeline}.css
    scripts/
      socket.ts                (discovery transport — see "socket.ts" below)
      legacy-globals-bridge.js (rtsp-over-websocket ESM -> window globals bridge)
      nativeSunapiClient.ts, nativeWebSocketTransport.ts (native-host proxy — see
                                docs/native-https-proxy/)
    types/globals.d.ts
    tsconfig.window.json        (type-check only, module: ESNext, feeds Vite)
    tsconfig.socket.json        (emits, module: none — classic global script)
    vite.config.ts               (bundles window.ts -> build/shared/window.js, one IIFE)

  component/                  <- reusable UI components, not shared/-specific;
                                  imported into window.ts by relative path
    switch/
      switch.ts                 (mountSwitch() — see "Reusable UI" below and
                                  docs/switch-component/)
      switch.css                 (copied into both dist/ css/ dirs by
                                  scripts/build.js, alongside src/shared/css/)
    disclosure/
      disclosure.ts               (mountDisclosure() — see "Reusable UI" below
                                  and docs/disclosure-component/)
      disclosure.css               (copied into both dist/ css/ dirs, same as
                                  switch.css)

  chrome-extension/           <- extension-only
    manifest.json, background.ts, icons/, native-host/

  nodejs/                     <- nodejs package
    examples/server.ts        (the example server — now stateful, see below)
    udpDiscovery.ts, index.ts
```

`scripts/build.js`'s `copySharedWebAssets(destDir)` copies `src/shared/`'s build output
(`window.html`, the Vite-built `window.js`, the separately-compiled `scripts/socket.js`,
`legacy-globals-bridge.js`, `css/`) plus `vis.css`+`img/` and the `@melchi45/rtsp-over-websocket`
vendor files into **both** `dist/chrome-extension/` and `dist/nodejs/examples/public/` — same
relative structure in both, so `window.html`'s `<script src="...">`/`<link href="...">` paths
don't need to differ per target at all.

One Vite bundle serves both consumers: `window.ts`'s `chrome.*` call sites are *runtime*
feature-detected (`IS_EXTENSION`, see below), not built differently per target.

## `socket.ts`: the transport abstraction

`IS_EXTENSION = typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.connectNative`,
computed once at the top of `socket.ts`, also read by `window.ts` (declared ambiently in
`types/globals.d.ts`, since both are still classic global scripts / a Vite IIFE — no real
`import` between them).

| | Extension (`IS_EXTENSION` true) | Nodejs example (`IS_EXTENSION` false) |
|---|---|---|
| Transport | `chrome.runtime.connectNative(HOST_NAME)` — a native messaging host (`native-host/wisenet-udp-host.js`) does the actual UDP broadcast/listen, since `chrome.sockets.udp` isn't available to MV3 extensions | `new WebSocket(.../discover)` to the example server |
| `socket.start()` | connects native host, sends `{command:'start',...}` | opens the WS; server starts discovery on connect |
| `socket.broadcast()` | `{command:'broadcast'}` on the existing port | no server-side "re-broadcast" command — reconnects instead |
| `socket.stop()` | `port.postMessage({command:'stop'})` + `port.disconnect()` | `ws.close()` |
| Message shape | native host relays `{type:'device', device}` etc. | server sends the identical `{type:'device'|'listening'|'sent'|'error'|'parseError'|'done', ...}` shape |

Both paths funnel into the **same** `socket.onHostMessage()` → `socket.onDevice()` →
`socket.displayResult()` (raw SUNAPI fields → `{DeviceName, IPAddress, MACAddress, Port, URL,
Model, Protocol}`) → `window.dispatchEvent(new CustomEvent('discover', {detail: {data: result}}))`
pipeline — `window.ts`'s `addDiscoveredDeviceRow()` never needs to know which transport is
running. `extensionId`/`extensionId2`/`extensionId3` cross-extension forwarding stays wrapped in
its existing try/catch (throws harmlessly and is ignored when `chrome` doesn't exist at all,
same as before this change — no `IS_EXTENSION` guard needed there); each forward is also its own
`chrome.runtime.sendMessage(id, ...)` call, which must carry a `.catch(() => {})` of its own since
a synchronous try/catch does nothing for that call's own async rejection when the target id isn't
installed (the common case) — see `MEMORY.md`'s entry on the unhandled-rejection flood this was
found from.

`onDevice()`'s own `console.log("device", device)` is gated behind a `chrome.storage.local`
flag (`verboseDiscoveryLoggingEnabled`, key `verboseDiscoveryLogging`), off by default — see
[README.md § Debugging: verbose per-device discovery
logging](../README.md#debugging-verbose-per-device-discovery-logging) for the exact enable/disable
console commands. Backed by storage rather than a UI checkbox specifically because
`background.js`'s automatic-mode discovery has no UI to put a checkbox on; `socket.ts` reads it
once at load and keeps it live via `chrome.storage.onChanged`, mirroring `background.ts`'s own
`autoDiscoveryEnabled` pattern, rather than an async `chrome.storage.local.get()` per discovered
device.

## `window.ts`'s 4 direct `chrome.*` call sites

Everything else in `window.ts` is `chrome`-agnostic. Exactly 4 spots talk to `chrome.storage`/
`chrome.runtime` directly, each guarded by `IS_EXTENSION`:

1. **Auto-discovery toggle, read** — extension: `chrome.storage.local.get(...)`; nodejs:
   `fetch('/settings')`.
2. **Auto-discovery toggle, write** — extension: `chrome.storage.local.set(...)`; nodejs:
   `fetch('/settings', {method:'POST', ...})`.
3. **Catch up on already-known devices on load** — extension only
   (`chrome.runtime.sendMessage({type:'wisenet-request-known-devices'})`, answered by
   `background.ts`). Skipped entirely outside the extension: the WS transport already replays
   the server's cached known-devices as ordinary `'device'` messages right after connect (see
   below), which flow through the same `addDiscoveredDeviceRow()` pipeline — no second
   mechanism needed.
4. **Live broadcast listener** (`chrome.runtime.onMessage.addListener(...)` for
   `wisenet-discover-result`, forwarded from `background.ts`'s automatic-mode discovery) —
   extension only, for the same reason: one open WebSocket already receives everything the
   nodejs server's background loop finds.

Before this change, call site 4 was unguarded top-level code — it would throw synchronously
outside the extension and abort the rest of `window.ts`'s module-level setup (see `MEMORY.md`'s
`#broadcast`/`#usegmttime` entry for the same failure class found earlier in this codebase).

There's a 5th, opt-in `chrome.*` call site: `src/shared/scripts/nativeSunapiClient.ts`, its own
`chrome.runtime.connectNative()` port (separate from `socket.hostPort` above), used only when the
"Bypass Untrusted Certificate (Native Host)" checkbox is checked — a way to complete SUNAPI
requests against a camera/NVR with a self-signed HTTPS certificate without the manual
per-device/per-machine browser certificate-exception step, by having the native host (which sits
outside the browser's TLS trust store) make the HTTPS request instead. Extension-only, same as the
other 4. See [`native-https-proxy/DESIGN.md`](native-https-proxy/DESIGN.md) for the full design —
in short, it substitutes a `SunapiClientLike` implementation into the vendored
`@melchi45/rtsp-over-websocket` package's `SunapiManager.attach()`, a seam that package already
exposes for exactly this kind of transport substitution.

## `examples/server.ts`: mirroring `background.ts`'s role

The extension's `background.ts` (MV3 service worker) runs discovery continuously, keeps a
`socket.knownDevices` cache, and answers `wisenet-request-known-devices` so a newly-opened
`window.html` can catch up. `examples/server.ts` now does the nodejs-side equivalent:

- `knownDevices` (module-level, keyed by `chIP`) — replayed to each new WS connection before
  anything else.
- `connectedClients` (a `Set` of open WS connections) — every device the background loop finds
  gets pushed to all of them (`broadcastToClients`), mirroring `chrome.runtime.sendMessage`'s
  extension-wide broadcast.
- A background scan every `AUTO_DISCOVERY_INTERVAL_MS` (30s): a **fresh, short-lived**
  `UDPDiscovery({timeout: 5000})` per round, not one long-lived bound socket — simpler and
  equally correct, and needs zero changes to `udpDiscovery.ts` itself.
- `GET/POST /settings` (`{autoDiscoveryEnabled}`) — the nodejs-side equivalent of
  `chrome.storage.local`'s role for the toggle.
- `WS /discover`: on connect, replays `knownDevices`, then runs one immediate round (mirrors
  clicking "Start Discovery"). The connection **stays open** after that round's `'done'` — it
  used to `ws.close()` immediately, but now keeps streaming whatever the background loop finds
  next, closing only when the client disconnects (mirrors the native-messaging transport
  staying connected until the extension calls `stop()`).
- A small static-file handler (`serveStaticFile`) for `/window.js`, `/css/*.css`,
  `/scripts/*.js`, `/external-lib/**` — the original server only special-cased `GET /` and
  `/discover`; `window.html` now references many more files than the old single-file page did.

## Data flow

```mermaid
flowchart TB
  subgraph Extension["Chrome extension"]
    NH["native-host/wisenet-udp-host.js\n(raw UDP broadcast/listen)"]
    BG["background.ts\n(automatic mode, knownDevices cache)"]
    SK1["socket.ts\nIS_EXTENSION=true"]
  end
  subgraph Nodejs["nodejs example server"]
    SRV["examples/server.ts\n(background loop, knownDevices cache, /settings)"]
    UDP["udpDiscovery.ts (dgram)"]
    SK2["socket.ts\nIS_EXTENSION=false"]
  end
  SUNAPI["sunapi/response.ts\ntoLegacyDeviceObject()\n(shared parser)"]

  NH -->|chrome.runtime.connectNative| SK1
  BG -.->|chrome.runtime.onMessage\nwisenet-discover-result| SK1
  UDP --> SRV
  SRV -->|WebSocket /discover| SK2

  SUNAPI --> NH
  SUNAPI --> UDP

  SK1 --> DR["socket.displayResult()\n(raw fields -> UI record)"]
  SK2 --> DR
  DR -->|window.dispatchEvent('discover')| WT["window.ts\naddDiscoveredDeviceRow()"]
```

## Discovery result views: table vs. star topology

See [`docs/star-topology/`](star-topology/) (MRD/PRD/SRS/DESIGN/TC) for the full spec — this
section is a brief pointer, the same relationship `docs/native-https-proxy/` has to this file for
that feature. In particular, [`docs/star-topology/DESIGN.md`](star-topology/DESIGN.md)'s
"Interaction stability" section covers a non-obvious point not repeated here: every
`renderDiscoveryTopology()` call **destroys and reconstructs** the `vis.Network` instance from
scratch rather than reusing it via `setOptions()`/`setData()` — reuse was tried first and caused
every interaction (hover/click/drag) to misbehave after a search/group-by re-render.

`#discovery_view_type` (`window.html`, next to `#datatable_search`) toggles between the original
`#datatable` table and `#datatable_topology`, a node-link diagram rendered by
`renderDiscoveryTopology()`. Both views read the same `dataSet: string[][]` — `addDiscoveredDeviceRow()`
is still the single write path; the topology view adds no second data source. `dataSet` stays a
flat, IP-keyed list (see above) — SUNAPI discovery has no parent/child device field, so the
topology's hub nodes are always a client-side derivation, not real network topology, and hub nodes
are never linked to each other for the same reason — **except** the `ip` grouping's own
`/8`→`/16`→`/24` hub chain, which *is* linked hub-to-hub because IP-subnet containment is a real
relationship read directly off the group key, not a fabricated one (see
`docs/star-topology/DESIGN.md`'s "The `ip` grouping's hub hierarchy" section for the
`getIpHubChain()`/dedup/color-cycling details). See `MEMORY.md`'s "Discovery result 'Star
Topology' view" entry for why this needed no new dependency (`vis.Network` ships in the same `vis`
package already used for the playback `Timeline`, already fully bundled via `window.ts`'s `import
* as vis from 'vis'`) and what would be needed for a real NVR→channel hierarchy instead. Selecting
a device — a table row click or a topology leaf-node click — both funnel through the shared
`applyDiscoveredDeviceSelection(row_data)`; a leaf node's `id` is always the device's IP address
(the same dedup key `addDiscoveredDeviceRow()` already uses), regardless of how it's grouped, so
that lookup never has to change.

### Group by: which column decides the hub a device belongs to

`#discovery_topology_group_by` (visible only while the topology view is active, same show/hide
pattern as `#datatable_topology` itself) selects the `dataSet` column `renderDiscoveryTopology()`
groups by. `getTopologyGroupKey(row, groupBy)` extracts the key, `getTopologyHubLabel(key,
groupBy)` formats the hub's label:

| `groupBy` value | `dataSet` index | key extraction | hub label |
|---|---|---|---|
| `ip` (default) | 1 (IPAddress) | first 3 dot-segments (`/24`), plus `/16`/`/8` ancestor hubs chained above it | `"{key}.0/24"` (`/16`: `"{key}.0.0/16"`, `/8`: `"{key}.0.0.0/8"`) |
| `name` | 0 (DeviceName) | substring before the first `-` (whole value if none) | `"{key}"` |
| `mac` | 2 (MACAddress) | first 3 colon-segments (OUI/vendor prefix) | `"{key} (OUI)"` |
| `port` | 3 (Port) | exact value | `"Port {key}"` |
| `protocol` | 5 (Protocol) | exact value | `"{key}"` |

`Http URL` (index 4) is not a grouping option — it's derived from IP+port, not an independent
dimension. MAC addresses are confirmed colon-separated (`"00:09:18:AB:CD:EF"`-shaped): `chMAC` in
`src/sunapi/protocol.ts` is an 18-byte null-terminated wire string, and 17 chars + a null
terminator is exactly that format. `name`'s "prefix before the first `-`" rule matches Wisenet/
Hanwha model-line codes (`PNM-9322VQP` → `PNM`, `QNO-8010R` → `QNO`).

### Search filters and zooms the topology view too — by reusing the table's own row-match predicate

`#datatable_search` already filters the table by testing whether *any* cell in a `dataSet` row
contains the search text (`renderDiscoveryTable()`'s filter). `renderDiscoveryTopology()` reuses
that exact same per-row predicate to decide which leaves to include, rather than inventing a
second, per-`groupBy`-type matching rule — a hub is kept whenever it has at least one matching
leaf, computed as a side effect of one pass over `dataSet`. This is enough on its own to produce
prefix-drill-down behavior for every `groupBy` type, because every hub label is itself derived
from a literal substring of its leaves' own field values: typing `"192."` matches every leaf whose
IP contains it, which can span several `/24` hubs at once (typing `"192.168."` then `"192.168.
214."` narrows further, same mechanism); typing `"P"` while grouped by `name` matches every leaf
whose Name contains it, spanning multiple hubs at once (e.g. "PNM"/"PNO"/"PND"). No hub is ever
special-cased as "the" match — all currently-matching hubs and their matching leaves stay, and
`visNetwork.fit({ animation: {...} })` is called after `setData()` so the camera bounds to
whatever's left, whether that's one cluster or several. An empty search text is a no-op (same
full-graph behavior as before). Changing `#discovery_topology_group_by` re-runs this same
render/filter/fit pipeline from scratch.

## Playback controls: manual time range, timeline search, UTC

The Playback panel (`#playback_control` in `window.html`) has three independent controls below
the `#timeline` vis.js widget, each with its own execution model — worth keeping straight since
they look superficially similar (all read `#start_date`/`#start_time`/`#end_date`/`#end_time`):

- **Search Overlapped Id** / **Search Date** — two separate buttons, each triggering an
  unrelated SUNAPI call (`getOverlappedIdList` vs. `getCalendarSearch`). These are *not* a
  toggle: an earlier iteration merged them into one segmented-toggle + single "Search" button
  (mirroring the pattern below) and had to be reverted — the two aren't alternate ways of running
  the same action, they're genuinely different actions a user may want either or both of.
- **Search Timeline** (`search_timeline` button) — *is* a toggle:
  `#search_timeline_range_toggle` (1 Day / 3 Month, a `segmentedToggle` — see below) picks which
  of `search_oneday_timeline()`/`search_three_month_timeline()` the shared
  `runTimelineSearch(start, end)` helper actually runs. Both call the same `getTimeline()` +
  `updateTimeline()` pipeline; they only differ in how the date range is computed — "1 Day" uses
  the Manual Start/End Time fields as-is, "3 Month" ignores Manual End Time and always spans 3
  months forward from Manual Start Time (there's no server-side "3 month" SUNAPI mode, it's a
  client-side convenience). **The lesson from the revert above**: this segmented-toggle-plus-one-
  button shape only fits when the two options are alternate executions of one action; two
  genuinely independent actions (like Overlapped Id/Date) should stay separate buttons.
- **Manual End Time** is opt-in via the `#support_end_time` checkbox (`onchangesupportendtime()`)
  — unchecked (the default) hides `#manual_end_time_group` and clears the player element's
  `endTime` to `null` rather than leaving a stale value set. `endTime === null` is not an error
  state for `rtsp-over-websocket`: `RTSPOverWebSocket.ts`'s `play()`/`generateRTSPURL()` already
  treat a null/undefined `endTime` as "no end" — an open-ended playback range from `startTime`
  onward — so no library-side change was needed, only not setting it from this UI when the
  checkbox is off.

**`SearchByUTCTime` capability gating.** SUNAPI's Timeline Search only honors a `Z`-suffixed
(UTC) `FromDate`/`ToDate` when the device's own `/stw-cgi/attributes.cgi` response declares
`SearchByUTCTime=true` (SUNAPI Application Programmer's Guide §8.6) — sending `Z` to a device
that doesn't declare support isn't guaranteed to be interpreted as UTC. `applySearchByUTCTimeCapability()`
(called from the same `initPromise.then(attributes => ...)` continuation that already reads
`attributes.MaxChannel`/`.IsAndroid`) disables `#use_gmt` ("Use timezone" — the checkbox that
appends `Z` throughout `search_overlapped_id`/`search_date`/`search_oneday_timeline`/the playback
timeline) whenever the capability isn't declared `true`, forcing it off first if it was already
checked. **Non-obvious part**: `attributes` here is *either* a parsed object (JSON-firmware
devices) *or* a raw XML string (see this file's own comment trail at the `deviceInformation.attributes.IsAndroid`
call site — no XML capabilities parser ships with the extension, a previous ~2500-line one was
removed). `getCapabilityValue()` reads a single named `<attribute value="...">` out of either
shape via a targeted regex on the string case, rather than resurrecting a full parser just for
this one field. `MaxChannel`/`IsAndroid` have the same object-vs-string exposure and silently
read as `undefined` on an XML-firmware device today — a known, not-yet-fixed gap, not something
`getCapabilityValue()` was extended to cover since nothing currently depends on it doing so.

## Reusable UI: the switch component (`src/component/switch/`)

See [`docs/switch-component/`](switch-component/) (MRD/PRD/SRS/DESIGN/TC) for the full spec — this
section is a brief pointer, the same relationship this file has with `docs/star-topology/`/
`docs/native-https-proxy/`. `src/component/switch/switch.ts`'s `mountSwitch()` progressively
enhances existing checkbox/radio-group/button-group markup into a themed pill or iOS-style slider,
replacing what used to be three separate ad hoc mechanisms (a hand-rolled `.theme-switch` slider,
static `.segmented-toggle` radio/button markup, and `segmentedToggle.ts`'s one checkbox-only helper
— now deleted). All five of this UI's switch-shaped controls are mounted through it: dark mode
(`#theme_switch`), HTTP/HTTPS protocol (`#http_type_toggle`), Live/Playback (`#play_type_toggle`),
the Playback 1 Day/3 Month range (`#search_timeline_range_toggle`), and SUNAPI On/Off
(`#sunapi_toggle`) — every one of their
pre-existing `document.getElementById(...).checked`/`querySelector('input[name="..."]:checked')`
call sites in `window.ts` kept working unchanged through the migration, since `mountSwitch()` never
replaces the original input(s)/ids/names, only adds sibling label/knob elements and CSS classes
around them.

## Reusable UI: the disclosure component (`src/component/disclosure/`)

See [`docs/disclosure-component/`](disclosure-component/) (MRD/PRD/SRS/DESIGN/TC) for the full spec
— same brief-pointer relationship as the switch component above.
`src/component/disclosure/disclosure.ts`'s `mountDisclosure()` progressively enhances an existing
native `<details>`/`<summary>` element, used for the three collapsible log panels at the bottom of
`window.html`: Debug Information (`#debug_disclosure`, with its "Use"/"Clear" header controls
passed as `headerCheckboxId`/`headerButtonId`), Discovery (`#discovery_disclosure`), and RTSP
(`#rtsp_disclosure`) — all three start collapsed and don't persist state across reloads. Built on
`<details>`/`<summary>` rather than a hand-rolled `aria-expanded` widget specifically so open/close,
keyboard activation, and the correct semantics come from the browser for free; the only JS problem
`mountDisclosure()` actually solves is stopping a header control's click from bubbling up through
`<summary>` and also toggling the panel.

## Control panel data binding: device selection & SUNAPI response

See [`docs/control-panel-data-binding.md`](control-panel-data-binding.md) for the full field-by-
field spec of three existing (not new) `window.ts` behaviors that populate the Control panel
automatically rather than from direct user input: selecting a discovered device
(`applyDiscoveredDeviceSelection()` — hostname/port/protocol/native-TLS-proxy/webview fields),
switching the "Plyaer List:" dropdown between already-existing `<rtsp-over-websocket>` elements
(`on_player_select()` — reads that element's own current attributes back into the panel, no
network request), and turning "SUNAPI:" On (`initSunapiManager()`'s request chain — channel list,
video source/profile display, timezone, play-button state).

## Before/after touching `src/shared/`

Read this file first. After changing `window.ts`, `socket.ts`, or `server.ts`'s
discovery/settings pieces, update this file in the same change, and add a `MEMORY.md` entry if
the change is a non-obvious decision (redesign, real bug fix, naming/architecture call) worth
preserving beyond just these docs. Changes here affect **both** `dist/chrome-extension/` and
`dist/nodejs/examples/public/` — verify both builds, not just one you happened to be testing. Use
`npm run build:no-shared-v2` for this, not plain `npm run build` — that one now also chains
`npm run build:shared-v2` as its own last step (see `CLAUDE.md`), which immediately
overwrites `src/shared/`'s own output with the `src/shared-v2/` build, masking exactly the change
you're trying to verify. See the [`shared-window`](../.claude/skills/shared-window/SKILL.md) skill's
own "Caveat" for the full explanation.
