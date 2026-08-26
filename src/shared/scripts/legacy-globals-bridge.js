// Bridges rtsp-over-websocket's ES module exports to plain globals for
// window.js to use. window.js is a classic (non-module) script — it can't
// `import` these directly — so this tiny module does that once and assigns
// them to `window.*`. Loaded via <script type="module"> in window.html,
// *before* window.js's own <script> tag; module scripts are deferred (run
// after the document is parsed) while window.js's own top-level code only
// defines functions/registers a jQuery-ready handler, so by the time any
// of window.js's functions actually reference these globals (on a later
// user action or 'ready' callback), this has already run. Not bundled/
// copied into the compiled TypeScript output — this file is hand-written
// plain JS, copied as-is by scripts/build.js (see its own comment).
import {
  AuthError,
  SunapiError,
  HTTP_STATUS_CODES,
  toHex,
  fromHex,
  RTSPOverWebSocketBaseError,
  RTSPOverWebSocketPlayType,
  RTSPOverWebSocketPlayState,
  SunapiManager,
  Transport,
} from '../external-lib/rtsp-over-websocket/rtsp-over-websocket.esm.js';

window.AuthError = AuthError;
window.SunapiError = SunapiError;
window.HTTP_STATUS_CODES = HTTP_STATUS_CODES;
window.toHex = toHex;
window.fromHex = fromHex;
window.RTSPOverWebSocketBaseError = RTSPOverWebSocketBaseError;
window.RTSPOverWebSocketPlayType = RTSPOverWebSocketPlayType;
window.RTSPOverWebSocketPlayState = RTSPOverWebSocketPlayState;
window.SunapiManager = SunapiManager;
// Base class for the "Bypass Untrusted Certificate" WebSocket relay — see
// scripts/nativeWebSocketTransport.ts and docs/native-https-proxy/DESIGN.md.
// Subclassed there (extends Transport, overriding just the protected
// createWebSocket() factory method) rather than imported as a real ES
// module value in that Vite-bundled file, for the same CSP/Worker-asset
// re-inlining reason this whole file exists instead of a normal import —
// see this repo's MEMORY.md "@melchi45/rtsp-over-websocket stays
// un-bundled" entry.
window.Transport = Transport;
