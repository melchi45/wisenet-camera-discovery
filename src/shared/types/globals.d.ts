// vis@4.20.1-SNAPSHOT (window.ts's `import * as vis from 'vis'`) has no
// .d.ts of its own and no @types/vis package for this old a version —
// deliberately `any`-typed rather than hand-typing its API surface, same
// "first TypeScript pass" scope note as this file's other entries (see
// tsconfig.base.json). moment/moment-timezone ship their own real .d.ts
// files and need no shim here.
declare module 'vis' {
  const vis: any;
  export = vis;
}

// scripts/socket.ts's own `var socket = {...}` (see its declaration there)
// — loaded as a separate classic <script> tag in window.html, before
// window.js. Under the old single `tsc -p tsconfig.extension.json`
// compile (module: "none"), window.ts and socket.ts shared one global
// scope, so this needed no separate declaration; window.ts now
// type-checks on its own (tsconfig.window.json, module: "ESNext" — see
// vite.config.ts), so it's declared ambiently here instead.
declare var socket: any;

// scripts/socket.ts's own runtime feature-detection (`typeof chrome !==
// 'undefined' && ...`) — true in the Chrome extension, false in the
// nodejs example server's plain browser page. Computed once there,
// reused here by window.ts's own chrome.* call sites for the same
// classic-global-script reason `socket` is declared above.
declare var IS_EXTENSION: boolean;

// scripts/socket.ts's list of "player" extension IDs to forward discovery
// results to (see socket.ts's onDevice/start) — the actual list lives in
// scripts/player-extension-ids.json, not hardcoded in socket.ts itself.
// This bare identifier type-checks/autocompletes as a real string[] here;
// scripts/build.js replaces the token itself with a literal array (from
// that JSON file) in the compiled output — see its
// substitutePlayerExtensionIds.
declare var __PLAYER_EXTENSION_IDS__: string[];

// rtsp-over-websocket player library (external-lib/rtsp-over-websocket/
// rtsp-over-websocket.esm.js — an ES module, loaded via <script
// type="module"> in window.html), replacing the old UMP vendor script
// stack window.js used to depend on. window.js itself is a classic
// (non-module) script, so it can't `import` these named exports directly;
// a small bridge module (see window.html) imports them and assigns them
// to these globals before window.js's functions that use them ever run.
// Real shapes live in that package's src/player/exceptions, src/player/util,
// src/player/network, src/player/elements/RTSPOverWebSocketTypes.ts — `any`
// here for the same "first TS pass" reason as this file's other entries.
declare var RTSPOverWebSocketPlayState: any;
declare var RTSPOverWebSocketPlayType: any;
declare var AuthError: any;
declare var SunapiError: any;
declare var HTTP_STATUS_CODES: any;
declare var RTSPOverWebSocketBaseError: any;
declare function toHex(...args: any[]): any;
declare function fromHex(...args: any[]): any;
declare class SunapiManager {
  constructor();
  [key: string]: any;
}

// scripts/nativeWebSocketTransport.ts's NativeTransport extends this (see
// legacy-globals-bridge.js's own comment on why it's a global here instead
// of a real ES module import into that Vite-bundled file). `[key: string]:
// any` for the same "first TS pass" looseness as SunapiManager above —
// the real shape (Connect/Disconnect/SendRtspCommand/SendRtpData/etc., see
// TransportLike in rtsp-over-websocket's own RtspClient.ts) isn't
// re-declared here since NativeTransport only ever overrides the one
// protected method it needs to (createWebSocket), inheriting everything
// else from the real runtime class untouched.
declare class Transport {
  constructor(serverAddr: string);
  [key: string]: any;
}

// background.ts runs as a classic (non-module) MV3 service worker — the
// "DOM" lib above (needed by window.ts/socket.ts) doesn't include the
// WebWorker-only importScripts(), so it's declared ambiently here instead
// of switching this shared compile to the (DOM-incompatible) "WebWorker" lib.
declare function importScripts(...urls: string[]): void;

// window.js reads/writes DOM-element properties (`.value`, `.checked`,
// `.disabled`, `<rtsp-over-websocket>`'s custom `.playType`/`.filename`/
// `.backup()`/`.device`, etc.) straight off whatever `document.getElementById()` /
// `document.querySelector()` returns, without narrowing to
// HTMLInputElement/the custom element's own type first — harmless at
// runtime (the real DOM objects have these members), but the base
// Element/HTMLElement lib types don't. Loosened here rather than adding a
// cast at each of the ~60 call sites — see globals.d.ts's file-level scope
// note.
interface Element {
  value: any;
  checked: any;
  disabled: any;
  src: any;
  innerText: any;
  playType: any;
  filename: any;
  backup: any;
  device: any;
  min: any;
  max: any;
  ismute: any;
}

interface Window {
  // window.ts's own `window.popup`/`window.capture` (see their
  // definitions near the bottom of the file) — custom alert-style/capture
  // helpers, unrelated to any standard DOM API.
  popup: any;
  capture: any;
}

interface Number {
  // `Number.prototype.pad = function (size) {...}` — window.js's own
  // zero-padding helper, monkey-patched onto Number (see its definition).
  pad(size?: number): string;
}

interface DOMException {
  // window.js reads `error.errorCode`/`error.uri` off caught DOMExceptions
  // in a few `catch` blocks — not part of the standard DOMException shape,
  // presumably thrown that way by the UMP vendor library in practice.
  errorCode: any;
  uri: any;
}
