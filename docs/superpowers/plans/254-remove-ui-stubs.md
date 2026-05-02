# Plan: remove `ui_confirm` and `ui_prompt` stubs (#254)

## Decision

Option B from the campaign spec (#258): delete the stubs. They never opened
an Obsidian modal — they only returned a JSON envelope that *looks* like
data — so the honest move is to take them off the MCP tool surface.

`ui_notice` stays untouched; it has a real implementation.

## Files touched

- `src/tools/ui/index.ts`
  - Remove `showConfirmSchema` and `showPromptSchema` constants.
  - Remove `showConfirm` and `showPrompt` from `UiHandlers` interface.
  - Remove `showConfirm` and `showPrompt` from `createHandlers`.
  - Remove the `defineTool({ name: 'ui_confirm', … })` and
    `defineTool({ name: 'ui_prompt', … })` blocks in `tools()`.
  - Drop the obsolete comment about confirmation modals / prompts being
    stubs that need UI interaction.
- `tests/tools/ui/ui.test.ts`
  - Drop the `ui_confirm` and `ui_prompt` `it` blocks.
  - Update the registration count test from 3 to 1.
  - Keep the `ui_notice` test intact.
- `docs/tools.generated.md`
  - Regenerated via `npm run docs:tools`. The `ui` row's tool count drops
    from 3 to 1 and the tool list becomes just `ui_notice`. The two
    detailed sections for `ui_confirm` and `ui_prompt` disappear.

## Files NOT touched

- `docs/help/en.md` — confirmed via grep that neither `ui_confirm` nor
  `ui_prompt` is mentioned. No user-facing manual update needed.
- No `docs/help/de.md` exists yet.
- No screenshot capture — no settings/modal/ribbon UI changes.

## Surface change callout

This removes two tools from the MCP tool list. Agents that currently call
`ui_confirm` or `ui_prompt` will receive a "tool not found" error after
this lands. The campaign spec (#258) classifies this as Phase 4
(non-breaking-bundle) because the stubs never returned real data — a
caller that was relying on them was already broken in practice. Therefore
the commit uses `fix:` (matching the issue title) instead of `feat!:` /
`BREAKING CHANGE:`. The PR body will spell the surface change out in plain
English so reviewers can sanity-check.

## Verification

- `npm run lint`
- `npm test`
- `npm run typecheck`
- `npm run docs:check`

## Commits

1. `docs(plans/254): plan for removing ui_confirm and ui_prompt stubs` —
   this file. `Refs #254`.
2. `fix(tools/ui): remove ui_confirm and ui_prompt stubs` — the deletions
   plus the regenerated `docs/tools.generated.md`. `Refs #254`.
