#!/usr/bin/env node
// Stamps package.json's "version" onto src/chrome-extension/manifest.json
// before a release build, so the packaged extension's version always
// matches the npm package version instead of being bumped by hand in two
// places. Chrome's manifest "version" only allows up to four dot-separated
// integers (no semver prerelease/build suffixes) — see
// https://developer.chrome.com/docs/extensions/reference/manifest/version —
// so a version like "1.2.0-beta.1" is rejected here rather than silently
// truncated.
//
// Optional argv[2]: a free-form "version_name" (manifest.json's separate,
// unrestricted display-string field — Chrome shows it instead of "version"
// in chrome://extensions when present, but it isn't subject to the same
// numeric-only format). Used by build-extension.yml's manual/beta runs to
// stamp e.g. "1.2.1-beta.abc1234" without touching the strict "version"
// field at all. Omitted (or run with no argv[2]) removes any stale
// version_name instead of leaving one behind — a real tagged release must
// never carry a leftover beta label from an earlier run.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const MANIFEST_PATH = path.join(ROOT, 'src', 'chrome-extension', 'manifest.json');

const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
const version = pkg.version;
const versionName = process.argv[2];

if (!/^\d+(\.\d+){0,3}$/.test(version)) {
  throw new Error(
    `package.json version "${version}" isn't a valid Chrome extension version ` +
    `(1-4 dot-separated non-negative integers, no prerelease/build suffix).`
  );
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
manifest.version = version;
if (versionName) {
  manifest.version_name = versionName;
} else {
  delete manifest.version_name;
}
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');

console.log(`src/chrome-extension/manifest.json version set to ${version}` + (versionName ? ` (version_name: ${versionName})` : ''));
