#!/usr/bin/env node
// socket.ts declares `playerExtensionIds: __PLAYER_EXTENSION_IDS__` (a
// bare identifier — see src/shared/types/globals.d.ts's ambient `declare
// var __PLAYER_EXTENSION_IDS__: string[]` for why it type-checks as-is)
// rather than hardcoding the ID list inline, so the list can live in its
// own editable JSON file (src/shared/scripts/player-extension-ids.json).
// tsc has no idea this token is special — it just emits it unchanged —
// so after compiling socket.ts, this replaces the literal token text
// with the real array as a JSON literal, the same template-substitution
// idiom native-host/install-host.sh/ps1 use for
// @HOST_PATH@/@EXTENSION_ID@.
//
// Usage: node scripts/substitute-player-extension-ids.js <compiled-socket.js-path>
// Called from both scripts/build.js (npm run build) and package.json's
// build:extension script — socket.ts is compiled in both places.

'use strict';

const fs = require('fs');
const path = require('path');

const compiledSocketJsPath = process.argv[2];
if (!compiledSocketJsPath) {
  console.error('Usage: node scripts/substitute-player-extension-ids.js <compiled-socket.js-path>');
  process.exit(1);
}

const idsPath = path.join(__dirname, '..', 'src', 'shared', 'scripts', 'player-extension-ids.json');
const parsed = JSON.parse(fs.readFileSync(idsPath, 'utf8'));
const ids = parsed.player_extension_ids;
if (!Array.isArray(ids)) {
  throw new Error(`substitute-player-extension-ids: ${idsPath} must be a JSON object with a "player_extension_ids" array — got ${JSON.stringify(parsed)}`);
}
const original = fs.readFileSync(compiledSocketJsPath, 'utf8');
const token = '__PLAYER_EXTENSION_IDS__';
if (!original.includes(token)) {
  throw new Error(`substitute-player-extension-ids: token '${token}' not found in ${compiledSocketJsPath} — did socket.ts's playerExtensionIds declaration change?`);
}
fs.writeFileSync(compiledSocketJsPath, original.split(token).join(JSON.stringify(ids)));
