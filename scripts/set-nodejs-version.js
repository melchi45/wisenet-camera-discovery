#!/usr/bin/env node
// Stamps an explicit version string onto src/nodejs/package.json before a
// publish build. Unlike sync-manifest-version.js, the version here isn't
// always copied straight from the root package.json: the npm-publish
// workflow computes a `<rootVersion>-beta.<shortSha>` prerelease for plain
// pushes and only uses the root version as-is for tag-triggered releases
// (see .github/workflows/publish-npm.yml) — so this script takes the
// version to write as an explicit argument rather than reading it from
// anywhere itself.
//
// scripts/build.js copies src/nodejs/package.json verbatim into
// dist/nodejs/package.json, which is the file that actually gets
// `npm publish`ed — so this has to run *before* `node scripts/build.js
// node` for the version to take effect.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'src', 'nodejs', 'package.json');

const version = process.argv[2];
if (!version) {
  throw new Error('usage: node scripts/set-nodejs-version.js <version>');
}
// Standard semver, prerelease allowed (e.g. "1.2.3-beta.a1b2c3d") — unlike
// Chrome's manifest "version" field, npm's registry has no restriction
// against prerelease/build suffixes.
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z-.]+)?$/.test(version)) {
  throw new Error(`"${version}" isn't a valid semver version (expected e.g. "1.2.3" or "1.2.3-beta.abc1234")`);
}

const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
pkg.version = version;
fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');

console.log(`src/nodejs/package.json version set to ${version}`);
