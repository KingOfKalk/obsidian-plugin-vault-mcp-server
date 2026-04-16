# Changelog

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
