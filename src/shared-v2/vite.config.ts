import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Mirrors src/shared/vite.config.ts exactly (same reasoning: window.ts's
// vis/moment/moment-timezone imports bundled into one classic IIFE script;
// @melchi45/rtsp-over-websocket stays a separate <script type="module">
// tag for the same CSP/Worker-asset re-inlining reason) — see that file's
// own comments, not repeated here. Separate outDir so this preview build
// never collides with the real src/shared/ build output.
export default defineConfig({
  build: {
    outDir: resolve(__dirname, '../../build/shared-v2'),
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
