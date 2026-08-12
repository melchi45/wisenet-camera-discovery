'use strict';

const {
  FIELDS, PACKET_SIZE, STRING_FIELDS, UINT16_BE_FIELDS, NMODE, NON_SCAN_RESPONSE_MODES,
  NVERSION, hasVersionFlag, NETWORK_MODE, DEVICE_TYPE,
  HTTP_MODE, SUPPORTED_PROTOCOL, hasSupportedProtocol, PASSWORD_STATUS,
} = require('./protocol');

// SUNAPI IP Installer spec §3.3 "RecvData Format for SUNAPI" —
// http://55.101.56.209:8080/site/SUNAPI/SUNAPI_ipinstaller.html#_recvdata_format_for_sunapi
// Same 334-byte `DATAPACKET_V4_EXT` struct as request.js's §3.2 "SendData
// Format" (field layout lives in protocol.js, shared by both files so they
// can't silently drift apart — see that file's `FIELDS` comment for the
// Annex A `reserved2`/`reserved3` gap this struct already accounts for).
// Two response-only details this parser handles that the request builder
// doesn't need to:
//  1. The tail block (chAlias..nPasswordStatus) is only actually present on
//     the wire when the response's own nMode says so (nMode=12,
//     DEF_RES_SCAN_EXT — see §3.4.2 "Response" and Table 1); every other
//     documented response nMode is a different exchange entirely (RSA key
//     exchange §3.5, password-apply §3.6/§3.7) with its own incompatible
//     struct.
//  2. chAlias is documented "Alias name for NVR or Encoder only" — "Network
//     camera does not include this field in response packet." A genuine
//     camera's tail block (when nMode=12) simply reads back as an
//     empty/zero-filled chAlias; this needs no special-case, just the
//     normal null-terminated-string decode already used for every other
//     char[] field.

// Index into FIELDS where the always-present base block ends and the
// conditionally-present tail block begins (right after chDDNS).
const EXTENDED_START  = FIELDS.findIndex(([name]) => name === 'chAlias');
const BASE_FIELDS     = FIELDS.slice(0, EXTENDED_START);
const EXTENDED_FIELDS = FIELDS.slice(EXTENDED_START);

// NMODE/NON_SCAN_RESPONSE_MODES are protocol.js's (imported above) — this
// file only ever reads the DEF_RES_* keys, but the full request+response
// enum is the shared one, not a response-only subset redefined here.

// Truncate at the first null byte (C-style null-terminated fixed-length
// field), then decode — prevents trailing garbage bytes from becoming junk
// characters in e.g. chDeviceName/chDDNS.
function decodeString(buf, offset, size) {
  const raw = buf.subarray(offset, offset + size);
  let end = 0;
  while (end < raw.length && raw[end] !== 0) end++;
  return Buffer.from(raw.subarray(0, end)).toString('utf8').trim();
}

function decodeUInt8(buf, offset) {
  return offset < buf.length ? buf.readUInt8(offset) : 0;
}

function decodeUInt16(buf, offset, bigEndian) {
  if (offset + 2 > buf.length) return 0;
  return bigEndian ? buf.readUInt16BE(offset) : buf.readUInt16LE(offset);
}

function decodeField(name, size, buf, offset) {
  if (STRING_FIELDS.has(name)) return decodeString(buf, offset, size);
  if (size === 1) return decodeUInt8(buf, offset);
  if (size === 2) return decodeUInt16(buf, offset, UINT16_BE_FIELDS.has(name));
  return undefined;
}

/**
 * SUNAPI IP Installer §3.3 "RecvData Format for SUNAPI" response packet —
 * the same `DATAPACKET_V4_EXT` struct request.js builds, decoded back into
 * named fields. Construct via `UdpResponse.parse()`, not `new` directly.
 */
class UdpResponse {
  [key: string]: any;

  static FIELDS: typeof FIELDS;
  static BASE_FIELDS: typeof BASE_FIELDS;
  static EXTENDED_FIELDS: typeof EXTENDED_FIELDS;
  static PACKET_SIZE: typeof PACKET_SIZE;
  static NMODE: typeof NMODE;
  static NON_SCAN_RESPONSE_MODES: typeof NON_SCAN_RESPONSE_MODES;
  static NVERSION: typeof NVERSION;
  static NETWORK_MODE: typeof NETWORK_MODE;
  static DEVICE_TYPE: typeof DEVICE_TYPE;
  static HTTP_MODE: typeof HTTP_MODE;
  static SUPPORTED_PROTOCOL: typeof SUPPORTED_PROTOCOL;
  static PASSWORD_STATUS: typeof PASSWORD_STATUS;

  constructor(fields: Record<string, any>, rinfo: any) {
    for (const [name] of FIELDS) this[name] = fields[name];
    this.rinfo = rinfo;
  }

  /** True when this response's nMode carries the tail field block. */
  get isExtended() {
    return this.nMode === NMODE.DEF_RES_SCAN_EXT;
  }

  /**
   * §3.4.2 "Response" documents `nMulticastPort`'s slot as carrying
   * "max channel number" instead when the response is an extended scan
   * reply (`nMode=12`, `DEF_RES_SCAN_EXT`) — the same base field, read as
   * MaxChannel instead of a port number. `undefined` on any other `nMode`
   * (the field still decodes as `nMulticastPort`, just not reinterpreted).
   */
  get MaxChannel() {
    return this.nMode === NMODE.DEF_RES_SCAN_EXT ? this.nMulticastPort : undefined;
  }

  /**
   * True if this response's `nVersion` bitmask (§3.4.2, only meaningful
   * when `isExtended`) has `flag` set — pass one of `NVERSION`'s values,
   * e.g. `response.hasVersionFlag(UdpResponse.NVERSION.SUPPORT_NEW_MODEL_NAME)`.
   */
  hasVersionFlag(flag) {
    return hasVersionFlag(this.nVersion, flag);
  }

  /**
   * True if this response's `nSupportedProtocol` bitmask (§3.4.2, only
   * meaningful when `isExtended`) has `flag` set — pass one of
   * `SUPPORTED_PROTOCOL`'s values, e.g.
   * `response.hasSupportedProtocol(UdpResponse.SUPPORTED_PROTOCOL.SUNAPI_2_0)`.
   */
  hasSupportedProtocol(flag) {
    return hasSupportedProtocol(this.nSupportedProtocol, flag);
  }

  /**
   * Renames this response's §3.3 fields (and derives a couple of
   * convenience fields) to the shape the WiseNetChromeIPInstaller Chrome
   * extension expects — `chMac` not `chMAC`, `DDNSURL` not `chDDNS`,
   * `modelType` not `nModelType`, etc. Single source of truth for that
   * mapping: previously duplicated between this project's own
   * udpDiscovery.js `_parseResponse()` (now just calls this) and the
   * extension's scripts/socket.js, which used to re-derive the same
   * fields itself via a 150-line hand-rolled byte parser instead of this
   * class. native-host/wisenet-udp-host.js (in that extension's repo)
   * calls this directly so the extension no longer needs to parse
   * anything at all — see its README for the resulting protocol.
   */
  toLegacyDeviceObject() {
    const result: any = {
      nMode: this.nMode,
      chPacketId: this.chPacketID,
      chMac: this.chMAC,
      chIP: this.chIP,
      chSubnetMask: this.chSubnetMask,
      chGateway: this.chGateway,
      chPassword: this.chPassword,
      isSupportSunapi: this.is_only_support_sunapi,
      nPort: this.nPort,
      nStatus: this.nStatus,
      chDeviceName: this.chDeviceName,
      nHttpPort: this.nHttpPort,
      nDevicePort: this.nDevicePort,
      nTcpPort: this.nTcpPort,
      nUdpPort: this.nUdpPort,
      nUploadPort: this.nUploadPort,
      nMulticastPort: this.nMulticastPort,
      // Only meaningful on an extended scan reply (nMode=12) — see the
      // `MaxChannel` getter above (§3.4.2's nMulticastPort/MaxChannel
      // slot reinterpretation).
      nMaxChannel: this.MaxChannel,
      nNetworkMode: this.nNetworkMode,
      DDNSURL: this.chDDNS,
      alias: this.chAlias,
      chDeviceNameNew: this.chNewModelName,
      modelType: this.nModelType,
      version: this.nVersion,
      httpType: this.nHttpMode,
      nHttpsPort: this.nHttpsPort,
      supportedProtocol: this.nSupportedProtocol,
      noPassword: this.nPasswordStatus,
    };

    // Convenience URL
    if (typeof result.httpType !== 'undefined') {
      const scheme = result.httpType === 0 ? 'http' : 'https';
      const port   = result.httpType === 0 ? result.nHttpPort : result.nHttpsPort;
      result.url   = `${scheme}://${result.chIP}:${port}`;
    } else {
      result.url = `http://${result.chIP}:${result.nHttpPort || 80}`;
    }

    // RTSP URL (default port + path guess) — see request.js's sibling
    // comment on nTcpPort for why that field is NOT the RTSP port.
    result.rtspUrl = `rtsp://${result.chIP}:554/0/H.264/media.smp`;

    return result;
  }

  /**
   * Parses a raw UDP response buffer per §3.3. Returns `null` for any
   * nMode belonging to a different exchange (NON_SCAN_RESPONSE_MODES).
   * Otherwise returns a `UdpResponse`: the base fields (nMode..chDDNS)
   * are decoded unconditionally (real devices on this network reply with a
   * packet just long enough for these — no bounds gate needed beyond the
   * decode helpers' own built-in "0 if out of range" safety); the tail
   * fields (chAlias..nPasswordStatus) are decoded only when nMode says the
   * block is genuinely present (`DEF_RES_SCAN_EXT = 12`) **and** enough
   * bytes remain for each field in sequence — once one field doesn't fit,
   * every field after it is left `undefined` too, rather than inferred from
   * one blanket length check (a packet can be numerically "long enough"
   * while still having far too few trailing bytes for the whole block).
   */
  static parse(buf, rinfo) {
    if (!buf || buf.length < 1) return null;
    const nMode = buf.readUInt8(0);
    if (NON_SCAN_RESPONSE_MODES.has(nMode)) return null;

    const fields = {};
    let offset = 0;
    for (const [name, size] of BASE_FIELDS) {
      fields[name] = decodeField(name, size, buf, offset);
      offset += size;
    }

    let extendedOk = nMode === NMODE.DEF_RES_SCAN_EXT;
    for (const [name, size] of EXTENDED_FIELDS) {
      if (!extendedOk || offset + size > buf.length) {
        extendedOk = false;
        fields[name] = undefined;
        continue;
      }
      fields[name] = decodeField(name, size, buf, offset);
      offset += size;
    }

    // Logging is the caller's responsibility, not this parser's — every raw
    // UDP broadcast reply used to get an unconditional console.log() here,
    // which meant one line per packet per device per scan cycle regardless
    // of whether anything about the device actually changed (confirmed live:
    // 10+ log lines/sec with just a handful of cameras on the subnet). The
    // application layer (discoveryService.js's DiscoveryService._upsert())
    // now decides when a device is actually new or changed and logs only
    // then — toString() stays available for that.
    return new UdpResponse(fields, rinfo);
  }

  /** Plain-object snapshot of every §3.3 field (`undefined` where absent). */
  toObject() {
    const obj = {};
    for (const [name] of FIELDS) obj[name] = this[name];
    return obj;
  }

  /** Human-readable one-line summary of every §3.3 field, for logging. */
  toString() {
    const from = this.rinfo && this.rinfo.address ? ` from ${this.rinfo.address}` : '';
    const fieldStr = FIELDS
      .map(([name]) => `${name}=${JSON.stringify(this[name])}`)
      .join(', ');
    return `UdpResponse${from} { ${fieldStr} }`;
  }
}

UdpResponse.FIELDS                 = FIELDS;
UdpResponse.BASE_FIELDS            = BASE_FIELDS;
UdpResponse.EXTENDED_FIELDS        = EXTENDED_FIELDS;
UdpResponse.PACKET_SIZE            = PACKET_SIZE;
UdpResponse.NMODE                  = NMODE;
UdpResponse.NON_SCAN_RESPONSE_MODES = NON_SCAN_RESPONSE_MODES;
UdpResponse.NVERSION               = NVERSION;
UdpResponse.NETWORK_MODE            = NETWORK_MODE;
UdpResponse.DEVICE_TYPE             = DEVICE_TYPE;
UdpResponse.HTTP_MODE               = HTTP_MODE;
UdpResponse.SUPPORTED_PROTOCOL      = SUPPORTED_PROTOCOL;
UdpResponse.PASSWORD_STATUS         = PASSWORD_STATUS;

module.exports = {
  UdpResponse, NMODE, NON_SCAN_RESPONSE_MODES, PACKET_SIZE, FIELDS,
  NVERSION, hasVersionFlag, NETWORK_MODE, DEVICE_TYPE,
  HTTP_MODE, SUPPORTED_PROTOCOL, hasSupportedProtocol, PASSWORD_STATUS,
};
