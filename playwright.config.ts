// Playwright config for the window-ui-equivalence suite -- see
// docs/window-ui/TC.md for the full test-case table this implements, and
// docs/window-ui/DESIGN.md/PRD.md for why this compares two pages
// (dist/nodejs/examples/public/ vs. dist/shared-v2-preview/) rather than
// testing src/shared-v2/ in isolation. Requires `npm run build` and
// `npm run build:shared-v2` to have been run first (both dist/ outputs
// must exist) -- this config does not build them itself.
import { defineConfig } from '@playwright/test';
import path from 'path';

const MOCK_SUNAPI_PORT = 9301;
export const OLD_PORT = 9101;
export const NEW_PORT = 9102;
export const MOCK_SUNAPI_URL = `http://127.0.0.1:${MOCK_SUNAPI_PORT}`;
export const OLD_URL = `http://127.0.0.1:${OLD_PORT}`;
export const NEW_URL = `http://127.0.0.1:${NEW_PORT}`;

const repoRoot = __dirname;

export default defineConfig({
  testDir: 'tests/window-ui-equivalence',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 30000,
  use: {
    ignoreHTTPSErrors: true,
  },
  webServer: [
    {
      command: `node tools/mock-sunapi-server/server.js ${MOCK_SUNAPI_PORT}`,
      cwd: repoRoot,
      port: MOCK_SUNAPI_PORT,
      reuseExistingServer: true,
    },
    {
      command: `node tools/equivalence-test-server/server.js ${path.join(repoRoot, 'dist/nodejs/examples/public')} ${OLD_PORT} ${MOCK_SUNAPI_PORT}`,
      cwd: repoRoot,
      port: OLD_PORT,
      reuseExistingServer: true,
    },
    {
      command: `node tools/equivalence-test-server/server.js ${path.join(repoRoot, 'dist/shared-v2-preview')} ${NEW_PORT} ${MOCK_SUNAPI_PORT}`,
      cwd: repoRoot,
      port: NEW_PORT,
      reuseExistingServer: true,
    },
  ],
});
