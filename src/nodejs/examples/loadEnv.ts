'use strict';
// Minimal, dependency-free ".env" loader for the example server — no
// `dotenv` package needed for two config values. Reads KEY=VALUE pairs
// from a `.env` file in the current working directory (same convention
// the `dotenv` package itself uses), skipping comments/blank lines. Real
// env vars already set always win over the file, so `HTTP_PORT=3000 node
// examples/server.js` still overrides whatever `.env` says.
//
// Resolved from process.cwd(), not from this file's own location —
// dist/ gets wiped by `npm run build`/`npm run clean`, so a `.env`
// placed there wouldn't survive a rebuild; cwd-relative resolution keeps
// it wherever you actually run the process from instead (repo root for
// `npm run start:server`, or dist/nodejs/ if you `cd` there per
// ../README.md's standalone workflow — see that file's own note on this).
// Must run before anything else reads process.env — see server.ts's
// require order, which requires this file first for exactly that reason.

const fs = require('fs');
const path = require('path');

function loadEnv(envPath = path.resolve(process.cwd(), '.env')) {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv();

module.exports = { loadEnv };
