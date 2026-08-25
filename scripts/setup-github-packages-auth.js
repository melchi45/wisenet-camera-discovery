#!/usr/bin/env node
// One-time local setup: writes/updates the repo-root .npmrc so `npm
// install` can resolve @melchi45-scoped GitHub Packages dependencies
// (currently @melchi45/rtsp-over-websocket) and, if you're publishing
// dist/nodejs/ yourself rather than leaving that to CI, `npm publish` can
// reach the same registry.
//
// Usage: node scripts/setup-github-packages-auth.js <PAT>
// (or set GH_PACKAGES_TOKEN in the environment and omit the argument)
//
// The PAT needs `read:packages` (installing dependencies) and, if you'll
// also run `npm publish` from dist/nodejs/ locally, `write:packages` too.
// Generate one at https://github.com/settings/tokens.
//
// Why this file matters more than it looks like it should: npm 11+
// defaults `allow-remote` to "none", which blocks installing a dependency
// whose resolved tarball host doesn't match its *configured* registry
// host. Without the `@melchi45:registry=` line below, npm compares
// against the default registry.npmjs.org, the hosts don't match, and
// `npm install` fails with EALLOWREMOTE — a confusing error whose actual
// cause is just a missing/incomplete .npmrc, not anything wrong with the
// package itself.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NPMRC_PATH = path.join(ROOT, '.npmrc');
const REGISTRY_LINE = '@melchi45:registry=https://npm.pkg.github.com';
const TOKEN_LINE_PREFIX = '//npm.pkg.github.com/:_authToken=';

const token = process.argv[2] || process.env.GH_PACKAGES_TOKEN;
if (!token) {
  console.error('usage: node scripts/setup-github-packages-auth.js <PAT>');
  console.error('  (or set GH_PACKAGES_TOKEN in the environment)');
  process.exit(1);
}

const existingLines = fs.existsSync(NPMRC_PATH)
  ? fs.readFileSync(NPMRC_PATH, 'utf8').split('\n').filter(Boolean)
  : [];

// Drop any prior @melchi45 registry/token lines before re-adding — keeps
// this idempotent instead of accumulating stale/duplicate entries on
// repeated runs (duplicates are exactly the kind of thing that produces
// the "which one does npm actually use" confusion this script exists to
// avoid).
const keptLines = existingLines.filter(
  (line) => !line.startsWith('@melchi45:registry=') && !line.startsWith(TOKEN_LINE_PREFIX)
);

const newContent = [...keptLines, REGISTRY_LINE, `${TOKEN_LINE_PREFIX}${token}`].join('\n') + '\n';
// 0o600: this file contains a bearer token.
fs.writeFileSync(NPMRC_PATH, newContent, { mode: 0o600 });

console.log(`${path.relative(ROOT, NPMRC_PATH)} updated — @melchi45 packages now resolve via GitHub Packages.`);
console.log('Run `npm install` next.');
