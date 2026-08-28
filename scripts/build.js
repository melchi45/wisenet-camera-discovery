#!/usr/bin/env node
// Builds this repo's two independent distributables from src/:
//   dist/chrome-extension/  — a self-contained "Load unpacked" folder
//   dist/nodejs/            — the standalone wisenet-udp-discovery package
//
// Two `tsc` invocations (tsconfig.extension.json / tsconfig.node.json)
// compile the TypeScript; this script then copies the compiled output
// plus untouched static/config files into each dist/ tree. No bundler —
// files still load as separate <script> tags / separate Node modules,
// same as before this repo had a build step at all.
//
// src/sunapi/ is compiled once (as part of the Node build) but copied
// into BOTH dist/chrome-extension/sunapi/ and dist/nodejs/sunapi/ — each
// dist/ output must be independently self-contained (one gets zipped/
// loaded unpacked, the other gets npm-published), so neither can point
// outside itself at a shared sunapi/. See src/sunapi/README.md.

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST_EXT = path.join(ROOT, 'dist', 'chrome-extension');
const DIST_NODE = path.join(ROOT, 'dist', 'nodejs');
const BUILD_NODE = path.join(ROOT, 'build', 'node');
const BUILD_SHARED = path.join(ROOT, 'build', 'shared');

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, {
    stdio: 'inherit',
    cwd: ROOT,
    shell: process.platform === 'win32',
  });
}

// Under WSL, this repo lives on a DrvFs mount (/mnt/<drive>/...), where
// real-time antivirus (e.g. Windows Defender) transiently locks files as
// they're written/deleted — surfacing to Linux as ENOENT/EACCES/ENOTEMPTY/
// "Permission denied" on operations that are actually fine a moment later.
// Trees with many small files (external-lib/font-awesome's few hundred
// icon pages) hit this reliably. Retrying with backoff rides it out;
// there's no way to avoid the race up front, since the lock is held by a
// process outside our control.
function retryOnTransientFsError(fn, description) {
  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      fn();
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      console.warn(`  (retrying after transient error: ${description}, attempt ${attempt}/${maxAttempts})`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * attempt);
    }
  }
}

function rmrf(target) {
  if (!fs.existsSync(target)) return;
  // Shelling out to the native `rm -rf` (rather than fs.rmSync) sidesteps
  // Node's own DrvFs handling issues; the retry wrapper above handles the
  // rest (see its comment).
  retryOnTransientFsError(
    () => execFileSync('rm', ['-rf', target]),
    path.relative(ROOT, target)
  );
}

/** Copies a single file, creating its destination directory first. */
function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  retryOnTransientFsError(
    () => fs.copyFileSync(src, dest),
    path.relative(ROOT, src)
  );
}

/** Copies a directory tree; no-ops (with a warning) if src doesn't exist. */
function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`  (skipping missing directory: ${path.relative(ROOT, src)})`);
    return;
  }
  // Shelling out to `cp -r` (rather than fs.cpSync) for the same reason as
  // rmrf above. Copies `src/.` (contents, not the dir itself) into a
  // pre-created `dest`, so a retry after a partial failure merges back in
  // rather than nesting src's copy one level deeper inside dest. mkdir is
  // *inside* the retry, not just the cp — mkdirSync runs in this process,
  // cp runs as a separate child process, and on DrvFs a dir the former
  // just created isn't reliably visible yet to the latter.
  retryOnTransientFsError(
    () => {
      fs.mkdirSync(dest, { recursive: true });
      // NOT path.join(src, '.') — path.join normalizes away a trailing
      // "/." segment, silently turning this back into `cp -r src dest`
      // (which nests src *inside* dest instead of merging its contents
      // into dest). Plain string concatenation preserves the "/.".
      execFileSync('cp', ['-r', `${src}/.`, dest]);
    },
    path.relative(ROOT, src)
  );
}

// tsc copies require('...sunapi/...') strings into compiled output
// unchanged — it doesn't rewrite module specifiers, so whatever relative
// depth was correct in src/ (where sunapi/ sits one level up from
// src/nodejs/ and two levels up from src/chrome-extension/native-host/)
// gets baked verbatim into the .js. But each dist/ output nests its own
// copy of compiled sunapi/ *inside* itself (see this file's top comment),
// one directory level shallower than src/'s layout — so the baked-in
// require() path is wrong by exactly one `../` once copied into dist/.
// Fixed up here rather than restructuring src/ (sunapi/ needs to stay a
// plain top-level sibling there, shared by both dist targets — see
// sunapi/README.md) or dist/ (each output's sunapi/ needs to stay nested
// for npm-publish/"Load unpacked" self-containment).
function fixSunapiRequirePaths(filePath, fromPrefix, toPrefix) {
  const original = fs.readFileSync(filePath, 'utf8');
  const fixed = original.split(`require('${fromPrefix}`).join(`require('${toPrefix}`);
  if (fixed === original) {
    throw new Error(`fixSunapiRequirePaths: no '${fromPrefix}' require found in ${filePath} — did the source module's require path change?`);
  }
  fs.writeFileSync(filePath, fixed);
}


// src/shared/ (window.html/window.ts/socket.ts/css/legacy-globals-bridge.js)
// plus its vis.css and rtsp-over-websocket vendor dependencies — copied
// identically into both dist/chrome-extension/ and
// dist/nodejs/examples/public/ (see the buildExtension/buildNode sections
// below), since window.ts's chrome.* call sites are runtime-feature-
// detected rather than built differently per target. destDir is either
// DIST_EXT or DIST_NODE's examples/public/.
function copySharedWebAssets(destDir) {
  copyFile(
    path.join(ROOT, 'src', 'shared', 'window.html'),
    path.join(destDir, 'window.html')
  );
  // Vite's bundled output (window.ts + vis/moment/moment-timezone) and the
  // separately-compiled socket.ts (classic global script — see
  // tsconfig.socket.json) — both built once above, copied to every
  // consumer.
  copyFile(
    path.join(BUILD_SHARED, 'window.js'),
    path.join(destDir, 'window.js')
  );
  copyFile(
    path.join(BUILD_SHARED, 'scripts', 'socket.js'),
    path.join(destDir, 'scripts', 'socket.js')
  );
  // Hand-written plain ES module (not part of the tsc compile — see its own
  // top comment), copied as-is.
  copyFile(
    path.join(ROOT, 'src', 'shared', 'scripts', 'legacy-globals-bridge.js'),
    path.join(destDir, 'scripts', 'legacy-globals-bridge.js')
  );
  copyDir(path.join(ROOT, 'src', 'shared', 'css'), path.join(destDir, 'css'));
  // src/component/ lives outside src/shared/ (reusable UI components, not
  // shared-page-specific) so it isn't picked up by the copyDir above --
  // see docs/switch-component/ / docs/disclosure-component/.
  copyFile(
    path.join(ROOT, 'src', 'component', 'switch', 'switch.css'),
    path.join(destDir, 'css', 'switch.css')
  );
  copyFile(
    path.join(ROOT, 'src', 'component', 'disclosure', 'disclosure.css'),
    path.join(destDir, 'css', 'disclosure.css')
  );
  // vis.js and moment/moment-timezone are bundled directly into window.js
  // by Vite — only vis.css (kept as a separate <link>, not worth pulling
  // into the JS bundle) still needs copying from node_modules/.
  copyFile(
    path.join(ROOT, 'node_modules', 'vis', 'dist', 'vis.css'),
    path.join(destDir, 'external-lib', 'vis', 'vis.css')
  );
  // vis.css's background-image: url("img/...") rules resolve relative to
  // itself, so img/ has to sit alongside it in dist/ too.
  copyDir(
    path.join(ROOT, 'node_modules', 'vis', 'dist', 'img'),
    path.join(destDir, 'external-lib', 'vis', 'img')
  );
  // @melchi45/rtsp-over-websocket is a real npm package (see package.json) —
  // pulled straight from node_modules/ and kept as a separate <script
  // type="module"> tag, not bundled by Vite (see vite.config.ts's own
  // comment for why).
  copyFile(
    path.join(ROOT, 'node_modules', '@melchi45', 'rtsp-over-websocket', 'dist', 'player', 'rtsp-over-websocket.esm.js'),
    path.join(destDir, 'external-lib', 'rtsp-over-websocket', 'rtsp-over-websocket.esm.js')
  );
  copyDir(
    path.join(ROOT, 'node_modules', '@melchi45', 'rtsp-over-websocket', 'dist', 'player', 'assets'),
    path.join(destDir, 'external-lib', 'rtsp-over-websocket', 'assets')
  );
  // The decoder/transcoder/zip Worker chunks under assets/ load these via
  // `new URL('../xxx', import.meta.url)` — i.e. relative to their own
  // assets/ directory, one level up — so they need to sit right next to
  // assets/ here, not inside it. (As of rtsp-over-websocket 1.0.4: moved out
  // of assets/'s base64-inlined-into-the-chunk form, which broke under this
  // extension's CSP — see that package's MEMORY.md for the full story.)
  //
  // This list is a hardcoded snapshot, not derived from the package — it
  // silently went stale once already (`ffmpegAAC.decoder.js` shipped in the
  // package but was missing here, surfacing as a runtime
  // net::ERR_FILE_NOT_FOUND only once something actually exercised the AAC
  // decode path — see MEMORY.md). After bumping
  // @melchi45/rtsp-over-websocket, diff this list against `ls
  // node_modules/@melchi45/rtsp-over-websocket/dist/player/` (excluding
  // `assets/`, the two `.esm.js`/`.global.js`/`-react.esm.js` bundles
  // already handled above, and anything not actually referenced by a
  // `new URL(...)` in this shape) rather than assuming it's still complete.
  for (const vendorFile of ['ffmpeg.js', 'ffmpeg.wasm', 'ffmpegAAC.decoder.js', 'ffmpegAAC.transcoder.js', 'ffmpegAAC.transcoder.wasm', 'minizip-asm.js']) {
    copyFile(
      path.join(ROOT, 'node_modules', '@melchi45', 'rtsp-over-websocket', 'dist', 'player', vendorFile),
      path.join(destDir, 'external-lib', 'rtsp-over-websocket', vendorFile)
    );
  }
}

// docs/window-ui/ — a from-scratch, independently-tested reimplementation
// of src/shared/, built alongside it (never replacing it) purely to prove
// docs/window-ui/SRS.md's completeness via Playwright equivalence tests
// (see docs/window-ui/PRD.md's Success Criteria). Deliberately a SEPARATE
// build target ('shared-v2', not part of 'all'/'extension'/'node') so a
// problem in this new/experimental code can never affect the real product
// build — see docs/window-ui/MRD.md's "parallel, not in-place" reasoning.
// Mirrors copySharedWebAssets() above exactly, source directory swapped.
function buildSharedV2() {
  const BUILD_SHARED_V2 = path.join(ROOT, 'build', 'shared-v2');
  const DIST_SHARED_V2 = path.join(ROOT, 'dist', 'shared-v2-preview');

  console.log('Cleaning previous dist/shared-v2-preview/ output...');
  rmrf(DIST_SHARED_V2);

  console.log('Type-checking shared-v2 window.ts...');
  run('npx', ['tsc', '-p', path.join('src', 'shared-v2', 'tsconfig.window.json')]);
  console.log('Bundling shared-v2 window.ts with Vite...');
  run('npx', ['vite', 'build', '--config', path.join('src', 'shared-v2', 'vite.config.ts')]);

  console.log('Compiling shared socket.ts (reused unmodified from src/shared/)...');
  run('npx', ['tsc', '-p', path.join('src', 'shared', 'tsconfig.socket.json'), '--outDir', BUILD_SHARED_V2]);
  run('node', [path.join('scripts', 'substitute-player-extension-ids.js'), path.join(BUILD_SHARED_V2, 'scripts', 'socket.js')]);

  console.log('Assembling dist/shared-v2-preview/...');
  copyFile(
    path.join(ROOT, 'src', 'shared-v2', 'window.html'),
    path.join(DIST_SHARED_V2, 'window.html')
  );
  copyFile(
    path.join(BUILD_SHARED_V2, 'window.js'),
    path.join(DIST_SHARED_V2, 'window.js')
  );
  copyFile(
    path.join(BUILD_SHARED_V2, 'scripts', 'socket.js'),
    path.join(DIST_SHARED_V2, 'scripts', 'socket.js')
  );
  copyFile(
    path.join(ROOT, 'src', 'shared', 'scripts', 'legacy-globals-bridge.js'),
    path.join(DIST_SHARED_V2, 'scripts', 'legacy-globals-bridge.js')
  );
  // Reused unmodified, same CSS as src/shared/ -- see docs/window-ui/PRD.md's
  // Non-Goals (not a visual redesign).
  copyDir(path.join(ROOT, 'src', 'shared', 'css'), path.join(DIST_SHARED_V2, 'css'));
  copyFile(
    path.join(ROOT, 'src', 'component', 'switch', 'switch.css'),
    path.join(DIST_SHARED_V2, 'css', 'switch.css')
  );
  copyFile(
    path.join(ROOT, 'src', 'component', 'disclosure', 'disclosure.css'),
    path.join(DIST_SHARED_V2, 'css', 'disclosure.css')
  );
  copyFile(
    path.join(ROOT, 'node_modules', 'vis', 'dist', 'vis.css'),
    path.join(DIST_SHARED_V2, 'external-lib', 'vis', 'vis.css')
  );
  copyDir(
    path.join(ROOT, 'node_modules', 'vis', 'dist', 'img'),
    path.join(DIST_SHARED_V2, 'external-lib', 'vis', 'img')
  );
  copyFile(
    path.join(ROOT, 'node_modules', '@melchi45', 'rtsp-over-websocket', 'dist', 'player', 'rtsp-over-websocket.esm.js'),
    path.join(DIST_SHARED_V2, 'external-lib', 'rtsp-over-websocket', 'rtsp-over-websocket.esm.js')
  );
  copyDir(
    path.join(ROOT, 'node_modules', '@melchi45', 'rtsp-over-websocket', 'dist', 'player', 'assets'),
    path.join(DIST_SHARED_V2, 'external-lib', 'rtsp-over-websocket', 'assets')
  );
  for (const vendorFile of ['ffmpeg.js', 'ffmpeg.wasm', 'ffmpegAAC.decoder.js', 'ffmpegAAC.transcoder.js', 'ffmpegAAC.transcoder.wasm', 'minizip-asm.js']) {
    copyFile(
      path.join(ROOT, 'node_modules', '@melchi45', 'rtsp-over-websocket', 'dist', 'player', vendorFile),
      path.join(DIST_SHARED_V2, 'external-lib', 'rtsp-over-websocket', vendorFile)
    );
  }

  console.log('Build complete:');
  console.log(`  ${path.relative(ROOT, DIST_SHARED_V2)}/`);
}

if (process.argv[2] === 'shared-v2') {
  buildSharedV2();
  process.exit(0);
}

// `node scripts/build.js` (no args) builds both dist/ outputs, same as
// always. `node scripts/build.js extension` / `node scripts/build.js node`
// build just one side — used by `npm run start:server`, which still skips
// the chrome-extension-only pieces (manifest.json, icons/, native-host/),
// but both targets now need src/shared/'s compile (window.html/window.ts/
// socket.ts and their vis/moment/rtsp-over-websocket assets), since the
// Node example server's page is the same shared build as the extension's.
const target = process.argv[2] || 'all';
if (!['all', 'extension', 'node'].includes(target)) {
  throw new Error(`unknown build target '${target}' (expected 'all', 'extension', or 'node')`);
}
const buildExtension = target === 'all' || target === 'extension';
const buildNode = target === 'all' || target === 'node';
const buildShared = buildExtension || buildNode;

console.log('Cleaning previous build output...');
if (buildExtension) rmrf(DIST_EXT);
if (buildNode) rmrf(DIST_NODE);
rmrf(path.join(ROOT, 'build'));

if (buildExtension) {
  console.log('Compiling chrome-extension TypeScript...');
  run('npx', ['tsc', '-p', 'tsconfig.extension.json']);
}

if (buildShared) {
  console.log('Compiling shared socket.ts...');
  run('npx', ['tsc', '-p', path.join('src', 'shared', 'tsconfig.socket.json')]);
  run('node', [path.join('scripts', 'substitute-player-extension-ids.js'), path.join(BUILD_SHARED, 'scripts', 'socket.js')]);
  // window.ts is excluded from tsconfig.extension.json's `include` (it's
  // bundled by Vite below, which doesn't type-check) — checked separately.
  console.log('Type-checking shared window.ts...');
  run('npx', ['tsc', '-p', path.join('src', 'shared', 'tsconfig.window.json')]);
  console.log('Bundling window.ts (+ vis/moment/moment-timezone) with Vite...');
  run('npx', ['vite', 'build', '--config', path.join('src', 'shared', 'vite.config.ts')]);
}

console.log('Compiling Node.js TypeScript (sunapi/, nodejs/, native-host)...');
run('npx', ['tsc', '-p', 'tsconfig.node.json']);

if (buildExtension) {
console.log('Assembling dist/chrome-extension/...');
copyFile(
  path.join(ROOT, 'src', 'chrome-extension', 'manifest.json'),
  path.join(DIST_EXT, 'manifest.json')
);
copySharedWebAssets(DIST_EXT);

// native-host: compiled wisenet-udp-host.js + the untouched non-TS files
// that ship alongside it (install scripts, .bat launcher, template, docs).
copyFile(
  path.join(BUILD_NODE, 'chrome-extension', 'native-host', 'wisenet-udp-host.js'),
  path.join(DIST_EXT, 'native-host', 'wisenet-udp-host.js')
);
// src/chrome-extension/native-host/ -> src/sunapi/ is '../../sunapi/';
// dist/chrome-extension/native-host/ -> dist/chrome-extension/sunapi/ is
// one level shallower, '../sunapi/' — see fixSunapiRequirePaths above.
fixSunapiRequirePaths(
  path.join(DIST_EXT, 'native-host', 'wisenet-udp-host.js'),
  '../../sunapi/',
  '../sunapi/'
);
for (const file of [
  'wisenet-udp-host.bat',
  'install-host.ps1',
  'install-host.sh',
  'com.wisenet.ipinstaller.json.template',
  'README.md',
]) {
  copyFile(
    path.join(ROOT, 'src', 'chrome-extension', 'native-host', file),
    path.join(DIST_EXT, 'native-host', file)
  );
}

// sunapi/ — compiled once above, copied in as a self-contained duplicate.
copyDir(path.join(BUILD_NODE, 'sunapi'), path.join(DIST_EXT, 'sunapi'));

// Manifest icons — extension-only (window.html doesn't reference these).
copyDir(path.join(ROOT, 'src', 'chrome-extension', 'icons'), path.join(DIST_EXT, 'icons'));
}

if (buildNode) {
console.log('Assembling dist/nodejs/...');
copyDir(path.join(BUILD_NODE, 'nodejs'), DIST_NODE);
// src/nodejs/ -> src/sunapi/ is '../sunapi/'; dist/nodejs/ ->
// dist/nodejs/sunapi/ is one level shallower, './sunapi/' — see
// fixSunapiRequirePaths above.
fixSunapiRequirePaths(
  path.join(DIST_NODE, 'udpDiscovery.js'),
  '../sunapi/',
  './sunapi/'
);
copyFile(
  path.join(ROOT, 'src', 'nodejs', 'package.json'),
  path.join(DIST_NODE, 'package.json')
);
copyFile(
  path.join(ROOT, 'src', 'nodejs', 'README.md'),
  path.join(DIST_NODE, 'README.md')
);
// Template only — never a real .env (gitignored, and this whole
// directory is wiped by npm run clean anyway). Lets the documented
// `cd dist/nodejs && cp .env.example .env` workflow work without going
// back up to the repo root — see src/nodejs/README.md's "Example server"
// section and examples/loadEnv.ts.
copyFile(
  path.join(ROOT, '.env.example'),
  path.join(DIST_NODE, '.env.example')
);
// The example server's page is the same src/shared/ build the extension
// uses (see copySharedWebAssets) — window.ts's chrome.* call sites detect
// they're not running inside an extension and fall back to WebSocket/
// fetch() equivalents (see socket.ts's IS_EXTENSION branch).
copySharedWebAssets(path.join(DIST_NODE, 'examples', 'public'));
copyDir(path.join(BUILD_NODE, 'sunapi'), path.join(DIST_NODE, 'sunapi'));
}

console.log('Build complete:');
if (buildExtension) console.log(`  ${path.relative(ROOT, DIST_EXT)}/`);
if (buildNode) console.log(`  ${path.relative(ROOT, DIST_NODE)}/`);
