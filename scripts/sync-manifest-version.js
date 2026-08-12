#!/usr/bin/env node
// Stamps package.json's "version" onto src/chrome-extension/manifest.json
// before a release build, so the packaged extension's version always
// matches the npm package version instead of being bumped by hand in two
// places. Chrome's manifest "version" only allows up to four dot-separated
// integers (no semver prerelease/build suffixes) — see
// https://developer.chrome.com/docs/extensions/reference/manifest/version —
// so a version like "1.2.0-beta.1" is rejected here rather than silently
// truncated.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const MANIFEST_PATH = path.join(ROOT, 'src', 'chrome-extension', 'manifest.json');

const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
const version = pkg.version;

if (!/^\d+(\.\d+){0,3}$/.test(version)) {
  throw new Error(
    `package.json version "${version}" isn't a valid Chrome extension version ` +
    `(1-4 dot-separated non-negative integers, no prerelease/build suffix).`
  );
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
manifest.version = version;
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');

console.log(`src/chrome-extension/manifest.json version set to ${version}`);
