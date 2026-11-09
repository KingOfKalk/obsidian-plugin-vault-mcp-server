import * as path from 'node:path';

/**
 * Headless Obsidian E2E (#441). Run via `npm run test:e2e`, which builds the
 * plugin and starts this config under `xvfb-run`.
 *
 * Obsidian is pinned so results do not change with an Obsidian update.
 * The default is 1.5.3: the manifest's minAppVersion is 1.5.0, but 1.5.0
 * to 1.5.2 were Insider (beta) builds that need an Obsidian account to
 * download, and 1.5.3 is the first public release at or above it.
 * OBSIDIAN_VERSION / OBSIDIAN_INSTALLER run the suite against another
 * version (CI also runs a pinned current version, see ci.yml).
 */
export const config: WebdriverIO.Config = {
  runner: 'local',
  framework: 'mocha',
  specs: ['./e2e/specs/**/*.e2e.ts'],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'obsidian',
      browserVersion: process.env.OBSIDIAN_VERSION || '1.5.3',
      'wdio:obsidianOptions': {
        installerVersion: process.env.OBSIDIAN_INSTALLER || '1.5.3',
        plugins: ['.'],
        vault: 'tests/vault',
      },
    },
  ],
  services: ['obsidian'],
  reporters: ['obsidian'],
  cacheDir: path.resolve('.obsidian-cache'),
  mochaOpts: { ui: 'bdd', timeout: 120000 },
  logLevel: 'warn',
};
