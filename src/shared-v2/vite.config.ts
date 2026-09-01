import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Mirrors src/shared/vite.config.ts exactly (same reasoning: window.ts's
// vis/moment/moment-timezone imports bundled into one classic IIFE script;
// @melchi45/rtsp-over-websocket stays a separate <script type="module">
// tag for the same CSP/Worker-asset re-inlining reason) — see that file's
// own comments, not repeated here. Separate outDir so this preview build
// never collides with the real src/shared/ build output.
//
// `npm run build:shared-v2:dev` (scripts/build.js's buildSharedV2({ dev:
// true })) passes `--mode development` through to this `vite build`, which
// this config reads to skip minification for fully readable output — see
// src/player/vite.config.ts in the rtsp-over-websocket package for the same
// pattern. Sourcemaps are unconditional (both `build:shared-v2` and
// `build:shared-v2:dev`): a minified bundle with a sourcemap is already
// enough for the browser debugger to step through the original module.ts
// files instead of the bundled window.js.
export default defineConfig(({ mode }) => ({
  build: {
    outDir: resolve(__dirname, '../../build/shared-v2'),
    emptyOutDir: false,
    sourcemap: true,
    minify: mode !== 'development',
    rollupOptions: {
      input: resolve(__dirname, 'window.ts'),
      output: {
        format: 'iife',
        entryFileNames: 'window.js',
      },
    },
  },
}));
