# WiseNet UDP Camera Discovery — Node.js

Node.js port of the **WiseNetChromeIPInstaller** Chrome App UDP broadcast discovery.

Replaces `chrome.sockets.udp` with Node.js built-in `dgram` module. No external dependencies.

**Source vs. build output**: this file (`nodejs/`) is TypeScript source
(`src/nodejs/`, actually) — the commands below assume you're running them
from **`dist/nodejs/`**, the compiled, self-contained package produced by
`npm run build` at the repository root (see the root
[README.md](../README.md#build)). `dist/nodejs/` is what actually gets
`npm publish`ed; nothing runs `require()` against `nodejs/`'s `.ts` files
directly.

## Protocol

| Parameter | Value |
|---|---|
| Send port | `7701` (broadcast to cameras) |
| Receive port | `7711` (listen for camera responses) |
| Broadcast address | `255.255.255.255` |
| Packet format | Proprietary WiseNet/Hanwha binary |

The discovery sends a fixed UDP broadcast packet, then parses binary responses from WiseNet IP cameras containing IP address, MAC address, HTTP/HTTPS ports, RTSP port, model type, firmware version, and DDNS URL.

## Requirements

- Node.js 12+
- No npm packages required
- Port 7711 may require elevated privileges on some systems

## Installing this package in another project

This package is published as **`@melchi45/wisenet-udp-discovery`** to
**GitHub Packages** (not the public npm registry) — see
[`.github/workflows/publish-npm.yml`](../../.github/workflows/publish-npm.yml)
for how/when it's published. To install it elsewhere:

1. Create a [personal access token](https://github.com/settings/tokens) with
   `read:packages` scope.
2. In the consuming project, add a `.npmrc` (do **not** commit the token
   itself — use an env var):
   ```
   @melchi45:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${GH_PACKAGES_TOKEN}
   ```
3. Install it:
   ```bash
   npm install @melchi45/wisenet-udp-discovery
   # or, to track pre-release builds published on every push to main:
   npm install @melchi45/wisenet-udp-discovery@beta
   ```
4. Use it the same way as the [API](#api) below, just via the package name
   instead of a relative `require()` — note this package's `main`
   (`index.js`) is the CLI demo above and starts a discovery run as a
   side effect of being `require()`d, so import the `udpDiscovery`
   submodule directly rather than the package root:
   ```javascript
   const { UDPDiscovery } = require('@melchi45/wisenet-udp-discovery/udpDiscovery');
   ```

## Quick Start

```bash
npm install && npm run build   # from the repository root, once
cd dist/nodejs
node index.js
```

Example output:
```
[UDP] Listening for camera responses on port 7711...
[UDP] Discovery broadcast sent → 255.255.255.255:7701
[UDP] Waiting 5s for responses...
[FOUND] { name: 'QNV-8080R', ip: '192.168.1.64', mac: '00:09:18:XX:XX:XX', url: 'http://192.168.1.64:80', rtsp: 'rtsp://192.168.1.64:554/profile1/media.smp', model: 1, sunapi: true }
[UDP] Discovery complete.
```

## API

```javascript
const { UDPDiscovery } = require('./udpDiscovery');

const discovery = new UDPDiscovery({
  sendPort: 7701,       // optional
  receivePort: 7711,    // optional
  broadcastAddr: '255.255.255.255'  // optional
});

discovery.on('device', (camera) => {
  console.log(camera.chIP, camera.rtspUrl);
});

discovery.on('error', (err) => console.error(err));

discovery.start();
setTimeout(() => discovery.stop(), 5000);
```

## Example server

[`examples/server.js`](examples/server.js) is a reference example wiring
`UDPDiscovery` into an HTTP(S) + WebSocket server — **an example, not a
production service** (no auth, no rate limiting), though the discovery
state below (the known-devices cache and the background auto-discovery
loop) is real/persistent, not a one-shot-per-request throwaway.

```bash
cd dist/nodejs
npm install    # pulls in the ws devDependency this example needs
npm run example:server
# or: HTTP_PORT=3000 HTTPS_PORT=3443 node examples/server.js
```

**`.env` file (optional)**: instead of passing `HTTP_PORT`/`HTTPS_PORT` on
the command line every time, copy `.env.example` to `.env` in whichever
directory you'll actually run the server *from* — `cp .env.example .env`
inside `dist/nodejs/` for the `cd dist/nodejs && npm run example:server`
workflow above (the build copies `.env.example` there for you), or the
repo root's own [`.env.example`](../../.env.example) if you use `npm run
start:server` there instead (see the root
[README.md](../../README.md#build)). `examples/loadEnv.ts` loads it
automatically before the server reads any port config; real env vars
already set in your shell always win over `.env`'s values. `.env` is
gitignored and, since `dist/nodejs/.env` lives inside `dist/`, does
**not** survive `npm run clean` — that's expected, `dist/` is pure build
output (see the root [CLAUDE.md](../../CLAUDE.md)); keep a copy of your
`.env` outside `dist/` if you rely on it, or place it at the repo root
instead so `npm run build`/`clean` never touches it.

Serves both HTTP (`:8080` by default, or `HTTP_PORT`/`PORT`) and HTTPS
(`:8443` by default, or `HTTPS_PORT`) on the same routes — HTTPS uses a
self-signed dev certificate, auto-generated via `openssl` into `certs/`
next to this package on first run (falls back to HTTP-only if `openssl`
isn't on `PATH`). Browsers will show a one-time "not private" warning for
the self-signed cert — that's expected for local dev.

Then open **http://localhost:8080/** (or **https://localhost:8443/**) in
a browser — that's the same `window.html`/`window.ts` discovery UI the
Chrome extension uses (see the parent repo's
[`docs/architecture.md`](../../docs/architecture.md)), with a "Start
Discovery" button, a results table, and a "Run discovery automatically"
toggle that starts/stops the background loop below.

| | |
| --- | --- |
| `GET /` | The shared discovery UI above. |
| `GET /window.js`, `/css/*.css`, `/scripts/*.js`, `/external-lib/**` | Static assets the UI references. |
| `GET /discover[?timeout=5000]` | Runs one independent discovery round, responds once it completes (or times out) with every device found. |
| `WS /discover` | On connect: replays every cached known device, then runs one immediate round (mirrors clicking "Start Discovery"). Stays open afterward, streaming whatever the background loop finds next — closes only when the client disconnects. |
| `GET /settings` | `{"autoDiscoveryEnabled": true\|false}` |
| `POST /settings` | Body `{"autoDiscoveryEnabled": true\|false}` — starts/stops the background auto-discovery loop (a scan every 30s while enabled). |

```bash
curl 'http://localhost:8080/discover?timeout=3000'
# {"devices":[{"chIP":"192.168.1.64","chMac":"00:09:18:..","url":"http://192.168.1.64:80",...}]}
```

```javascript
// WebSocket: listening → sent → device (one per camera found) → done → (stays open)
const ws = new (require('ws'))('ws://localhost:8080/discover');
ws.on('message', (data) => console.log(JSON.parse(data)));
```

`ws` is a `devDependency` of this package specifically for this example —
consumers who only `require('./udpDiscovery')` (or `require('./index')`)
never need it.

## Camera Object Fields

| Field | Type | Description |
|---|---|---|
| `chIP` | string | IP address |
| `chMac` | string | MAC address |
| `chDeviceName` | string | Device name (short) |
| `chDeviceNameNew` | string | Device name (full, if available) |
| `nHttpPort` | number | HTTP port |
| `nHttpsPort` | number | HTTPS port |
| `nTcpPort` | number | RTSP/TCP port |
| `httpType` | number | 0=HTTP, 1=HTTPS |
| `modelType` | number | Device model ID |
| `isSupportSunapi` | number | SUNAPI support flag |
| `url` | string | Convenience HTTP/HTTPS URL |
| `rtspUrl` | string | RTSP stream URL (profile1) |
| `DDNSURL` | string | DDNS hostname |
| `version` | number | Firmware version |

## Request/Response classes

`../sunapi/request.js` and `../sunapi/response.js` implement the vendor's own
**SUNAPI IP Installer** protocol spec directly — §3.2 "SendData Format for
SUNAPI" and §3.3 "RecvData Format for SUNAPI"
(`http://55.101.56.209:8080/site/SUNAPI/SUNAPI_ipinstaller.html`), plus
Annex A's two 1-byte `reserved2`/`reserved3` fields that §3.2/§3.3's own
field tables omit (see `request.js`'s `FIELDS` comment for how that gap was
found) — as a single 334-byte `DATAPACKET_V4_EXT` struct, shared by both
files so their field layout can't drift apart. They live in `../sunapi/`
rather than here so that `native-host/wisenet-udp-host.js` in the parent
Chrome extension repo can use the same wire-format implementation without
depending on this package's own internal layout (see `../sunapi/README.md`)
— that host parses replies with `response.js` too, so the extension no
longer has to.

In `src/nodejs/` (source), `sunapi/` is a sibling at `../sunapi/` — see
above. In `dist/nodejs/` (built, what you actually run), `sunapi/` is
nested one level shallower at `./sunapi/` instead, since the built
package has to carry its own self-contained copy (`npm run build`
rewrites this path automatically; see the root
[README.md](../README.md#build)):

```javascript
// from dist/nodejs/ (built) — require('./sunapi/request'), not '../sunapi/request'
const { UdpRequest }  = require('./sunapi/request');
const { UdpResponse } = require('./sunapi/response');

// §3.4.1 "Request" — nMode = DEF_REQ_SCAN_EXT (6), a fresh chPacketID
// (MAC + random, per §3.2's own field description), everything else
// left at its documented "Unused" value (zero-filled).
const request = new UdpRequest({ nMode: UdpRequest.NMODE.DEF_REQ_SCAN_EXT });
const hex     = request.toBuffer().toString('hex'); // plain hex, no "0x" prefix
const packet  = Buffer.from(hex, 'hex');             // 334 bytes
socket.send(packet, 0, packet.length, port, addr);

// §3.4.2 "Response" — nMode = DEF_RES_SCAN_EXT (12) confirms the device
// replied to a SCAN_EXT request with the extended field block present.
socket.on('message', (msg, rinfo) => {
  const response = UdpResponse.parse(msg, rinfo);
  if (response && response.nMode === UdpResponse.NMODE.DEF_RES_SCAN_EXT) {
    console.log('confirmed extended scan response from', response.chIP);
  }
});
```

`udpDiscovery.js` wires this in directly:

- `_sendDiscovery()` builds and sends a `UdpRequest({ nMode: NMODE.DEF_REQ_SCAN_EXT })`
  (opcode `6`) instead of the old hardcoded `DISCOVERY_PACKET` constant — that
  constant (nMode=`1`, an undocumented/legacy opcode captured from the
  original Chrome extension) is kept in the file, commented out, as the
  fallback to restore if `nMode=6` ever proves unusable against some device
  on a given network (a prior side-by-side test found `nMode=6` draws
  replies from a much broader, largely unrelated portion of the network —
  see `docs/design/Design_Camera_Discovery.md` §3.1c/§3.1e in the parent
  project for the full history of that investigation).
- The socket's `'message'` handler independently confirms the round-trip via
  `UdpResponse.parse()`, emitting `'scanExtConfirmed'` whenever a genuine
  `nMode=12` (`DEF_RES_SCAN_EXT`) response comes back — a verification signal
  only; the existing `'device'` event (backed by `_parseResponse()`) is still
  what actually drives discovery results.

Any field in `UdpRequest`'s constructor can be overridden, e.g.
`new UdpRequest({ nMode: 1 })` to reproduce the historical opcode exactly.
