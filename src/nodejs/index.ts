'use strict';

const { UDPDiscovery } = require('./udpDiscovery');

const TIMEOUT_MS = 5000;

const discovery = new UDPDiscovery();

discovery.on('listening', () => {
  console.log(`[UDP] Listening for camera responses on port 7711...`);
});

discovery.on('sent', () => {
  console.log(`[UDP] Discovery broadcast sent → 255.255.255.255:7701`);
  console.log(`[UDP] Waiting ${TIMEOUT_MS / 1000}s for responses...`);
});

discovery.on('scanExtConfirmed', (resp) => {
  console.log(`[UDP] Confirmed DEF_RES_SCAN_EXT (nMode=${resp.nMode}) from ${resp.rinfo.address} — DEF_REQ_SCAN_EXT (6) request/response round-trip verified.`);
});

discovery.on('device', (cam) => {
  console.log('[FOUND]', {
    name:    cam.chDeviceNameNew || cam.chDeviceName,
    ip:      cam.chIP,
    mac:     cam.chMac,
    url:     cam.url,
    rtsp:    cam.rtspUrl,
    model:   cam.modelType,
    sunapi:  !!cam.isSupportSunapi,
  });
});

discovery.on('error', (err) => {
  console.error('[ERROR]', err.message);
  if (err.code === 'EACCES') {
    console.error('  → Port 7711 requires elevated privileges. Try: sudo node index.js');
  }
  process.exit(1);
});

discovery.on('parseError', (err) => {
  console.warn('[WARN] Failed to parse response packet:', err.message);
});

discovery.start();

setTimeout(() => {
  console.log('[UDP] Discovery complete.');
  discovery.stop();
}, TIMEOUT_MS);
