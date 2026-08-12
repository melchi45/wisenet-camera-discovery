#!/usr/bin/env node
// Example server exposing ../udpDiscovery.js's UDPDiscovery over HTTP
// (one-shot), WebSocket (live stream), and a small persistent background
// discovery loop — plus the same window.html/window.ts UI the Chrome
// extension uses (src/shared/, copied in at build time — see
// scripts/build.js's copySharedWebAssets and window.ts's IS_EXTENSION
// check in scripts/socket.ts). This is a reference example for wiring
// UDPDiscovery into a service — still no auth/rate-limiting, but
// discovery state (the known-devices cache and the auto-discovery loop
// below) is real/persistent now, not a one-shot-per-request throwaway.
// See ../README.md "Example server" for how to run it, and for HTTP_PORT/
// HTTPS_PORT .env configuration (see loadEnv.ts, required first below).
//
// Serves both HTTP and HTTPS (self-signed dev cert, auto-generated on
// first run into certs/ next to this package — see ensureSelfSignedCert)
// on the same routes, mirroring the rtsp-over-websocket repo's own demo
// server's dual-port pattern. Both share one request handler
// (handleRequest) and one WS connection handler (handleWsConnection) —
// see the bottom of this file.
//
//   GET  /                          The shared window.html UI — same
//                                    discovery table/controls as the
//                                    Chrome extension, driven by the
//                                    WebSocket endpoint below.
//   GET  /window.js, /css/*.css,
//        /scripts/*.js,
//        /external-lib/**           Static assets window.html references
//                                    (see serveStaticFile below).
//
//   GET  /discover[?timeout=5000]   Runs one discovery round and responds
//                                    with every device found, once it
//                                    completes (or times out). Independent
//                                    of the background loop/cache below.
//
//   WS   /discover                  On connect: replays every cached
//                                    known device, then runs one
//                                    immediate discovery round (mirrors
//                                    clicking "Start Discovery"). Stays
//                                    open afterward, streaming whatever
//                                    the background auto-discovery loop
//                                    finds next — closes only when the
//                                    client disconnects.
//
//   GET  /settings                  { autoDiscoveryEnabled }
//   POST /settings                  Body { autoDiscoveryEnabled }, same
//                                    shape — starts/stops the background
//                                    loop. Mirrors chrome.storage.local's
//                                    role for the extension's own toggle
//                                    (see background.ts there).

'use strict';

// Loads .env (if present) into process.env before anything below reads
// HTTP_PORT/HTTPS_PORT — see loadEnv.ts for where it looks and why.
require('./loadEnv');

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { WebSocketServer } = require('ws');
const { UDPDiscovery } = require('../udpDiscovery');

const HTTP_PORT = Number(process.env.HTTP_PORT || process.env.PORT) || 8080;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 8443;
const DEFAULT_TIMEOUT_MS = 5000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const WINDOW_HTML_PATH = path.join(PUBLIC_DIR, 'window.html');

// Self-signed dev cert, stored inside this package's own dist/ output
// (sibling of examples/, like rtsp-over-websocket's own certs/) — not
// tracked in git (dist/ is already gitignored wholesale), regenerated on
// first run after each rebuild. Only useful for exercising HTTPS/wss://
// locally; browsers will still show a one-time "not private" warning to
// accept, same as any self-signed cert.
const CERT_DIR = path.join(__dirname, '..', 'certs');
const CERT_KEY_PATH = path.join(CERT_DIR, 'dev-server.key');
const CERT_CRT_PATH = path.join(CERT_DIR, 'dev-server.crt');

/** Generates certs/dev-server.{key,crt} via openssl if they don't already exist. */
function ensureSelfSignedCert() {
  if (fs.existsSync(CERT_KEY_PATH) && fs.existsSync(CERT_CRT_PATH)) {
    return true;
  }
  fs.mkdirSync(CERT_DIR, { recursive: true });
  console.log('[server] no HTTPS cert found, generating a self-signed one in', CERT_DIR, '...');
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048',
      '-keyout', CERT_KEY_PATH,
      '-out', CERT_CRT_PATH,
      '-days', '3650',
      '-nodes',
      '-subj', '/CN=localhost'
    ], { stdio: 'inherit' });
    return true;
  } catch (err) {
    console.error('[server] could not generate a self-signed cert (is openssl installed and on PATH?):', err.message);
    console.error('[server] continuing with HTTP only.');
    return false;
  }
}

const AUTO_DISCOVERY_INTERVAL_MS = 30000;
const AUTO_DISCOVERY_DEFAULT = true;

// Devices found so far (keyed by chIP, deduplicated — last reply wins),
// mirroring scripts/socket.ts's `socket.knownDevices` role for the
// extension's background.js. A WS client that connects after a device was
// already found by the background loop replays this cache first — see
// wss.on('connection') below.
const knownDevices = {};
// Every currently-open WS /discover connection — the background loop
// pushes each newly-found device to all of them, mirroring
// chrome.runtime.sendMessage's extension-wide broadcast.
const connectedClients: Set<any> = new Set();

let autoDiscoveryEnabled = AUTO_DISCOVERY_DEFAULT;
let autoDiscoveryTimer = null;

function broadcastToClients(type, payload) {
  const message = JSON.stringify(Object.assign({ type }, payload));
  for (const ws of connectedClients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(message);
    }
  }
}

/** One background scan: updates the cache and pushes new devices to every open connection. */
function runBackgroundDiscoveryRound() {
  const discovery = new UDPDiscovery({ timeout: DEFAULT_TIMEOUT_MS });
  discovery.on('device', (device) => {
    knownDevices[device.chIP] = device;
    broadcastToClients('device', { device });
  });
  discovery.on('error', (err) => {
    console.error('[server] background discovery error:', err.message);
  });
  discovery.start();
}

function startAutoDiscovery() {
  if (autoDiscoveryTimer !== null) return;
  runBackgroundDiscoveryRound();
  autoDiscoveryTimer = setInterval(runBackgroundDiscoveryRound, AUTO_DISCOVERY_INTERVAL_MS);
}

function stopAutoDiscovery() {
  if (autoDiscoveryTimer === null) return;
  clearInterval(autoDiscoveryTimer);
  autoDiscoveryTimer = null;
}

function setAutoDiscoveryEnabled(enabled) {
  autoDiscoveryEnabled = enabled;
  if (enabled) {
    startAutoDiscovery();
  } else {
    stopAutoDiscovery();
  }
}

/** Runs one discovery round and resolves with every device found. */
function runDiscoveryOnce(timeoutMs) {
  return new Promise((resolve, reject) => {
    const discovery = new UDPDiscovery({ timeout: timeoutMs });
    const devices = [];
    discovery.on('device', (device) => devices.push(device));
    discovery.on('error', reject);
    discovery.on('done', () => resolve(devices));
    discovery.start();
  });
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.json': 'application/json',
};

/** Serves a file under PUBLIC_DIR (window.js, css/*, scripts/*, external-lib/**). */
function serveStaticFile(res, urlPathname) {
  const filePath = path.join(PUBLIC_DIR, urlPathname);
  // Reject anything that escapes PUBLIC_DIR (e.g. "/../../etc/passwd").
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'forbidden' }));
    return;
  }
  fs.readFile(filePath, (err, body) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    const contentType = CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(body);
  });
}

function readJsonBody(req): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/') {
    fs.readFile(WINDOW_HTML_PATH, (err, body) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/discover') {
    const timeoutMs = Number(url.searchParams.get('timeout')) || DEFAULT_TIMEOUT_MS;
    runDiscoveryOnce(timeoutMs)
      .then((devices) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ devices }));
      })
      .catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  if (url.pathname === '/settings') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ autoDiscoveryEnabled }));
      return;
    }
    if (req.method === 'POST') {
      readJsonBody(req)
        .then((body) => {
          if (typeof body.autoDiscoveryEnabled === 'boolean') {
            setAutoDiscoveryEnabled(body.autoDiscoveryEnabled);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ autoDiscoveryEnabled }));
        })
        .catch((err) => {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }
  }

  if (req.method === 'GET') {
    serveStaticFile(res, url.pathname);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}

function handleWsConnection(ws) {
  connectedClients.add(ws);

  const send = (type, payload) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(Object.assign({ type }, payload)));
    }
  };

  // Catch up on devices the background loop already found before this
  // connection existed — mirrors background.ts's
  // 'wisenet-request-known-devices' handler for the extension.
  for (const device of Object.values(knownDevices)) {
    send('device', { device });
  }

  // One immediate round on connect (mirrors clicking "Start Discovery"),
  // in addition to whatever the background loop finds afterward.
  const discovery = new UDPDiscovery();
  discovery.on('listening', () => send('listening', {}));
  discovery.on('sent', () => send('sent', {}));
  discovery.on('device', (device) => {
    knownDevices[device.chIP] = device;
    send('device', { device });
  });
  discovery.on('parseError', (err) => send('parseError', { message: err.message }));
  discovery.on('error', (err) => send('error', { message: err.message }));
  discovery.on('done', () => {
    // Not ws.close() — the connection stays open to keep receiving
    // whatever the background auto-discovery loop finds next (see
    // broadcastToClients above), mirroring the native-messaging host
    // transport staying connected until the extension calls stop().
    send('done', {});
  });

  ws.on('close', () => {
    connectedClients.delete(ws);
    discovery.stop();
  });

  discovery.start();
}

setAutoDiscoveryEnabled(AUTO_DISCOVERY_DEFAULT);

const httpServer = http.createServer(handleRequest);
const wssHttp = new WebSocketServer({ server: httpServer, path: '/discover' });
wssHttp.on('connection', handleWsConnection);

httpServer.listen(HTTP_PORT, () => {
  console.log(`[server] UI         http://localhost:${HTTP_PORT}/`);
  console.log(`[server] HTTP GET   http://localhost:${HTTP_PORT}/discover`);
  console.log(`[server] WebSocket  ws://localhost:${HTTP_PORT}/discover`);
  console.log(`[server] Settings   http://localhost:${HTTP_PORT}/settings`);
});

// HTTPS on the same routes, self-signed dev cert — lets this page and its
// wss:// discovery connection be exercised over HTTPS too, mirroring the
// rtsp-over-websocket repo's own demo server's dual-port pattern. Note
// this is a separate concern from an HTTPS *camera*'s own self-signed
// cert (SUNAPI calls go straight from the browser to the camera, not
// through this server) — that still needs its own one-time browser
// exception, visiting https://<camera-ip>:<port>/ directly. Falls back to
// HTTP-only if openssl isn't available.
if (ensureSelfSignedCert()) {
  const tlsOptions = { key: fs.readFileSync(CERT_KEY_PATH), cert: fs.readFileSync(CERT_CRT_PATH) };
  const httpsServer = https.createServer(tlsOptions, handleRequest);
  const wssHttps = new WebSocketServer({ server: httpsServer, path: '/discover' });
  wssHttps.on('connection', handleWsConnection);

  httpsServer.listen(HTTPS_PORT, () => {
    console.log(`[server] UI         https://localhost:${HTTPS_PORT}/  (self-signed — accept the browser warning once)`);
    console.log(`[server] HTTPS GET  https://localhost:${HTTPS_PORT}/discover`);
    console.log(`[server] WebSocket  wss://localhost:${HTTPS_PORT}/discover`);
    console.log(`[server] Settings   https://localhost:${HTTPS_PORT}/settings`);
  });
}
