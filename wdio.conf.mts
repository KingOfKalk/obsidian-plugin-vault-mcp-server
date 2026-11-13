import * as path from 'node:path';

/**
 * Headless Obsidian E2E (#441). Run via `npm run test:e2e`, which builds the
 * plugin and starts this config under `xvfb-run`.
 *
 * Obsidian is pinned so results do not change with an Obsidian update.
 * The default is the manifest's minAppVersion, 1.15.0 (#557).
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
      browserVersion: process.env.OBSIDIAN_VERSION || '1.15.0',
      'wdio:obsidianOptions': {
        installerVersion: process.env.OBSIDIAN_INSTALLER || '1.15.0',
        // Dataview is installed but starts disabled; plugin-tools.e2e.ts
        // switches it on and off (#469). Pinned like Obsidian itself.
        plugins: ['.', { repo: 'blacksmithgu/obsidian-dataview', version: '0.5.68', enabled: false }],
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
