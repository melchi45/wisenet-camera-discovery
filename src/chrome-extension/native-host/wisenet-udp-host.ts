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
//   { command: "httpRequest", requestId, method, url, headers, body, username, password }
//     performs a SUNAPI HTTP(S) request on the extension's behalf, bypassing
//     browser TLS certificate validation — see below and
//     docs/native-https-proxy/ at the repo root for the full design/spec.
//   { command: "wsOpen", connectionId, url }
//     opens a WebSocket (ws:// or wss://) to the RTSP-over-WebSocket
//     streaming server on the extension's behalf, also bypassing browser
//     TLS certificate validation — the video-streaming counterpart to
//     httpRequest above. One connectionId per active stream.
//   { command: "wsSend", connectionId, data }
//     sends one binary frame (base64) on an already-open connection.
//   { command: "wsClose", connectionId }
//     closes the connection.
//
// Messages to the extension:
//   { type: "started", receivePort }
//   { type: "device", device: {...} }  a parsed camera/NVR reply
//   { type: "error", message }
//   { type: "httpResponse", requestId, status, statusText, headers, body }
//   { type: "httpError", requestId, message }
//   { type: "wsOpen", connectionId }               the connection is open
//   { type: "wsMessage", connectionId, data }       one binary frame (base64)
//   { type: "wsError", connectionId, message }      the connection failed
//   { type: "wsClose", connectionId, code, reason } the connection closed
//
// Replies that aren't a scan response (RSA key exchange, password-apply,
// etc. — see protocol.js's NON_SCAN_RESPONSE_MODES) are parsed and
// silently dropped rather than relayed, since UdpResponse.parse() already
// knows they're a different exchange with an incompatible struct.

'use strict';

const dgram = require('dgram');
const https = require('https');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { URL } = require('url');
const WebSocket = require('ws');
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

// --- SUNAPI HTTP(S) proxy ("httpRequest" command) ---
//
// This exists so window.ts can talk to a camera/NVR whose HTTPS certificate
// is self-signed without the browser rejecting the request outright
// (ERR_CERT_AUTHORITY_INVALID) — see docs/native-https-proxy/DESIGN.md.
// This process runs outside the browser's TLS trust store entirely, so
// `rejectUnauthorized: false` here only affects requests this host itself
// makes, not the browser's own certificate handling anywhere else.
//
// SAFETY RAIL: only proxies to a literal RFC1918/loopback/link-local IP —
// never a hostname or a public IP. Without this, an opt-in "ignore TLS
// errors for my LAN camera" feature would otherwise become a general
// "fetch any URL while ignoring TLS errors" primitive for anything able to
// reach this native host, which is not the intent (see
// docs/native-https-proxy/SRS.md's non-functional requirements).
function isAllowedProxyHost(hostname) {
  const version = net.isIP(hostname);
  if (version === 4) {
    const parts = hostname.split('.').map(Number);
    const [a, b] = parts;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local
    return false;
  }
  if (version === 6) {
    const h = hostname.toLowerCase();
    if (h === '::1') return true; // loopback
    if (h.startsWith('fe80:')) return true; // link-local
    if (h.startsWith('fc') || h.startsWith('fd')) return true; // fc00::/7 unique local
    return false;
  }
  return false; // not a literal IP address (a hostname) — reject
}

// Parses an RFC 7616 `WWW-Authenticate: Digest ...` challenge header into
// its key/value directives (realm, nonce, qop, opaque, algorithm, ...).
function parseWWWAuthenticateDigest(header) {
  const result = {};
  const re = /(\w+)=("([^"]*)"|[^,]*)/g;
  let m;
  while ((m = re.exec(header)) !== null) {
    result[m[1]] = m[3] !== undefined ? m[3] : m[2].trim();
  }
  return result;
}

function digestHash(algorithm, text) {
  const alg = (algorithm || 'MD5').toUpperCase().replace('-SESS', '');
  const nodeAlg = alg === 'SHA-256' || alg === 'SHA256' ? 'sha256' : 'md5';
  return crypto.createHash(nodeAlg).update(text, 'utf8').digest('hex');
}

// Builds the `Authorization: Digest ...` header for one challenge/response
// round (RFC 7616 §3.4) — the same algorithm the vendored
// @melchi45/rtsp-over-websocket player does in-browser (XO.digestSchema /
// setDigestHeader), reimplemented here in Node since those are private,
// minified internals of that package and not exported for reuse.
function buildDigestAuthHeader({ method, uri, username, password, challenge }) {
  const realm = challenge.realm || '';
  const nonce = challenge.nonce || '';
  const qop = challenge.qop ? challenge.qop.split(',')[0].trim() : undefined;
  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');

  const ha1 = digestHash(challenge.algorithm, `${username}:${realm}:${password}`);
  const ha2 = digestHash(challenge.algorithm, `${method}:${uri}`);
  const response = qop
    ? digestHash(challenge.algorithm, `${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : digestHash(challenge.algorithm, `${ha1}:${nonce}:${ha2}`);

  let header = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;
  if (qop) header += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  if (challenge.opaque) header += `, opaque="${challenge.opaque}"`;
  if (challenge.algorithm) header += `, algorithm=${challenge.algorithm}`;
  return header;
}

// No response within this long, a LAN device should never actually take —
// exists so a black-holed/firewalled connection (Node's http/https clients
// have no default timeout) surfaces as a real httpError instead of leaving
// the extension's request pending forever. See
// docs/native-https-proxy/SRS.md's "Constraints" and
// nativeSunapiClient.ts's matching client-side REQUEST_TIMEOUT_MS.
const HTTP_REQUEST_TIMEOUT_MS = 15000;

// One HTTP(S) round trip. `callback(err, response)` — response is
// `{status, statusText, headers, body}` (body always a utf8 string).
// `callback` is guaranteed to fire exactly once (guarded against the
// error/timeout paths racing a response that arrives around the same
// moment).
function performHttpRequest({ method, url, headers, body }, callback) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    callback(new Error('invalid url: ' + (err && err.message ? err.message : err)));
    return;
  }
  if (!isAllowedProxyHost(parsed.hostname)) {
    callback(new Error(
      'refusing to proxy to "' + parsed.hostname + '": only a literal ' +
      'private/loopback/link-local IP address may be used with the HTTPS proxy'
    ));
    return;
  }

  let settled = false;
  const settle = (err, res) => {
    if (settled) return;
    settled = true;
    callback(err, res);
  };

  process.stderr.write('[wisenet-udp-host] httpRequest ' + (method || 'GET') + ' ' + url + '\n');

  const lib = parsed.protocol === 'https:' ? https : http;
  const req = lib.request({
    method: method || 'GET',
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path: parsed.pathname + parsed.search,
    headers: Object.assign({}, headers),
    // The whole point of this proxy: this device runs its own trust
    // decision (the user opted in from window.ts), not the browser's.
    rejectUnauthorized: false,
  }, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      process.stderr.write('[wisenet-udp-host] httpRequest ' + url + ' -> ' + res.statusCode + '\n');
      settle(null, {
        status: res.statusCode,
        statusText: res.statusMessage,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
    });
  });
  req.setTimeout(HTTP_REQUEST_TIMEOUT_MS, () => {
    req.destroy(new Error('request to ' + url + ' timed out after ' + HTTP_REQUEST_TIMEOUT_MS + 'ms'));
  });
  req.on('error', (err) => {
    process.stderr.write('[wisenet-udp-host] httpRequest ' + url + ' failed: ' + (err && err.message ? err.message : err) + '\n');
    settle(err, null);
  });
  if (body) req.write(body);
  req.end();
}

// Handles one `{command: "httpRequest", ...}` message end-to-end, including
// a single Digest-auth challenge/retry round if the device asks for one
// (SUNAPI devices default to Digest auth) — the extension always gets back
// exactly one `httpResponse`/`httpError` per `requestId`.
function handleHttpRequest(message) {
  const { requestId, method, url, headers, body, username, password } = message;
  if (!requestId || !url) {
    sendMessage({ type: 'httpError', requestId, message: 'httpRequest requires "requestId" and "url"' });
    return;
  }

  performHttpRequest({ method, url, headers, body }, (err, res) => {
    if (err) {
      sendMessage({ type: 'httpError', requestId, message: String(err && err.message ? err.message : err) });
      return;
    }

    const wwwAuthenticate = res.headers && res.headers['www-authenticate'];
    if (res.status === 401 && wwwAuthenticate && /^digest/i.test(wwwAuthenticate) && username) {
      const challenge = parseWWWAuthenticateDigest(wwwAuthenticate);
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch (parseErr) {
        sendMessage({ type: 'httpError', requestId, message: String(parseErr && parseErr.message ? parseErr.message : parseErr) });
        return;
      }
      const authHeader = buildDigestAuthHeader({
        method: method || 'GET',
        uri: parsedUrl.pathname + parsedUrl.search,
        username,
        password: password || '',
        challenge,
      });
      const retryHeaders = Object.assign({}, headers, { Authorization: authHeader });
      performHttpRequest({ method, url, headers: retryHeaders, body }, (retryErr, retryRes) => {
        if (retryErr) {
          sendMessage({ type: 'httpError', requestId, message: String(retryErr && retryErr.message ? retryErr.message : retryErr) });
          return;
        }
        sendMessage({ type: 'httpResponse', requestId, status: retryRes.status, statusText: retryRes.statusText, headers: retryRes.headers, body: retryRes.body });
      });
      return;
    }

    sendMessage({ type: 'httpResponse', requestId, status: res.status, statusText: res.statusText, headers: res.headers, body: res.body });
  });
}

// --- RTSP-over-WebSocket streaming proxy ("wsOpen"/"wsSend"/"wsClose") ---
//
// Same rationale and safety rail as the HTTP(S) proxy above
// (isAllowedProxyHost), for the actual video streaming connection
// (wss://<camera>/StreamingServer) — see docs/native-https-proxy/DESIGN.md.
// Unlike httpRequest, this is a long-lived, continuous, bidirectional
// connection, so the protocol is connectionId-keyed rather than
// requestId/one-shot: one wsOpen per active stream, followed by any number
// of wsSend/wsMessage frames until a wsClose (from either side).
const wsConnections = new Map(); // connectionId -> ws.WebSocket

const WS_CONNECT_TIMEOUT_MS = 15000;

function handleWsOpen(message) {
  const { connectionId, url } = message;
  if (!connectionId || !url) {
    sendMessage({ type: 'wsError', connectionId, message: 'wsOpen requires "connectionId" and "url"' });
    return;
  }
  if (wsConnections.has(connectionId)) {
    sendMessage({ type: 'wsError', connectionId, message: 'connectionId already in use' });
    return;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    sendMessage({ type: 'wsError', connectionId, message: 'invalid url: ' + (err && err.message ? err.message : err) });
    return;
  }
  if (!isAllowedProxyHost(parsed.hostname)) {
    sendMessage({
      type: 'wsError',
      connectionId,
      message: 'refusing to proxy to "' + parsed.hostname + '": only a literal ' +
        'private/loopback/link-local IP address may be used with the WebSocket proxy'
    });
    return;
  }

  // The whole point of this proxy: this device runs its own trust
  // decision (the user opted in from window.ts), not the browser's — same
  // as performHttpRequest()'s rejectUnauthorized: false above.
  const ws = new WebSocket(url, { rejectUnauthorized: false });
  wsConnections.set(connectionId, ws);

  const connectTimeoutId = setTimeout(() => {
    sendMessage({ type: 'wsError', connectionId, message: 'connect to ' + url + ' timed out after ' + WS_CONNECT_TIMEOUT_MS + 'ms' });
    wsConnections.delete(connectionId);
    try { ws.terminate(); } catch (err) { /* already gone */ }
  }, WS_CONNECT_TIMEOUT_MS);

  ws.on('open', () => {
    clearTimeout(connectTimeoutId);
    sendMessage({ type: 'wsOpen', connectionId });
  });
  ws.on('message', (data) => {
    sendMessage({ type: 'wsMessage', connectionId, data: Buffer.from(data).toString('base64') });
  });
  ws.on('error', (err) => {
    clearTimeout(connectTimeoutId);
    sendMessage({ type: 'wsError', connectionId, message: String(err && err.message ? err.message : err) });
  });
  ws.on('close', (code, reason) => {
    clearTimeout(connectTimeoutId);
    wsConnections.delete(connectionId);
    sendMessage({ type: 'wsClose', connectionId, code, reason: reason ? reason.toString() : '' });
  });
}

function handleWsSend(message) {
  const { connectionId, data } = message;
  const ws = wsConnections.get(connectionId);
  if (!ws) {
    sendMessage({ type: 'wsError', connectionId, message: 'no such connection' });
    return;
  }
  try {
    ws.send(Buffer.from(data, 'base64'));
  } catch (err) {
    sendMessage({ type: 'wsError', connectionId, message: String(err && err.message ? err.message : err) });
  }
}

function handleWsClose(message) {
  const { connectionId } = message;
  const ws = wsConnections.get(connectionId);
  if (!ws) {
    return; // already closed / never opened — closing twice is a no-op, not an error
  }
  try {
    ws.close();
  } catch (err) {
    // already closed
  }
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
    case 'httpRequest':
      handleHttpRequest(message);
      break;
    case 'wsOpen':
      handleWsOpen(message);
      break;
    case 'wsSend':
      handleWsSend(message);
      break;
    case 'wsClose':
      handleWsClose(message);
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
  wsConnections.forEach((ws) => {
    try { ws.terminate(); } catch (err) { /* already gone */ }
  });
  wsConnections.clear();
  process.exit(0);
});
