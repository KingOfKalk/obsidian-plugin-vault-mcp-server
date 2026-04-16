/**
 * WebdriverIO configuration for E2E testing with Obsidian.
 *
 * Requirements:
 * - Docker with Xvfb for headless Obsidian
 * - wdio-obsidian-service (npm install --save-dev @nicholasgasior/wdio-obsidian-service)
 *
 * Usage:
 *   npx wdio run e2e/wdio.conf.ts
 *
 * Note: E2E tests are not run in standard CI due to Obsidian dependency.
 * A separate CI workflow (e2e.yml) handles these tests.
 */

export const config = {
  runner: 'local',
  specs: ['./e2e/specs/**/*.ts'],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'electron',
    },
  ],
  logLevel: 'info',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },
};
