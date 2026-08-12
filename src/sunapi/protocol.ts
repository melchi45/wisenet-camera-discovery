'use strict';

// SUNAPI IP Installer spec — shared protocol constants for request.js,
// response.js, and udpDiscovery.js. Previously each file kept its own copy
// (request.js: request-side NMODE only; response.js: response-side NMODE +
// its own NON_SCAN_RESPONSE_MODES; udpDiscovery.js: both NMODE halves
// merged again, plus a third NON_SCAN_RESPONSE_MODES) — three driftable
// copies of the same vendor enum. One definition here instead.
// http://55.101.56.209:8080/site/SUNAPI/SUNAPI_ipinstaller.html

// §3.1 "Communicate Port"
const SEND_PORT      = 7701; // broadcast → cameras
const RECEIVE_PORT   = 7711; // cameras → us
const BROADCAST_ADDR = '255.255.255.255';

// §3.2 "SendData Format for SUNAPI" / §3.3 "RecvData Format for SUNAPI" —
// struct `DATAPACKET_V4_EXT`, 334 bytes. Field name/type/byte-size/order
// transcribed from those sections, **plus two 1-byte `reserved2`/
// `reserved3` fields §3.2/§3.3's own tables omit** — present in Annex A
// §5.1's authoritative `DATAPACKET_(EXT_)IPv4_T` C structs (`char
// reserved2;` right after `device_name`, `unsigned char reserved3;` right
// after `https_mode`) and already read (and discarded) by udpDiscovery.js's
// original `_parseResponse()`. Omitting them shifted every field from
// `nHttpPort` onward by one byte — caught by comparing `UdpResponse.parse()`
// against `_parseResponse()` on a real captured packet (nHttpPort/nTcpPort
// etc. came out as plausible-looking garbage, not the real device's actual
// ports). Same class of vendor-doc-vs-Annex-A gap the project already hit
// for `supported_protocol`/`no_password` (FR-CAM-083) — the §3.2/§3.3
// tables are a convenient summary, not the byte-exact source of truth;
// Annex A's C structs are.
const FIELDS: Array<[string, number]> = [
  ['nMode',                  1],
  ['chPacketID',             18],
  ['chMAC',                  18],
  ['chIP',                   16],
  ['chSubnetMask',           16],
  ['chGateway',              16],
  ['chPassword',             20],
  ['is_only_support_sunapi', 1],
  ['nPort',                  2],
  ['nStatus',                1],
  ['chDeviceName',           10],
  ['reserved2',              1],  // Annex A `DATAPACKET_IPv4_T.reserved2`
  ['nHttpPort',              2],
  ['nDevicePort',            2],
  ['nTcpPort',               2],
  ['nUdpPort',               2],
  ['nUploadPort',            2],
  ['nMulticastPort',         2],
  ['nNetworkMode',           1],
  ['chDDNS',                 128],
  ['chAlias',                32],
  ['chNewModelName',         32],
  ['nModelType',             1],
  ['nVersion',               2],
  ['nHttpMode',              1],
  ['reserved3',              1],  // Annex A `DATAPACKET_EXT_IPv4_T.reserved3`
  ['nHttpsPort',             2],
  ['nSupportedProtocol',     1],
  ['nPasswordStatus',        1],
];

// char[]/unsigned char[] fields are read/written as raw bytes (string or
// Buffer); the rest are fixed-width integers. Multi-byte integers are
// little-endian except `nVersion`, which is big-endian/network-order — see
// utils.js's `ntohs()` "big=true" comment for why that flag name is
// misleading.
const STRING_FIELDS = new Set([
  'chPacketID', 'chMAC', 'chIP', 'chSubnetMask', 'chGateway', 'chPassword',
  'chDeviceName', 'chDDNS', 'chAlias', 'chNewModelName',
]);
const UINT16_BE_FIELDS = new Set(['nVersion']);

const PACKET_SIZE = FIELDS.reduce((sum, [, size]) => sum + size, 0); // 334

// Table 1/2 "nMode" enum (§3.2/§4.2, identical for IPv4/IPv6) — request-side
// (6/7/8/9) and response-side (12/13/23/24/25/33/66/77) values together,
// one authoritative copy.
const NMODE = {
  DEF_REQ_SCAN_EXT:           6,
  DEF_REQ_APPLY_EXT:          7,
  DEF_REQ_SCAN_RSA:           8,
  DEF_REQ_APPLY_PASSWORD:     9,
  DEF_RES_SCAN_EXT:           12,
  DEF_RES_SCAN_RSA:           13,
  DEF_RES_APPLY_EXT:          23,
  DEF_RES_APPLY_PASSWORD_ERR: 24,
  DEF_RES_APPLY_PASSWORD:     25,
  DEF_RES_PASSWORD_ERR:       33,
  DEF_RES_ROUTER_CONN_ERR:    66,
  DEF_RES_APPLY_ERR:          77,
};

// Response modes belonging to a different exchange entirely (RSA key
// exchange §3.5, password-apply §3.6/§3.7), each with its own incompatible
// wire struct (e.g. `tagRsaScanResponse`) — not the IP-Scan
// `DATAPACKET_(EXT_)IPv4_T` layout `FIELDS` above describes.
const NON_SCAN_RESPONSE_MODES = new Set([
  NMODE.DEF_RES_SCAN_RSA,
  NMODE.DEF_RES_APPLY_EXT,
  NMODE.DEF_RES_APPLY_PASSWORD_ERR,
  NMODE.DEF_RES_APPLY_PASSWORD,
  NMODE.DEF_RES_PASSWORD_ERR,
  NMODE.DEF_RES_ROUTER_CONN_ERR,
  NMODE.DEF_RES_APPLY_ERR,
]);

// §3.4.2 "Response" (Annex A: `datapacket_ext_v4_t.version`) — the
// `nVersion` field is a bitmask, "a combination of the following values",
// not a single enum. Only meaningful on an extended (`nMode=12`) response;
// undefined/0 on a base-mode response where the extended block is absent.
const NVERSION = {
  CANNOT_CHANGE_HTTPS_PORT_IN_WEBPAGE: 0x01,
  CAN_CHANGE_HTTPS_PORT_IN_WEBPAGE:    0x02,
  SUPPORT_NEW_MODEL_NAME:              0x04,
  SUPPORT_PASSWORD_VERIFICATION_DIGEST: 0x08,
};

/** True if `nVersion` (bitmask) has `flag` (one of `NVERSION`'s values) set. */
function hasVersionFlag(nVersion, flag) {
  return typeof nVersion === 'number' && (nVersion & flag) === flag;
}

// §3.4.2 "Response" (Annex A: `network_mode`) — IP configuration type.
const NETWORK_MODE = {
  STATIC: 0,
  DHCP:   1,
  PPPOE:  2,
};

// §3.4.2 "Response" (Annex A: `model_type`) — Device Type. Keys mirror
// `DEVICE_TYPE_LABELS` in the parent project's
// server/src/services/discoveryService.js (`mapUDPDevice()`'s `DeviceType`
// label lookup) so the two stay easy to cross-check.
const DEVICE_TYPE = {
  CAMERA:            0x00,
  ENCODER:           0x01,
  DECODER:           0x02,
  RECORDER:          0x03,
  IO_BOX:            0x04,
  NETWORK_SPEAKER:   0x05,
  NETWORK_MIC:       0x06,
  LED_BOX:           0x07,
  EMERGENCY_BELL:    0x08,
  ACCESS_CONTROLLER: 0x09,
};

// §3.4.2 "Response" (Annex A: `https_mode`) — web UI scheme.
const HTTP_MODE = {
  HTTP:  0x00,
  HTTPS: 0x01,
};

// §3.4.2 "Response" (Annex A: `supported_protocol`) — bitmask, "a
// combination of the following values" like `NVERSION` above, not a single
// enum.
const SUPPORTED_PROTOCOL = {
  SVNP:               0x01,
  SUNAPI_1_0:         0x02,
  SUNAPI_2_0:         0x04,
  SUNAPI_2_3_1_ABOVE:  0x08,
  SVP:                0x10,
};

/** True if `nSupportedProtocol` (bitmask) has `flag` (one of `SUPPORTED_PROTOCOL`'s values) set. */
function hasSupportedProtocol(nSupportedProtocol, flag) {
  return typeof nSupportedProtocol === 'number' && (nSupportedProtocol & flag) === flag;
}

// §3.4.2 "Response" (Annex A: `no_password`) — field name is misleading:
// `0` means the camera HAS a password, `1` means it does NOT.
const PASSWORD_STATUS = {
  HAS_PASSWORD: 0x00,
  NO_PASSWORD:  0x01,
};

module.exports = {
  SEND_PORT, RECEIVE_PORT, BROADCAST_ADDR,
  FIELDS, STRING_FIELDS, UINT16_BE_FIELDS, PACKET_SIZE,
  NMODE, NON_SCAN_RESPONSE_MODES,
  NVERSION, hasVersionFlag,
  NETWORK_MODE,
  DEVICE_TYPE,
  HTTP_MODE,
  SUPPORTED_PROTOCOL, hasSupportedProtocol,
  PASSWORD_STATUS,
};
