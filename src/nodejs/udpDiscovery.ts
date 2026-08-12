'use strict';

const dgram = require('dgram');
const EventEmitter = require('events');
// request.js/response.js/protocol.js live in ../sunapi/ (not this
// directory) so that native-host/wisenet-udp-host.js (this extension's
// own repo, not a consumer of the nodejs/ npm package) can use the same
// SUNAPI wire-format implementation without depending on nodejs/'s
// internal layout — see sunapi/README.md.
const { UdpRequest }  = require('../sunapi/request');
const { UdpResponse } = require('../sunapi/response');
const {
  SEND_PORT, RECEIVE_PORT, BROADCAST_ADDR, NMODE, NON_SCAN_RESPONSE_MODES,
} = require('../sunapi/protocol');

// Historical discovery packet captured from the WiseNetChromeIPInstaller
// Chrome extension (scripts/socket.js) — nMode=1, an undocumented/legacy
// opcode empirically proven against this project's camera fleet (see
// FR-CAM-082, docs/design/Design_Camera_Discovery.md in the parent repo).
// Kept commented out rather than deleted: this is the fallback to restore
// in _sendDiscovery() below if DEF_REQ_SCAN_EXT (6) turns out not to work
// against some device. See nodejs/README.md "Request/Response classes".
// const DISCOVERY_PACKET = Buffer.from(
//   '018750735306465625ef6da75b047d7bcd1c3c001800000000000000f0eacf00' +
//   '000000000000000000000000faf8ec76000000000000000050ea18001a01ec76' +
//   'f0e9180000000000e4ea18008000ec76f0eacf0000000000f000000000000000' +
//   '00000000fc3841007226881300000000b972c1746121c274881310272e272427' +
//   '1a2742270000000000000000b10200000100000000000000f000000001000000' +
//   '01000000f0eacf00d00b20000000000074ea18007a61c274f0eacf0000000000' +
//   'fc38410000000000000000000100000078f418008cea180076784100d00b2000' +
//   'f00000000000000001000000a4ea18000e7f4000c4ea18000904000050fe1800' +
//   '78f41800f0ea',
//   'hex'
// );

// SEND_PORT/RECEIVE_PORT/BROADCAST_ADDR and NMODE/NON_SCAN_RESPONSE_MODES
// are protocol.js's (imported above) — see that file for the full Table
// 1/2 `nMode` enum and the Annex A note on why DEF_RES_SCAN_EXT's response
// carries the extended field block (alias/chDeviceNameNew/modelType/version/
// httpType/nHttpsPort/supportedProtocol/noPassword) while the base scan
// response (nMode=11 on every real device on this network) has no room for
// those fields at all.
const RESPONSE_MODE_SCAN_EXT = NMODE.DEF_RES_SCAN_EXT;

/**
 * Node.js port of WiseNet Chrome App UDP camera discovery.
 * Ported from chrome.sockets.udp to Node.js dgram.
 *
 * Events:
 *   'listening'        — socket bound and ready
 *   'sent'              — discovery broadcast sent
 *   'device'            — camera found, payload: parsed camera object
 *   'scanExtConfirmed'  — a DEF_RES_SCAN_EXT (12) response was received for
 *                         our DEF_REQ_SCAN_EXT (6) request, payload: the
 *                         parsed UdpResponse (see response.js). Purely a
 *                         verification signal for the nMode=6 request opcode
 *                         switch below — 'device' is still what drives
 *                         discovery results.
 *   'parseError'        — malformed response packet
 *   'done'              — discovery timeout reached
 *   'error'             — socket error
 */
class UDPDiscovery extends EventEmitter {
  [key: string]: any;

  constructor(options: Record<string, any> = {}) {
    super();
    this.sendPort      = options.sendPort      || SEND_PORT;
    this.receivePort   = options.receivePort   || RECEIVE_PORT;
    this.broadcastAddr = options.broadcastAddr || BROADCAST_ADDR;
    this.timeout       = options.timeout       || 5000;
    this._socket  = null;
    this._running = false;
    this._timer   = null;
    this._seen    = new Set();  // deduplicate by MAC
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._seen.clear();

    this._socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this._socket.on('error', (err) => {
      this.emit('error', err);
      this.stop();
    });

    this._socket.on('message', (msg, rinfo) => {
      // Verification step for the DEF_REQ_SCAN_EXT (6) request sent by
      // _sendDiscovery() below: §3.4.2 documents that this request opcode
      // draws a DEF_RES_SCAN_EXT (12) response. response.js's UdpResponse
      // confirms that independently of the legacy _parseResponse() parse
      // below (still the one that actually drives 'device'/discovery
      // results — see nodejs/README.md "Request/Response classes").
      const scanExtResponse = UdpResponse.parse(msg, rinfo);
      if (scanExtResponse && scanExtResponse.nMode === NMODE.DEF_RES_SCAN_EXT) {
        this.emit('scanExtConfirmed', scanExtResponse);
      }

      try {
        const result = this._parseResponse(msg, rinfo);
        if (!result || !result.chIP) return;
        const key = result.chMac || result.chIP;
        if (this._seen.has(key)) return;
        this._seen.add(key);
        this.emit('device', result);
      } catch (e) {
        this.emit('parseError', e, msg, rinfo);
      }
    });

    this._socket.bind(this.receivePort, '0.0.0.0', () => {
      this._socket.setBroadcast(true);
      this.emit('listening');
      this._sendDiscovery();
    });

    this._timer = setTimeout(() => this.stop(), this.timeout);
  }

  stop() {
    this._running = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (this._socket) {
      try { this._socket.close(); } catch (_) {}
      this._socket = null;
    }
    this.emit('done');
  }

  _sendDiscovery() {
    if (!this._socket) return;
    // §3.4.1 "Request" (request.js) — DEF_REQ_SCAN_EXT (6) is the
    // spec-documented request opcode. Historical DISCOVERY_PACKET (nMode=1,
    // above) is commented out, not deleted — restore that Buffer/send call
    // here if nMode=6 turns out not to work against some device.
    const request = new UdpRequest({ nMode: NMODE.DEF_REQ_SCAN_EXT });
    const hex     = request.toBuffer().toString('hex'); // plain hex, no "0x" prefix
    const packet  = Buffer.from(hex, 'hex');
    this._socket.send(
      packet, 0, packet.length,
      this.sendPort, this.broadcastAddr,
      (err) => { if (err) this.emit('error', err); else this.emit('sent'); }
    );
  }

  /**
   * Legacy field-shape adapter over `UdpResponse.parse()` (response.js) --
   * the field-renaming itself (`chMac` not `chMAC`, `DDNSURL` not
   * `chDDNS`, `modelType` not `nModelType`, etc.) now lives in
   * `UdpResponse.prototype.toLegacyDeviceObject()` (single source of
   * truth -- WiseNetChromeIPInstaller's native-host/wisenet-udp-host.js
   * calls the same method directly). This wrapper only adds `_rinfo`,
   * which `mapUDPDevice()` (`server/src/services/discoveryService.js` in
   * the parent project) and this project's own tests
   * (`test/api/nvr_channel_discovery.test.js`) depend on and
   * `toLegacyDeviceObject()` itself has no reason to know about.
   *
   * One deliberate shape change from the original inline parser this
   * replaced: `chPacketId` used to be the raw undecoded bytes (a view
   * into the response buffer); it is now the decoded/trimmed string
   * `UdpResponse` produces. Nothing in this codebase reads `chPacketId`
   * today, so this is safe -- flagged here in case a future caller
   * expects raw bytes.
   */
  _parseResponse(buf, rinfo) {
    const r = UdpResponse.parse(buf, rinfo);
    if (!r) return null;

    const result = r.toLegacyDeviceObject();
    result._rinfo = rinfo;
    return result;
  }
}

// DISCOVERY_PACKET is commented out above (nMode=1 historical fallback), so
// it is no longer exported — UdpRequest/UdpResponse (request.js,
// response.js) are the supported way to build/inspect these packets now.
module.exports = { UDPDiscovery, SEND_PORT, RECEIVE_PORT, BROADCAST_ADDR, RESPONSE_MODE_SCAN_EXT, NMODE, NON_SCAN_RESPONSE_MODES };
