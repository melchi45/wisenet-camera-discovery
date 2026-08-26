# Architecture: the shared `src/shared/` UI

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
    css/{window,modal,table}.css
    scripts/
      socket.ts                (discovery transport — see "socket.ts" below)
      legacy-globals-bridge.js (rtsp-over-websocket ESM -> window globals bridge)
    types/globals.d.ts
    tsconfig.window.json        (type-check only, module: ESNext, feeds Vite)
    tsconfig.socket.json        (emits, module: none — classic global script)
    vite.config.ts               (bundles window.ts -> build/shared/window.js, one IIFE)

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
same as before this change — no `IS_EXTENSION` guard needed there).

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

## Before/after touching `src/shared/`

Read this file first. After changing `window.ts`, `socket.ts`, or `server.ts`'s
discovery/settings pieces, update this file in the same change, and add a `MEMORY.md` entry if
the change is a non-obvious decision (redesign, real bug fix, naming/architecture call) worth
preserving beyond just these docs. Changes here affect **both** `dist/chrome-extension/` and
`dist/nodejs/examples/public/` — verify both builds (`npm run build`), not just one you happened
to be testing.
