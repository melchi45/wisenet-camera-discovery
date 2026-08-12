import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Bundles window.ts + its vis/moment/moment-timezone imports into a single
// classic (non-module) script, replacing the separate jQuery/vis/moment/
// moment-timezone <script> tags window.html used to load. Type-checking
// happens separately via `tsc -p tsconfig.window.json --noEmit` (see
// scripts/build.js) — Vite's esbuild-based transform only strips types, it
// doesn't check them.
//
// One build here, copied into BOTH dist/chrome-extension/window.js and
// dist/nodejs/examples/public/window.js by scripts/build.js — window.ts's
// chrome.* call sites are runtime-feature-detected (see its own
// IS_EXTENSION check), not build-time branched, so a single bundle serves
// both consumers.
//
// @melchi45/rtsp-over-websocket stays a SEPARATE <script type="module">
// tag, deliberately not bundled here — see that package's own
// src/player/vite.config.ts for the CSP-breaking Vite worker-asset-inlining
// hazard this avoids re-triggering: re-bundling its prebuilt ESM output
// risks Vite re-analyzing and re-inlining its Worker-referenced vendor
// files (ffmpeg.js/.wasm etc.) as base64 data: URLs, which the extension's
// `script-src 'self' 'wasm-unsafe-eval'` CSP (manifest.json) rejects.
export default defineConfig({
  build: {
    outDir: resolve(__dirname, '../../build/shared'),
    // false, not the default true: build/shared/ also holds socket.ts's
    // separately-compiled output (tsconfig.socket.json, run before this
    // step in scripts/build.js) — emptying this dir here would delete it.
    // scripts/build.js's own top-level `rmrf(build/)` already guarantees
    // a clean start each run, so this isn't needed for that anyway.
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'window.ts'),
      output: {
        format: 'iife',
        entryFileNames: 'window.js',
      },
    },
  },
});
