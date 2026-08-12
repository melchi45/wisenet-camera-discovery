# SUNAPI IP Installer wire format

Shared implementation of the vendor's **SUNAPI IP Installer** UDP discovery
protocol — request building, response parsing, and the protocol constants
both need. This is plain Node.js (`Buffer`), with no other dependency on
anything else in this repo.

- `protocol.js` — port numbers, the 334-byte `DATAPACKET_V4_EXT` field
  layout (`FIELDS`), and every enum (`NMODE`, `NVERSION`, `DEVICE_TYPE`,
  etc.) from spec §3.1–§3.7 and Annex A. Single source of truth for the
  wire format — `request.js` and `response.js` both build on it instead of
  keeping their own copies.
- `request.js` — `UdpRequest`, builds a discovery request packet.
- `response.js` — `UdpResponse`, parses a reply packet.
  `UdpResponse.prototype.toLegacyDeviceObject()` renames the raw §3.3
  field names to the shape this project's Chrome extension and Node.js
  consumers both expect (`chMac` not `chMAC`, `DDNSURL` not `chDDNS`, ...).

## Why this isn't inside nodejs/ or native-host/

Two things in this repo need this wire-format code, and neither should own
it:

- **`nodejs/`** is a standalone, independently-versioned npm package (see
  its own `package.json`, name `wisenet-udp-discovery`) meant for reuse
  outside this repo entirely — see `nodejs/README.md`.
- **`native-host/wisenet-udp-host.js`** is this repo's own Chrome
  extension's native messaging host — see `../native-host/README.md`. It
  parses every UDP reply itself (via `response.js`'s
  `toLegacyDeviceObject()`) and relays already-parsed device objects to
  the extension, which is why `scripts/socket.js` no longer parses
  anything by hand.

If `native-host/` had required `../nodejs/response.js` directly (an
earlier version of this did), it would depend on `nodejs/`'s internal
layout even though it isn't a consumer of that npm package at all — a
refactor or extraction of `nodejs/` could break it for no reason. Putting
the actually-shared code in this sibling directory instead means both
`nodejs/udpDiscovery.js` and `native-host/wisenet-udp-host.js` depend on
the same thing, without depending on *each other*.

**Caveat:** this does mean `nodejs/` is no longer fully self-contained —
if it's ever extracted or published as its own package independently of
this repository, `sunapi/` needs to go with it (or get vendored in at that
point). Nothing currently in this repo publishes `nodejs/` on its own; the
root `package.json`'s `files` list already includes both directories.

## Environment scope

Everything here uses Node's `Buffer` API (`readUInt8`, `writeUInt16LE`,
etc.) directly. That's fine for both current consumers — `nodejs/` and
`native-host/` are both plain Node.js processes. It is **not** loaded in
the browser/extension side at all; the extension receives already-parsed
device objects from the native host instead (see
`../native-host/README.md`'s Protocol section). If a future consumer ever
needs to parse a reply in a page/service-worker context with no `Buffer`,
the portable part of `response.js` (`decodeField`/`parse()`/
`toLegacyDeviceObject()`) would only need its two `Buffer`-specific reads
(`decodeUInt8`/`decodeUInt16`) swapped for a `DataView`-based equivalent —
everything else here has no Node-specific API in it.
