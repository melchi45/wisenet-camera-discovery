#!/usr/bin/env node
// Native messaging host for the Wisenet IP Installer extension.
//
// Manifest V3 extensions cannot open raw UDP sockets (chrome.sockets.udp
// was a Chrome Apps API) or parse SUNAPI's binary reply format themselves
// (no `Buffer`/`dgram` in a service worker or a plain extension page), so
// this host does both on the extension's behalf: broadcasts the
// discovery request, and parses every reply with ../../sunapi/response.ts
// (the same parser nodejs/udpDiscovery.ts uses) before relaying it to the
// extension as a plain device object — see scripts/socket.ts there, which
// used to re-implement this same 334-byte struct decode by hand.
//
// src/sunapi/ is NOT inside src/chrome-extension/ or src/nodejs/: it's
// the wire-format implementation shared by this native host and the
// standalone nodejs/ npm package, without this host having to depend on
// nodejs/'s internal layout (nodejs/ has its own package.json — see
// sunapi/README.md). It sits one level above src/chrome-extension/,
// hence '../../sunapi/' here (this file is nested one directory deeper —
// src/chrome-extension/native-host/ — than src/nodejs/udpDiscovery.ts's
// own '../sunapi/').
//
// Messages from the extension:
//   { command: "start", receivePort, sendPort, broadcastAddress }
//   { command: "broadcast" }  re-send the discovery payload
//   { command: "stop" }       close the socket
//
// Messages to the extension:
//   { type: "started", receivePort }
//   { type: "device", device: {...} }  a parsed camera/NVR reply
//   { type: "error", message }
//
// Replies that aren't a scan response (RSA key exchange, password-apply,
// etc. — see protocol.js's NON_SCAN_RESPONSE_MODES) are parsed and
// silently dropped rather than relayed, since UdpResponse.parse() already
// knows they're a different exchange with an incompatible struct.

'use strict';

const dgram = require('dgram');
const { UdpResponse } = require('../../sunapi/response');
const { UdpRequest, NMODE } = require('../../sunapi/request');

// §3.4.1 "Request" — nMode = DEF_REQ_SCAN_EXT (6), the spec-documented
// IP-Scan broadcast opcode, built fresh (new chPacketID) on every
// broadcast() call the same way nodejs/udpDiscovery.js's _sendDiscovery()
// does. This replaces a hardcoded legacy 262-byte packet (nMode=1,
// captured from this extension's original Chrome App) that predates the
// 334-byte DATAPACKET_V4_EXT struct sunapi/protocol.js implements — the
// two aren't different field values of the same struct, they're
// different struct sizes entirely, so UdpRequest could never have
// reproduced that exact packet.
//
// KNOWN RISK, accepted deliberately rather than missed: a prior
// side-by-side test (see nodejs/README.md "Request/Response classes")
// found nMode=6 can draw replies from a much broader, largely unrelated
// portion of the network compared to the legacy nMode=1 packet. If that
// turns out to be a problem here too, the fix is reverting this file to
// send a fixed nMode=1 buffer again (`UdpRequest.NMODE` doesn't need to
// change either way — passing `{ nMode: 1 }` to `new UdpRequest(...)`
// still emits the 334-byte struct, not the old 262-byte one, so a true
// revert means restoring the literal historical buffer, not just this
// opcode).
function buildDiscoveryPacket() {
  return new UdpRequest({ nMode: NMODE.DEF_REQ_SCAN_EXT }).toBuffer();
}

let sock = null;
let config = null;

function sendMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
}

function sendError(err) {
  sendMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
}

function stopDiscovery() {
  if (sock !== null) {
    try {
      sock.close();
    } catch (err) {
      // already closed
    }
    sock = null;
  }
}

function broadcast() {
  if (sock === null || config === null) {
    sendError('socket is not started');
    return;
  }
  // A fresh packet (fresh chPacketID) each call, same as
  // nodejs/udpDiscovery.js's _sendDiscovery().
  const packet = buildDiscoveryPacket();
  sock.send(packet, config.sendPort, config.broadcastAddress, (err) => {
    if (err) {
      sendError(err);
    }
  });
}

function startDiscovery(message) {
  stopDiscovery();

  config = {
    receivePort: message.receivePort || 7711,
    sendPort: message.sendPort || 7701,
    broadcastAddress: message.broadcastAddress || '255.255.255.255',
  };

  sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  sock.on('error', (err) => {
    sendError(err);
    stopDiscovery();
  });

  sock.on('message', (data, rinfo) => {
    let response;
    try {
      response = UdpResponse.parse(data, rinfo);
    } catch (err) {
      sendError(err);
      return;
    }
    if (!response) {
      return; // not a scan reply (NON_SCAN_RESPONSE_MODES) — nothing to relay
    }
    sendMessage({ type: 'device', device: response.toLegacyDeviceObject() });
  });

  sock.bind(config.receivePort, () => {
    sock.setBroadcast(true);
    sendMessage({ type: 'started', receivePort: config.receivePort });
    broadcast();
  });
}

function handleMessage(message) {
  switch (message.command) {
    case 'start':
      startDiscovery(message);
      break;
    case 'broadcast':
      broadcast();
      break;
    case 'stop':
      stopDiscovery();
      break;
    default:
      sendError('unknown command: ' + message.command);
      break;
  }
}

let inputBuffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  while (inputBuffer.length >= 4) {
    const length = inputBuffer.readUInt32LE(0);
    if (inputBuffer.length < 4 + length) {
      break;
    }
    const body = inputBuffer.slice(4, 4 + length).toString('utf8');
    inputBuffer = inputBuffer.slice(4 + length);
    try {
      handleMessage(JSON.parse(body));
    } catch (err) {
      sendError(err);
    }
  }
});

// Chrome closes stdin when the extension disconnects the port.
process.stdin.on('end', () => {
  stopDiscovery();
  process.exit(0);
});
