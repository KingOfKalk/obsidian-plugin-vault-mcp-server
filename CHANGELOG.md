# Changelog

## [2.6.0](https://github.com/KingOfKalk/obisdian-plugin-mcp/compare/v2.5.0...v2.6.0) (2026-04-19)


### Features

* **plugin-interop:** allowlist plugin_execute_command ([#212](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/212)) ([d27004e](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/d27004eabbed41712bc8b15b9de872de35793556)), closes [#181](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/181)
* **tools:** add CHARACTER_LIMIT + truncation safety net for list/read tools ([#205](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/205)) ([fc7806b](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/fc7806b68ba5544bf418de604012833cd40ea229)), closes [#177](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/177)
* **tools:** add response_format + structuredContent scaffolding ([#211](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/211)) ([f19751d](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/f19751dccf989eac1a53ddcf968b3861d2c9b5dc)), closes [#176](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/176)
* **tools:** roll out `makeResponse` + `structuredContent` to all read tools ([#219](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/219)) ([82cee8d](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/82cee8db50aea9c759f9bb22dc3d8108a74d48aa))
* **tools:** wire up limit/offset pagination on list and search tools ([#210](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/210)) ([d321e7a](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/d321e7a1096878bdc08ad2c2fc8f1e87567310b7)), closes [#178](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/178)


### Bug Fixes

* **ci:** use single light-mode settings screenshot in releases ([#197](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/197)) ([989ad51](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/989ad518adffc3d0862327ce22b50b350506f474)), closes [#171](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/171)
* **server:** add idle session sweep and surface close errors ([#200](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/200)) ([72a1e66](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/72a1e66bb41e2aab6b690d7b0710fff5c6a02153)), closes [#184](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/184)
* **tools:** bounds-check editor positions and guard workspace_open_file ([#202](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/202)) ([dd5ddc8](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/dd5ddc8619813c8b1e00b1a92876a476a0096a7f)), closes [#182](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/182)
* **vault:** harden vault_rename against separators and whitespace-only names ([#194](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/194)) ([2884671](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/2884671404a2905fba7a51aed9253b4448d03fb6)), closes [#183](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/183)


### Documentation

* **ci:** add tool registry snapshot and docs drift check ([#203](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/203)) ([7c5aeea](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/7c5aeeaf2b1224c0c0a4f38af87c89129f633411)), closes [#189](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/189)
* **tools:** expand tool descriptions to the mcp-builder template ([#209](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/209)) ([6fa3d72](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/6fa3d7258f5b6a8c2a9ff0bc99773705c7ed9f04)), closes [#179](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/179)


### Code Refactoring

* **main:** defer this.httpServer assignment until start() resolves ([#193](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/193)) ([e46f211](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/e46f211e3aa3f1bc43036163f6ee6914c8f36962)), closes [#161](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/161)
* **main:** replace void fire-and-forget with reportError helper ([#196](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/196)) ([0fdd3b6](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/0fdd3b6f38b738d58880f64dc6d61a581a793d2b)), closes [#186](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/186)
* **registry:** add generic ToolDefinition&lt;Shape&gt; + defineTool() helper ([#221](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/221)) ([f8b56ad](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/f8b56adf36371b06afe8f4f663b99e4e83af8a48))
* **registry:** runtime-validate tool params at dispatch ([#207](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/207)) ([23ea7fd](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/23ea7fda28578f3c2c96d979fb72a107e063a547)), closes [#174](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/174)
* **settings:** extract migrations into src/settings/migrations.ts ([#213](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/213)) ([9eb24a0](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/9eb24a0436d693d6d92d90c2e10879349f1f7893))
* **settings:** split render sections into per-section files ([#215](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/215)) ([4c413f4](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/4c413f41d7729ddc54369a57f6faa715c07c5ce7)), closes [#214](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/214)
* **tools:** centralise error handling with shared handleToolError ([#208](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/208)) ([150a9ca](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/150a9ca73f2d2bbd937c33e0607f527191117bd4)), closes [#180](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/180)
* **tools:** drop every `as` cast from handler bodies ([#223](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/223)) ([708ba43](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/708ba430a4749b611d0c15b2c2ad9af59a6ae16b)), closes [#217](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/217)
* **tools:** tighten Zod schemas with describes and bounds ([#206](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/206)) ([8f3d6ed](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/8f3d6ed219f8124b8738a1466f7f28d2c3ebfb92)), closes [#175](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/175)


### Tests

* **ci:** ratchet coverage thresholds toward the [#218](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/218) targets ([#222](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/222)) ([112c503](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/112c503ae2c771ecc994d2bd5a062b4bde6d0b63))
* **ci:** unexclude main/settings from coverage and enforce thresholds ([#204](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/204)) ([ef80801](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/ef808015922a76f8cdef0f15b00629dfd41b63d5)), closes [#187](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/187)
* **mocks:** replace any-typed obsidian mock with typed factories ([#201](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/201)) ([5e05172](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/5e051724341fb04c2a026a1b26374d47473b3e8a)), closes [#188](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/188)


### Continuous Integration

* **release:** surface all conventional commit types in CHANGELOG ([#199](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/199)) ([5720a92](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/5720a928f8d4da3773941e5daab2b455b4ff596b)), closes [#198](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/198)


### Miscellaneous Chores

* **tests/settings:** add return types to local helpers ([#225](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/225)) ([c3ce6b1](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/c3ce6b16d7205a14510e0c751abdd329ba312cf9)), closes [#224](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/224)

## [2.5.0](https://github.com/KingOfKalk/obisdian-plugin-mcp/compare/v2.4.1...v2.5.0) (2026-04-18)


### Features

* **registry:** add per-tool MCP annotations ([#191](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/191)) ([c97195f](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/c97195facd8c4a9c524c3b935ca860571c694d0a)), closes [#173](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/173)

## [2.4.1](https://github.com/KingOfKalk/obisdian-plugin-mcp/compare/v2.4.0...v2.4.1) (2026-04-18)


### Bug Fixes

* **ci:** launch Obsidian binary directly in release screenshots ([#168](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/168)) ([7677fbc](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/7677fbc66584d76a99d30b246036e0ba0986919b)), closes [#166](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/166)

## [2.4.0](https://github.com/KingOfKalk/obisdian-plugin-mcp/compare/v2.3.0...v2.4.0) (2026-04-18)


### Features

* bring your own SSL certificate ([#162](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/162)) ([d4a3c74](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/d4a3c7455d8dd850b256736253cea6b28178f56e))
* **docs:** add user manual and localized screenshot pipeline ([#158](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/158)) ([8db7446](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/8db74468fb934ba8f4a6ce8c59ae6d5de38fd484))
* surface port-in-use failures in status bar, toggle, and settings ([#165](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/165)) ([9122ade](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/9122ade18ed1166e7e89a03f744ec6cd06a6dcd6)), closes [#160](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/160)


### Bug Fixes

* **ci:** invoke Obsidian AppRun by absolute path in release screenshots ([#164](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/164)) ([ef4520b](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/ef4520be19b65c61e7585a18c14a3329e2710d5f)), closes [#159](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/159)
* **ci:** make extracted Obsidian AppImage executable for runner user ([#154](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/154)) ([af12956](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/af12956e9cb147dcadf4a0c75ed37e107452194b))

## [2.3.0](https://github.com/KingOfKalk/obisdian-plugin-mcp/compare/v2.2.0...v2.3.0) (2026-04-18)


### Features

* add toggle to require Bearer authentication (off by default) ([#147](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/147)) ([e66b044](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/e66b04448d7168dfd84f7c4e57886fd306272dea))
* **diagnostics:** add debug info bundle and persistent log file ([#145](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/145)) ([d6292d8](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/d6292d844c8f3348771f1069c7a3150e71b1115e)), closes [#143](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/143)

## [2.2.0](https://github.com/KingOfKalk/obisdian-plugin-mcp/compare/v2.1.0...v2.2.0) (2026-04-17)


### Features

* **i18n:** add multi-language support with English and German locales ([#141](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/141)) ([c416495](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/c4164951e0f5561c286bf54d3ebb059356955b8a)), closes [#114](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/114)

## [2.1.0](https://github.com/KingOfKalk/obisdian-plugin-mcp/compare/v2.0.2...v2.1.0) (2026-04-17)


### Features

* **server:** wire up HTTPS with cached self-signed certificate ([#136](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/136)) ([5e1d374](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/5e1d3741d84d2944b0e1b87135c5e5c6f69698a2)), closes [#131](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/131)
* **settings:** replace inline MCP config JSON with a compact copy card ([#128](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/128)) ([d4d24cb](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/d4d24cb9f6db84a8423986ea91622379d20d0c64)), closes [#127](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/127)


### Bug Fixes

* **settings:** surface validation errors for invalid IP and port input ([#138](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/138)) ([3934c71](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/3934c710f805c81f1a599436e565eec0a8784d69)), closes [#134](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/134)
* **ui:** swap ribbon icon glyph on server state change ([#139](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/139)) ([d64cc65](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/d64cc65b76bfb549ab270c4f3396076cd9a15161)), closes [#132](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/132)

## [2.0.2](https://github.com/KingOfKalk/obisdian-plugin-mcp/compare/v2.0.1...v2.0.2) (2026-04-17)


### Bug Fixes

* **settings:** render extras as a flat group ([#123](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/123)) ([1817a9f](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/1817a9f34b2c04306be240936682189a92c0550c)), closes [#120](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/120)

## [2.0.1](https://github.com/KingOfKalk/obisdian-plugin-mcp/compare/v2.0.0...v2.0.1) (2026-04-17)


### Bug Fixes

* **ci:** upload plugin assets before screenshot pipeline ([#121](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/121)) ([0fdbccf](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/0fdbccfea03e11f1c0dd30a1156b494b404c0d66)), closes [#119](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/119)

## [2.0.0](https://github.com/KingOfKalk/obisdian-plugin-mcp/compare/v1.6.0...v2.0.0) (2026-04-17)


### ⚠ BREAKING CHANGES

* `ModuleState`, `ModuleRegistration`, and `ModuleStateMap` no longer have a `readOnly` field. `ModuleMetadata` no longer has `supportsReadOnly`. `ModuleRegistry.setReadOnly()` is removed.

### Features

* remove per-module read-only mode ([#116](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/116)) ([28aad6d](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/28aad6d5d24b4128f4b11f365886f7b76d7c3334))
* **settings:** per-tool toggles for the Extras group ([#117](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/117)) ([5b5c190](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/5b5c190cd1db06004f4b0efb8f3bdd084c448f88)), closes [#115](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/115)

## [1.6.0](https://github.com/KingOfKalk/obisdian-plugin-mcp/compare/v1.5.1...v1.6.0) (2026-04-16)


### Features

* **settings:** use refresh icon buttons for Generate and Restart ([#100](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/100)) ([837b2c3](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/837b2c3ffc1b65953456404b9644aa9f1e9d19e8)), closes [#99](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/99)
* **tools:** add get_date tool in new "Extras" module group ([#101](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/101)) ([1ee5f84](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/1ee5f84061030611fce884e218a2dd89705d6d81)), closes [#95](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/95)


### Bug Fixes

* **settings:** full-width MCP config textarea + icon buttons with tooltips ([#104](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/104)) ([328f678](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/328f67837c66919289d01b55c4a053499693fc52))

## [1.5.1](https://github.com/KingOfKalk/obisdian-plugin-mcp/compare/v1.5.0...v1.5.1) (2026-04-16)


### Bug Fixes

* **settings:** group module + read-only toggles into a bordered card ([#97](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/97)) ([10faf56](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/10faf56ce12f945cbe4f64aef265d5aa92f3efe0)), closes [#96](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/96)

## [1.5.0](https://github.com/KingOfKalk/obisdian-plugin-mcp/compare/v1.4.1...v1.5.0) (2026-04-16)


### Features

* **server:** do not auto-start MCP server on plugin load; default to off ([#92](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/92)) ([196dfc5](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/196dfc5a51153ba94e5ca06e3d06b125796879fd)), closes [#85](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/85)
* **settings:** add copy-icon button next to Access Key field ([#88](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/88)) ([d3c3cb3](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/d3c3cb3da039b14b54d7455ab7b7f359d3d42c7a)), closes [#83](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/83)
* **settings:** auto-size the MCP client configuration code block ([#91](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/91)) ([68c381e](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/68c381eb32dee44ed8974e85bc4948c1fe3cda77)), closes [#86](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/86)
* **settings:** replace Copy URL text button with copy icon ([#89](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/89)) ([af0cb84](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/af0cb847f4f2c496c193a086b601ad4e90384899)), closes [#84](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/84)
* **settings:** replace Start/Stop buttons with a single server toggle ([#90](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/90)) ([e97137f](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/e97137f67efca3ac7b8b61c696a6f8b5e37149c8)), closes [#82](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/82)


### Bug Fixes

* **settings:** promote read-only module toggle to its own labelled sub-row ([#94](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/94)) ([ed48e60](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/ed48e603d3ab46546cbd4b6d458c95c0d083d76a)), closes [#87](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/87)

## [1.4.1](https://github.com/KingOfKalk/obisdian-plugin-mcp/compare/v1.4.0...v1.4.1) (2026-04-16)


### Bug Fixes

* auto-register discovered tool modules on plugin load ([#80](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/80)) ([383c761](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/383c761e4479a0c902c1ae379668057a9925ed4d))

## [1.4.0](https://github.com/KingOfKalk/obisdian-plugin-mcp/compare/v1.3.1...v1.4.0) (2026-04-16)


### Features

* **docker:** add CDP-based visual regression testing for the plugin UI ([#77](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/77)) ([f722027](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/f722027b10eb827c67b641d415fcecfa399a059d))

## [1.3.1](https://github.com/KingOfKalk/obisdian-plugin-mcp/compare/v1.3.0...v1.3.1) (2026-04-16)


### Bug Fixes

* create per-session McpServer and transport pairs ([#75](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/75)) ([2e69c77](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/2e69c7784bdac9f73473a35bb472ca4d8772529a)), closes [#74](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/74)

## [1.3.0](https://github.com/KingOfKalk/obisdian-plugin-mcp/compare/v1.2.0...v1.3.0) (2026-04-16)


### Features

* configurable MCP server IP address (CR17) ([#70](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/70)) ([af42c44](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/af42c442558886f39b6a62dc4406ceb15c4e9db9))
* replace MCP config code block with textarea and action buttons ([#71](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/71)) ([5cc0a6b](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/5cc0a6b6e4d84fe26a1d4cdbe6595995e2937ad7))

## [1.2.0](https://github.com/KingOfKalk/obisdian-plugin-mcp/compare/v1.1.0...v1.2.0) (2026-04-16)


### Features

* add editor, workspace, UI, templates, and plugin interop tools ([#45](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/45)) ([115e350](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/115e3506a3c65af422820f129518363f76c5cd7b)), closes [#40](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/40) [#41](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/41) [#42](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/42) [#43](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/43) [#44](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/44)
* add HTTPS support with self-signed certificates ([#47](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/47)) ([df0ae56](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/df0ae56a91097cff529a6e6b92eb2da9930a5303)), closes [#46](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/46)
* add MCP server core with Streamable HTTP transport ([#26](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/26)) ([240f39e](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/240f39ee7d3bf9779f7ef039378875c300cb2275)), closes [#25](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/25)
* add module registry and tool registration system ([#24](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/24)) ([4758132](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/4758132ed94791d05be36d808960110b76088a84)), closes [#23](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/23)
* add Obsidian API abstraction layer ([#20](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/20)) ([f95180f](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/f95180f5cfb9550319c1b8a8bbb9d5968970f716)), closes [#19](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/19)
* add path validation and security utilities ([#22](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/22)) ([84558bc](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/84558bc74c7e2e2f59aab1f8a5b2cab752800b14)), closes [#21](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/21)
* add ribbon icon and command palette commands ([#30](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/30)) ([5e6b6d8](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/5e6b6d8c2bcec0d20c54eba3a687daedfc4f6cfb)), closes [#29](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/29)
* add search and metadata tools ([#39](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/39)) ([18ac07f](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/18ac07f53b02bb89b901b312917b5f0ead2abb73)), closes [#38](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/38)
* add settings tab with server status and module toggles ([#28](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/28)) ([6dfdd75](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/6dfdd756bb089472662ae948abcaf45f3e46354e)), closes [#27](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/27)
* add structured logging utility ([#17](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/17)) ([3f7eaa8](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/3f7eaa86d93039d2c3e86e868c02ff94da327927)), closes [#7](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/7)
* add vault file move, copy, and rename tools ([#36](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/36)) ([3245a2f](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/3245a2f5c5053e8912a0b5b9fd2a1607a8ea74b6)), closes [#33](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/33)
* add vault file operations tools (CRUD) ([#32](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/32)) ([67de547](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/67de547df92be36072dd977358125c0e213bffa9)), closes [#31](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/31)
* add vault folder operations and binary file tools ([#37](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/37)) ([b9388eb](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/b9388eb6bc90b8ff0dbee71a12fd292a15989fc9)), closes [#34](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/34) [#35](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/35)
* **settings:** add MCP URL copy button and client configuration preview ([#64](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/64)) ([26eb8b0](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/26eb8b022025a08fc4e10c7abf8c99b90fc0695c))


### Bug Fixes

* **ci:** write non-empty styles.css placeholder for release upload ([#57](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/57)) ([4811075](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/4811075f3bc6cc3886b3641be04f0e3b80d63ef7))
* remove non-existent `dependencies` label from dependabot config ([#56](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/56)) ([25a3856](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/25a3856689de404eeb9a9102b1b9f802e69f44cc))
* remove package name prefix from release titles ([#63](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/63)) ([e229c4d](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/e229c4d773783f41e2e1df690dd7bb4d624209fa))
* sync manifest.json version with release tag to fix addon install ([#59](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/59)) ([e912029](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/e912029953686d2a33bf69a3a1849c006a1fcb62))

## [1.1.0](https://github.com/KingOfKalk/obisdian-plugin-mcp/compare/obsidian-mcp-v1.0.1...obsidian-mcp-v1.1.0) (2026-04-16)


### Features

* add editor, workspace, UI, templates, and plugin interop tools ([#45](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/45)) ([115e350](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/115e3506a3c65af422820f129518363f76c5cd7b)), closes [#40](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/40) [#41](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/41) [#42](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/42) [#43](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/43) [#44](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/44)
* add HTTPS support with self-signed certificates ([#47](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/47)) ([df0ae56](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/df0ae56a91097cff529a6e6b92eb2da9930a5303)), closes [#46](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/46)
* add MCP server core with Streamable HTTP transport ([#26](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/26)) ([240f39e](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/240f39ee7d3bf9779f7ef039378875c300cb2275)), closes [#25](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/25)
* add module registry and tool registration system ([#24](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/24)) ([4758132](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/4758132ed94791d05be36d808960110b76088a84)), closes [#23](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/23)
* add Obsidian API abstraction layer ([#20](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/20)) ([f95180f](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/f95180f5cfb9550319c1b8a8bbb9d5968970f716)), closes [#19](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/19)
* add path validation and security utilities ([#22](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/22)) ([84558bc](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/84558bc74c7e2e2f59aab1f8a5b2cab752800b14)), closes [#21](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/21)
* add ribbon icon and command palette commands ([#30](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/30)) ([5e6b6d8](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/5e6b6d8c2bcec0d20c54eba3a687daedfc4f6cfb)), closes [#29](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/29)
* add search and metadata tools ([#39](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/39)) ([18ac07f](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/18ac07f53b02bb89b901b312917b5f0ead2abb73)), closes [#38](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/38)
* add settings tab with server status and module toggles ([#28](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/28)) ([6dfdd75](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/6dfdd756bb089472662ae948abcaf45f3e46354e)), closes [#27](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/27)
* add structured logging utility ([#17](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/17)) ([3f7eaa8](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/3f7eaa86d93039d2c3e86e868c02ff94da327927)), closes [#7](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/7)
* add vault file move, copy, and rename tools ([#36](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/36)) ([3245a2f](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/3245a2f5c5053e8912a0b5b9fd2a1607a8ea74b6)), closes [#33](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/33)
* add vault file operations tools (CRUD) ([#32](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/32)) ([67de547](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/67de547df92be36072dd977358125c0e213bffa9)), closes [#31](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/31)
* add vault folder operations and binary file tools ([#37](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/37)) ([b9388eb](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/b9388eb6bc90b8ff0dbee71a12fd292a15989fc9)), closes [#34](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/34) [#35](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/35)


### Bug Fixes

* **ci:** write non-empty styles.css placeholder for release upload ([#57](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/57)) ([4811075](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/4811075f3bc6cc3886b3641be04f0e3b80d63ef7))
* remove non-existent `dependencies` label from dependabot config ([#56](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/56)) ([25a3856](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/25a3856689de404eeb9a9102b1b9f802e69f44cc))
* sync manifest.json version with release tag to fix addon install ([#59](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/59)) ([e912029](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/e912029953686d2a33bf69a3a1849c006a1fcb62))

## [1.0.1](https://github.com/KingOfKalk/obisdian-plugin-mcp/compare/v1.0.0...v1.0.1) (2026-04-16)


### Bug Fixes

* **ci:** write non-empty styles.css placeholder for release upload ([#57](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/57)) ([4811075](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/4811075f3bc6cc3886b3641be04f0e3b80d63ef7))

## 1.0.0 (2026-04-16)


### Features

* add editor, workspace, UI, templates, and plugin interop tools ([#45](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/45)) ([115e350](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/115e3506a3c65af422820f129518363f76c5cd7b)), closes [#40](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/40) [#41](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/41) [#42](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/42) [#43](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/43) [#44](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/44)
* add HTTPS support with self-signed certificates ([#47](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/47)) ([df0ae56](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/df0ae56a91097cff529a6e6b92eb2da9930a5303)), closes [#46](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/46)
* add MCP server core with Streamable HTTP transport ([#26](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/26)) ([240f39e](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/240f39ee7d3bf9779f7ef039378875c300cb2275)), closes [#25](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/25)
* add module registry and tool registration system ([#24](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/24)) ([4758132](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/4758132ed94791d05be36d808960110b76088a84)), closes [#23](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/23)
* add Obsidian API abstraction layer ([#20](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/20)) ([f95180f](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/f95180f5cfb9550319c1b8a8bbb9d5968970f716)), closes [#19](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/19)
* add path validation and security utilities ([#22](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/22)) ([84558bc](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/84558bc74c7e2e2f59aab1f8a5b2cab752800b14)), closes [#21](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/21)
* add ribbon icon and command palette commands ([#30](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/30)) ([5e6b6d8](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/5e6b6d8c2bcec0d20c54eba3a687daedfc4f6cfb)), closes [#29](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/29)
* add search and metadata tools ([#39](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/39)) ([18ac07f](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/18ac07f53b02bb89b901b312917b5f0ead2abb73)), closes [#38](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/38)
* add settings tab with server status and module toggles ([#28](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/28)) ([6dfdd75](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/6dfdd756bb089472662ae948abcaf45f3e46354e)), closes [#27](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/27)
* add structured logging utility ([#17](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/17)) ([3f7eaa8](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/3f7eaa86d93039d2c3e86e868c02ff94da327927)), closes [#7](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/7)
* add vault file move, copy, and rename tools ([#36](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/36)) ([3245a2f](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/3245a2f5c5053e8912a0b5b9fd2a1607a8ea74b6)), closes [#33](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/33)
* add vault file operations tools (CRUD) ([#32](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/32)) ([67de547](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/67de547df92be36072dd977358125c0e213bffa9)), closes [#31](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/31)
* add vault folder operations and binary file tools ([#37](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/37)) ([b9388eb](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/b9388eb6bc90b8ff0dbee71a12fd292a15989fc9)), closes [#34](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/34) [#35](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/35)


### Bug Fixes

* remove non-existent `dependencies` label from dependabot config ([#56](https://github.com/KingOfKalk/obisdian-plugin-mcp/issues/56)) ([25a3856](https://github.com/KingOfKalk/obisdian-plugin-mcp/commit/25a3856689de404eeb9a9102b1b9f802e69f44cc))
