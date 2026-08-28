#!/usr/bin/env node
// Generic static-file + WS /discover server used by the Playwright
// equivalence suite (tests/window-ui-equivalence/) to serve BOTH the
// original page (dist/nodejs/examples/public/) and the new one
// (dist/shared-v2-preview/) on separate ports, with identical fixture
// discovery data pushed over WS -- see src/shared/scripts/socket.ts's
// WebSocket transport (reused unmodified by both pages) for the exact
// message shape this replays ({type: "device", device: {...}}).
//
// Real UDP broadcast discovery (src/nodejs/examples/server.ts's own
// UDPDiscovery-backed server) doesn't work from this sandbox (see
// CLAUDE.md's WSL2 networking note) and would be nondeterministic even if
// it did -- fixed fixture devices here give both pages the exact same
// discovery data, which is what an equivalence test actually needs.
//
// Usage: node tools/equivalence-test-server/server.js <publicDir> <port> <mockSunapiPort>

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PUBLIC_DIR = path.resolve(process.argv[2]);
const PORT = Number(process.argv[3]);
const MOCK_SUNAPI_PORT = Number(process.argv[4]);

if (!PUBLIC_DIR || !PORT || !MOCK_SUNAPI_PORT) {
  console.error('Usage: server.js <publicDir> <port> <mockSunapiPort>');
  process.exit(1);
}

const WINDOW_HTML_PATH = path.join(PUBLIC_DIR, 'window.html');

// Two fixture devices (one camera, one nvr), in the RAW discovery-reply
// shape (chDeviceName/chIP/chMac/httpType/nHttpPort/...) -- this is what
// `message.device` actually carries over the wire (see
// src/sunapi/response.ts's toLegacyDeviceObject(), and
// src/shared/scripts/socket.ts's onHostMessage -> onDevice -> displayResult,
// which is what CONVERTS this into the {DeviceName, IPAddress, MACAddress,
// Port, URL, Protocol} shape discovery.ts's 'discover' listener consumes --
// sending the already-converted shape here (an earlier draft of this
// fixture did) skips that conversion and breaks displayResult()'s own
// `new URL(data.url)` fallback when `httpType` is absent).
// IPAddress/Port point at the mock-SUNAPI server so clicking a discovery
// row and turning "Use SUNAPI" on drives the real initSunapiManager()
// chain end-to-end.
const FIXTURE_DEVICES = [
  {
    chDeviceName: 'MOCK-CAM-01',
    chIP: '127.0.0.1',
    chMac: 'AA:BB:CC:00:00:01',
    httpType: 0,
    nHttpPort: MOCK_SUNAPI_PORT,
    nHttpsPort: MOCK_SUNAPI_PORT + 1,
    nPort: 4520,
    modelType: 'MOCK-CAMERA',
  },
  {
    chDeviceName: 'MOCK-NVR-01',
    chIP: '127.0.0.2',
    chMac: 'AA:BB:CC:00:00:02',
    httpType: 0,
    nHttpPort: MOCK_SUNAPI_PORT,
    nHttpsPort: MOCK_SUNAPI_PORT + 1,
    nPort: 4520,
    modelType: 'MOCK-NVR',
  },
];

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.json': 'application/json',
};

function serveStaticFile(res, urlPathname) {
  const filePath = path.join(PUBLIC_DIR, urlPathname);
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

// Test-fixture default: OFF, not the real examples/server.ts's `true` --
// keeps #init/#disconnect enabled so the equivalence suite can drive
// discovery deterministically via an explicit #init click rather than
// racing an auto-started session. Both pages read this exact same
// response through the identical FR-1.2 logic either way.
let autoDiscoveryEnabled = false;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/settings') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ autoDiscoveryEnabled }));
      return;
    }
    if (req.method === 'POST') {
      readJsonBody(req).then((body) => {
        if (typeof body.autoDiscoveryEnabled === 'boolean') {
          autoDiscoveryEnabled = body.autoDiscoveryEnabled;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ autoDiscoveryEnabled }));
      }).catch((err) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
      return;
    }
  }

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

  if (req.method === 'GET') {
    serveStaticFile(res, url.pathname);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}

const httpServer = http.createServer(handleRequest);
const wss = new WebSocketServer({ server: httpServer, path: '/discover' });

wss.on('connection', (ws) => {
  const send = (type, payload) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(Object.assign({ type }, payload)));
    }
  };
  send('listening', {});
  send('sent', {});
  for (const device of FIXTURE_DEVICES) {
    send('device', { device });
  }
  send('done', {});
  // Connection stays open afterward (mirrors examples/server.ts) -- no
  // background loop here since the fixture set is static.
});

httpServer.listen(PORT, () => {
  console.log(`[equivalence-server] ${PUBLIC_DIR} -> http://127.0.0.1:${PORT}/`);
});
