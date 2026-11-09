# E2E test vault

The headless Obsidian E2E tests (`npm run test:e2e`, see `wdio.conf.mts`) open a temporary copy of this folder as the vault, with the plugin from this checkout installed and enabled. The specs in `e2e/specs/` create the notes they need.
