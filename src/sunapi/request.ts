'use strict';

const os     = require('os');
const crypto = require('crypto');
const {
  FIELDS, STRING_FIELDS, UINT16_BE_FIELDS, PACKET_SIZE, NMODE,
} = require('./protocol');

// §3.2 "SendData Format for SUNAPI" (struct `DATAPACKET_V4_EXT`, 334 bytes)
// — field layout lives in protocol.js (shared with response.js and
// udpDiscovery.js). See also §3.4.1 "Request" —
// http://55.101.56.209:8080/site/SUNAPI/SUNAPI_ipinstaller.html#_request —
// which uses this exact struct for the IP-Scan broadcast request, leaving
// every field but `nMode`/`chPacketID` "Unused".

/**
 * Builds an 18-byte chPacketID: "unique ID derived from MAC address of PC
 * and random value" (§3.2's own description of the field). First 6 bytes are
 * this host's first non-internal MAC address (or zero if none is found,
 * e.g. in a sandboxed CI container); remaining 12 bytes are random.
 */
function generatePacketId() {
  const nets = os.networkInterfaces();
  let macBytes = Buffer.alloc(6, 0);
  outer:
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
        macBytes = Buffer.from(net.mac.split(':').map((b) => parseInt(b, 16)));
        break outer;
      }
    }
  }
  return Buffer.concat([macBytes, crypto.randomBytes(12)], 18);
}

/**
 * SUNAPI IP Installer §3.2 "SendData Format for SUNAPI" request packet
 * (`DATAPACKET_V4_EXT`, 334 bytes incl. Annex A's `reserved2`/`reserved3`).
 * Defaults match §3.4.1 "Request" for the
 * IP-Scan broadcast: `nMode = DEF_REQ_SCAN_EXT (6)`, a freshly generated
 * `chPacketID`, and every other field left at its documented "Unused" value
 * (zero-filled). Pass a field in the constructor's `fields` object to
 * override any of them — e.g. `new UdpRequest({ nMode: 1 })` to reproduce
 * this fleet's previously-observed legacy opcode (see udpDiscovery.js's
 * `DISCOVERY_PACKET` comment).
 */
class UdpRequest {
  [key: string]: any;

  static FIELDS: typeof FIELDS;
  static PACKET_SIZE: typeof PACKET_SIZE;
  static NMODE: typeof NMODE;
  static STRING_FIELDS: typeof STRING_FIELDS;
  static UINT16_BE_FIELDS: typeof UINT16_BE_FIELDS;

  constructor(fields: Record<string, any> = {}) {
    this.nMode = fields.nMode !== undefined ? fields.nMode : NMODE.DEF_REQ_SCAN_EXT;
    this.chPacketID = fields.chPacketID !== undefined ? fields.chPacketID : generatePacketId();

    for (const [name] of FIELDS) {
      if (name === 'nMode' || name === 'chPacketID') continue;
      this[name] = fields[name] !== undefined
        ? fields[name]
        : (STRING_FIELDS.has(name) ? '' : 0);
    }
  }

  /** Serializes to the exact 334-byte wire format described by §3.2/Annex A. */
  toBuffer() {
    const buf = Buffer.alloc(PACKET_SIZE, 0);
    let offset = 0;

    for (const [name, size] of FIELDS) {
      const value = this[name];

      if (name === 'nMode') {
        buf.writeUInt8(value & 0xff, offset);
      } else if (STRING_FIELDS.has(name)) {
        // Buffer/raw-byte value (e.g. generated chPacketID) or a char[]
        // string — either way, truncate/zero-pad to the field's fixed size.
        const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'latin1');
        bytes.copy(buf, offset, 0, Math.min(bytes.length, size));
      } else if (size === 1) {
        buf.writeUInt8(value & 0xff, offset);
      } else if (size === 2) {
        if (UINT16_BE_FIELDS.has(name)) buf.writeUInt16BE(value & 0xffff, offset);
        else buf.writeUInt16LE(value & 0xffff, offset);
      }

      offset += size;
    }

    return buf;
  }

  /** Sends this request on an already-bound dgram socket. Returns a Promise. */
  send(socket: any, port: number, address: string) {
    const buf = this.toBuffer();
    return new Promise<void>((resolve, reject) => {
      socket.send(buf, 0, buf.length, port, address, (err) => {
        if (err) reject(err); else resolve();
      });
    });
  }
}

UdpRequest.FIELDS            = FIELDS;
UdpRequest.PACKET_SIZE       = PACKET_SIZE;
UdpRequest.NMODE             = NMODE;
UdpRequest.STRING_FIELDS     = STRING_FIELDS;
UdpRequest.UINT16_BE_FIELDS  = UINT16_BE_FIELDS;

// FIELDS/PACKET_SIZE/STRING_FIELDS/UINT16_BE_FIELDS/NMODE are protocol.js's
// (imported above) — re-exported here too for existing call sites that
// destructure them from `./request` (e.g. `UdpRequest.NMODE`).
module.exports = { UdpRequest, NMODE, PACKET_SIZE, FIELDS, STRING_FIELDS, UINT16_BE_FIELDS };
