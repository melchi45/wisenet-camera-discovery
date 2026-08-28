# SRS — Native-Host HTTPS Proxy for Untrusted Camera Certificates

| | |
|---|---|
| Title | Native-Host HTTPS Proxy for Untrusted Camera Certificates — Software Requirements Specification (SRS) |
| Abstract | Functional/non-functional requirements, the `httpRequest`/`wsOpen` native messaging protocol, and the `SunapiClientLike`/`WebSocketLike` interface contracts. |
| Status | Implemented |
| Author | Youngho Kim |
| Milestone | v1.0.2 |
| Related docs | [PRD](PRD.md) · [MRD](MRD.md) · [DESIGN](DESIGN.md) · [TC](TC.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-26 | Youngho Kim | Initial SRS for the native-host HTTPS proxy feature. |
| 1.1 | 2026-08-28 | Youngho Kim | Added Title/Abstract/Author/Milestone/History metadata. |

## Functional requirements

- **FR-1**: `window.html` provides a checkbox, `use_native_tls_proxy_checkbox` ("Bypass Untrusted
  Certificate (Native Host)"), in the Device panel. Unchecked by default.
- **FR-2**: The checkbox and its containing field (`native_tls_proxy_field`) are hidden when
  `IS_EXTENSION` is false (the nodejs example target) — see
  [`../architecture.md`](../architecture.md) for that flag.
- **FR-3**: When the checkbox is checked at the time `initSunapiManager()` runs
  (`src/shared/window.ts`), every SUNAPI HTTP(S) request for that session — the initial
  `/stw-cgi/attributes.cgi` call and everything `SunapiManager`'s own methods
  (`getVideoSource()`, `getVideoProfilePolicyAll()`, `getTimezoneInfo()`, `getDateInfo()`, etc.)
  issue afterward — is sent through the native messaging host
  (`src/chrome-extension/native-host/wisenet-udp-host.ts`) rather than a browser
  `XMLHttpRequest`.
- **FR-4**: When the checkbox is unchecked, behavior is unchanged from before this feature:
  `SunapiManager.init(device)` runs as it always did, using the vendored library's own
  browser-XHR client.
- **FR-5**: The native host performs the HTTP Digest authentication challenge/response round
  (RFC 7616) itself when a request receives a `401` with a `WWW-Authenticate: Digest` challenge,
  using the `username`/`password` supplied in the request message, and returns a single final
  response to the extension — the extension does not see the intermediate `401`.
- **FR-6**: The native host **rejects** (does not attempt) any `httpRequest` whose URL's hostname
  is not a literal RFC1918/loopback/link-local IP address — see NFR-2.
- **FR-7**: Selecting a device from the discovery table defaults the checkbox to the discovered
  device's own protocol: checked when the discovered `Protocol` is `"https"`, unchecked for
  `"http"` — a discovered HTTPS SUNAPI device is likely running its factory self-signed
  certificate (see [PRD.md](PRD.md)), so this saves the most common case from being opt-in-by-hand
  every time. Still fully user-overridable; selecting a different row re-evaluates it from that
  row's own protocol rather than leaving a stale value from the previous selection.

## Message protocol

Extension → host (new command, alongside the existing `start`/`broadcast`/`stop` — see
[`../../src/chrome-extension/native-host/README.md`](../../src/chrome-extension/native-host/README.md)):

```json
{
  "command": "httpRequest",
  "requestId": "string, required — caller-generated, echoed back verbatim",
  "method": "GET | POST",
  "url": "string, required — full URL, e.g. https://192.168.1.100:443/stw-cgi/attributes.cgi",
  "headers": { "Accept": "application/json" },
  "body": "string, optional — request body for POST",
  "username": "string, optional — used only if the device challenges with 401 Digest",
  "password": "string, optional"
}
```

Host → extension:

```json
{ "type": "httpResponse", "requestId": "...", "status": 200, "statusText": "OK", "headers": {}, "body": "..." }
```
```json
{ "type": "httpError", "requestId": "...", "message": "..." }
```

`requestId` is how `src/shared/scripts/nativeSunapiClient.ts` matches an async response back to
the `successFn`/`failFn` pair it was issued with — the host does not otherwise track per-request
state across calls beyond the single 401→retry round in FR-5.

## WebSocket relay protocol (streaming)

The SUNAPI REST proxy above does not cover the actual video streaming connection —
`<rtsp-over-websocket>` opens its own `wss://<camera>/StreamingServer` browser WebSocket directly,
independently subject to the same TLS certificate validation (confirmed against a real device:
`ws://` succeeds, `wss://` fails with the checkbox off, and does **not** start working just because
a manual browser certificate exception was registered for the same host — see [DESIGN.md](DESIGN.md)
for why that manual workaround doesn't reliably cover a WebSocket handshake the way it covers a
page navigation). This section covers `wsOpen`/`wsSend`/`wsClose`, the streaming counterpart to
`httpRequest` above.

- **FR-8**: When the checkbox is checked, `initSunapiManager()` also sets the selected player
  element's `transportFactory` property to a factory that routes the streaming WebSocket through
  the native host; when unchecked, it's cleared (`undefined`), restoring the vendored library's
  own default (`new WebSocket(serverAddr)`).
- **FR-9**: The native host performs the real `wss://`/`ws://` connection itself
  (`rejectUnauthorized: false` for `wss:`, via the `ws` npm package), relaying binary frames both
  directions over native messaging, base64-encoded (native messaging is a JSON-only protocol).
- **FR-10**: Same IP-literal safety rail as `httpRequest` (NFR-2) — `wsOpen` is rejected outright
  for any non-private/loopback/link-local hostname.

Extension → host:

```json
{ "command": "wsOpen", "connectionId": "string, required", "url": "wss://192.168.1.100/StreamingServer" }
{ "command": "wsSend", "connectionId": "...", "data": "string, required — base64-encoded binary frame" }
{ "command": "wsClose", "connectionId": "..." }
```

Host → extension:

```json
{ "type": "wsOpen", "connectionId": "..." }
{ "type": "wsMessage", "connectionId": "...", "data": "string — base64-encoded binary frame" }
{ "type": "wsError", "connectionId": "...", "message": "..." }
{ "type": "wsClose", "connectionId": "...", "code": 1000, "reason": "..." }
```

Unlike `requestId` (one-shot, matched once), `connectionId` identifies a **persistent** connection:
one `wsOpen` is followed by any number of `wsSend`/`wsMessage` frames in either direction until a
`wsClose` from either side (or the native host process exits, e.g. the extension's own port
disconnects — see `wisenet-udp-host.ts`'s `process.stdin.on('end', ...)` cleanup, which terminates
every open `ws` connection along with stopping discovery).

### `NativeTransport`/`NativeWebSocketLike` (`src/shared/scripts/nativeWebSocketTransport.ts`)

`NativeWebSocketLike` implements the vendored package's `WebSocketLike` interface
(`readyState`, `binaryType`, `onopen`/`onmessage`/`onclose`/`onerror`, `send(data)`, `close()`) —
confirmed against `Transport.ts`'s own real implementation, which only ever sends binary data
(`Uint8Array`) and expects `onmessage` to deliver `{data: ArrayBuffer}`; no text-frame handling is
needed. `NativeTransport extends Transport` (the real vendored class, referenced via the ambient
`Transport` global — see `legacy-globals-bridge.js` — rather than a real ES import, for the same
CSP/Worker-asset re-inlining reason `nativeSunapiClient.ts` never imports the vendored package as
a value either) and overrides only the `protected createWebSocket()` factory method the vendored
class's own doc comment already calls out as *"Overridable factory so tests can inject a fake
socket."* Every other `Transport` method (RTSP/RTP interleaved-frame demultiplexing, etc.) is
inherited unchanged.

## Interfaces

`nativeSunapiClient.ts`'s `NativeSunapiClient` class implements the same minimal
`SunapiClientLike` surface the vendored `@melchi45/rtsp-over-websocket` package's own
`SunapiManager.attach()` accepts (confirmed against that package's shipped
`dist/types/network/http/SunapiManager.d.ts`):

```ts
interface SunapiClientLike {
  get(uri, jsonData, successFn, failFn, scope, isAsyncCall?, isText?, withoutSeqId?): void;
  post?(...args): void;
  setTimeout(timeout: number): void;
  getAuthInfo(): unknown;
}
```

**Failure shape contract**: on failure, `successFn`/`failFn` must be invoked exactly the way the
vendored library's own client invokes them, so `window.ts`'s existing `error instanceof
SunapiError` / `error instanceof RTSPOverWebSocketBaseError` branches (its big `.catch()` in
`initSunapiManager()`) keep working unmodified regardless of which client ran:

- Every call *after* the first (`getVideoSource()`, etc., driven by `SunapiManager`'s own private
  `request()` method) must reject with a **plain `{Code: number, message?: string}` object** —
  confirmed against the vendored library's own XHR client, which does exactly this
  (`o({ Code: c.status, message: Zi[String(c.status)] })` in its minified `send()`), not a
  `SunapiError` instance.
- The *first* call (replicated from `SunapiManager.init()`, since `init()` cannot be bypassed via
  `attach()` — see [DESIGN.md](DESIGN.md)) must reject with a real `SunapiError` instance, matching
  `init()`'s own `new ms({errorCode, place, message})` wrapping.
- A `200` response with an empty body is a failure (`{Code: -1, message: "No response"}`), matching
  the vendored client's own behavior — not a special case invented for this feature.

## Non-functional requirements

- **NFR-1 (default path unaffected)**: no change to the request path when the checkbox is
  unchecked — `SunapiManager.init()`/`request()` and the browser XHR client are untouched.
- **NFR-2 (no general TLS-bypass primitive)**: the native host must refuse to proxy to any
  hostname that is not a literal IP address in a private/loopback/link-local range (10.0.0.0/8,
  172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.0.0/16, `::1`, `fe80::/10`, `fc00::/7`). A
  plain hostname or a public IP is rejected before any request is attempted.
- **NFR-3 (not externally reachable)**: the `httpRequest` command must only be reachable from
  `window.ts`'s own dedicated `chrome.runtime.connectNative()` port. It must **not** be wired into
  `background.ts`'s `chrome.runtime.onMessage`/`onMessageExternal` handlers, which currently accept
  messages from other extensions/pages — this capability must not be triggerable from outside this
  extension's own UI.
- **NFR-4 (no re-registration)**: reuses the existing native host binary and
  `com.wisenet.ipinstaller` registration — no new install step, no manifest/registry change,
  for users who already have the native host installed for discovery.
- **NFR-5 (independent connection lifecycle)**: `nativeSunapiClient.ts` opens its own native
  messaging port, separate from `background.ts`'s long-lived discovery port
  (`socket.hostPort`) — closing/reopening it must not affect discovery, and vice versa.

## Constraints / known limitations

- Timeouts are fixed constants, not yet configurable per call: the native host aborts an
  HTTP(S) round trip after `HTTP_REQUEST_TIMEOUT_MS` (15s — `wisenet-udp-host.ts`), and
  `NativeSunapiClient` independently gives up on a request after `REQUEST_TIMEOUT_MS` (20s —
  `nativeSunapiClient.ts`) in case the host itself is unresponsive or the native-messaging port
  is silently dropped. `SunapiClientLike.setTimeout()` remains a no-op for interface parity; a
  future revision could wire it (and/or a `timeoutMs` field on the `httpRequest` message) to make
  these configurable if 15–20s proves wrong for some deployment.
- Without these, a black-holed connection (wrong port, a firewall silently dropping packets, a
  wedged host process) previously left `initSunapiManager()`'s promise chain pending forever —
  no console output, no popup, indistinguishable from the checkbox simply doing nothing. Found
  during real-device testing; see `MEMORY.md`'s entry on this feature.
- Digest algorithm support matches what Node's `crypto` module provides out of the box (MD5,
  SHA-256) — sufficient for RFC 7616 `algorithm=MD5`/`SHA-256`, the values SUNAPI devices use.
- The streaming relay applies the same "always add a client-side timeout" lesson from the HTTP
  proxy up front rather than rediscovering it: `wisenet-udp-host.ts`'s `WS_CONNECT_TIMEOUT_MS`
  (15s) aborts a `wsOpen` that never reaches the real device, and
  `nativeWebSocketTransport.ts`'s own `WS_CONNECT_TIMEOUT_MS` (15s) independently gives up if the
  native host itself never responds. Once open, there is no per-frame/idle timeout — a live stream
  is expected to keep sending frames continuously; a stalled-but-still-open connection is expected
  to eventually surface as a player-level error through the vendored library's own RTSP-level
  keepalive/timeout handling, not this transport layer.
- Binary frames are base64-encoded end-to-end (both `httpRequest` bodies, which are text, and now
  `wsSend`/`wsMessage`, which are binary RTP/RTSP data) — acceptable overhead (~33%) for SUNAPI
  REST calls and typical camera stream bitrates; not evaluated against very high bitrate/high
  channel-count scenarios.
