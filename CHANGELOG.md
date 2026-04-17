# Changelog

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
