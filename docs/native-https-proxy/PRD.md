# PRD — Native-Host HTTPS Proxy for Untrusted Camera Certificates

| | |
|---|---|
| Status | Implemented |
| Component | Chrome extension (`dist/chrome-extension/`) only |
| Related docs | [MRD](MRD.md) · [SRS](SRS.md) · [DESIGN](DESIGN.md) · [TC](TC.md) · [../architecture.md](../architecture.md) |

## Problem

Wisenet cameras/NVRs commonly serve their web/SUNAPI management interface, and their video
streaming endpoint, over HTTPS/WSS with a self-signed certificate. When `window.html` (this
extension's UI) tries to reach one, Chrome blocks the request at the browser level —
`net::ERR_CERT_AUTHORITY_INVALID` for SUNAPI's HTTPS REST calls, and an opaque failed `wss://`
WebSocket connection for the video stream — before any extension code, or the vendored
`@melchi45/rtsp-over-websocket` player, ever sees it. The practical symptom: the "Use SUNAPI"
checkbox in the Device panel never turns on, `Play` stays unusable, and the popup shows an
uninformative `Error Code: 0x0000` (the request never produced a real HTTP response for the SUNAPI
client to interpret) — and even once SUNAPI succeeds, `Play` still fails separately because the
streaming `wss://` connection hits the same TLS wall.

The existing, safe workaround — open `https://<camera-ip>/` in a normal browser tab once and
click through "Advanced → Proceed" to register a per-host certificate exception — fixes SUNAPI's
HTTPS calls, but does **not** reliably extend to the `wss://` streaming connection in practice
(confirmed against a real device: registering that exception did not make `wss://` start working),
so it doesn't fully solve the problem on its own even before considering it's a manual,
per-device, per-machine step that doesn't scale for someone provisioning many cameras.

## Goals

- Let the extension complete SUNAPI requests **and** the video streaming connection against a
  camera/NVR with a self-signed HTTPS certificate, without requiring the manual browser
  click-through first (and without depending on that workaround actually covering `wss://`, which
  it doesn't reliably do).
- Keep this **strictly opt-in**: the default behavior (real browser TLS validation) is unchanged
  unless the user explicitly enables it for the device they're configuring.
- Keep the blast radius of "ignore TLS errors" as small as possible — usable only against the
  camera/NVR the user is actively configuring on their LAN, not as a general capability.

## Non-Goals

- This is **not** a general-purpose "fetch any URL while ignoring TLS errors" feature. See
  [SRS.md](SRS.md)'s IP-literal restriction.
- Not available on the nodejs example target (`dist/nodejs/`) — that target has no native
  messaging host to do the request on the extension's behalf. Out of scope for this change; the
  manual browser-exception workaround remains the only option there.
- Not a replacement for installing a trusted certificate on the camera — still the right answer
  for a production deployment; this is for LAN installer/admin workflows where that isn't
  practical.

## Users

Installers/administrators configuring Wisenet cameras/NVRs on a local network, using the Chrome
extension's manual UI (`window.html`), who hit `ERR_CERT_AUTHORITY_INVALID` on a device with a
factory self-signed certificate and don't want to click through a browser warning per device.

## User Story

> As an installer configuring a camera with its factory-default self-signed certificate, I want
> to check a box in the extension and have SUNAPI setup work immediately, instead of first opening
> a separate browser tab to accept a certificate warning for that camera's IP.

## Success Criteria

- With the new checkbox enabled, `initSunapiManager()`'s full chain (attributes → video source →
  video profile policy → video profile → timezone → date info) completes against a self-signed
  HTTPS device the same way it already does against an HTTP or trusted-HTTPS device.
- With the checkbox enabled, `Play` also succeeds over `wss://` against that same self-signed
  device — SUNAPI succeeding is not, on its own, sufficient; the streaming connection is a
  separate TLS handshake with its own pass/fail.
- With the checkbox left unchecked (the default), behavior is byte-for-byte unchanged from before
  this feature existed — for both SUNAPI and streaming.
- The capability is not reachable from outside this extension's own `window.html` UI (see
  [SRS.md](SRS.md)'s non-functional requirements).
