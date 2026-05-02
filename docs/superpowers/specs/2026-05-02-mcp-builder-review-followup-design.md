# Campaign Plan — mcp-builder review follow-up

- **Date:** 2026-05-02
- **Tracker:** [#258](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/258)
- **Scope:** Sequence and execute the 13 follow-up items (#245–#257) surfaced by the mcp-builder review.
- **Status:** Approved campaign plan; per-issue implementation plans follow separately.

## 1. Goal

Close every item on the #258 tracker, with each PR independently reviewable and the breaking changes consolidated into a single major release-please cut.

## 2. Locked decisions

- **Cadence:** burst — work proceeds back-to-back, one PR open at a time, awaiting user merge before starting the next (per project workflow §7).
- **Executor:** the assistant.
- **#250 — plugin-interop:** Option A for read-only DQL (`dataview_query` actually executes via the Dataview API); Option B for `dataview-js` and Templater (rename stubs to `*_describe` so they advertise as describe-only).
- **#254 — UI stubs:** Option B — delete `ui_confirm` and `ui_prompt`. No concrete agent workflow needs them.
- **#255 — search rename target:** `vault_get_*` (full service-prefix convention) rather than dropping the prefix.
- **Batching:** strict 1:1 issue-to-PR, with one exception — the breaking changes land as a single PR.

## 3. Execution order — 10 PRs

Numbered by execution order, not by issue number.

### Phase 1 — Security (urgent, non-breaking)

1. **#245** — `crypto.timingSafeEqual` for bearer compare; rate-limit failed attempts.
2. **#246** — Validate `Origin` and `Host` headers against an allowlist for DNS-rebind protection.

### Phase 2 — Polish (non-breaking)

3. **#247** — Advertise as `obsidian-mcp-server`; read version from `manifest.json`.
4. **#252** — Stop swallowing all errors in `template_list`; surface them via the standard error envelope.
5. **#256** — Route all log levels to stderr so stdio transport stays clean.
6. **#257** — Unify error handling between input parsing and handler execution.

### Phase 3 — Tool metadata (non-breaking; do before any rename)

7. **#248** — Declare `outputSchema` on tools and forward it to `registerTool`.
8. **#249** — Document `limit` / `offset` / `response_format` in tool descriptions.

Rationale for ordering Phase 3 before Phase 5: schemas and descriptions are easier to write against the existing tool names; the rename in Phase 5 carries them along mechanically rather than re-doing them after rename.

### Phase 4 — UI cleanup (non-breaking)

9. **#254** — Delete `ui_confirm` / `ui_prompt` stubs. Remove their tests, registry entries, and any settings hooks.

### Phase 5 — Breaking bundle (one PR, four `Closes`)

10. **#250 + #251 + #253 + #255** — Single PR that:
    - Implements read-only DQL execution for `dataview_query` (#250 part A — non-breaking, but ships in this PR for atomicity).
    - Renames `dataview-js` and Templater stubs to `*_describe` (#250 part B — breaking).
    - Renames `get_date` to `extras_get_date` (#251 — breaking).
    - Flips `authEnabled` default to `true`; introduces an explicit opt-in setting for unauthenticated mode so the change is not silent (#253 — breaking).
    - Renames `search_get_*` single-path getters to `vault_get_*` (#255 — breaking).
    - PR title uses `feat!:` per Conventional Commits 1.0.0; body includes a `BREAKING CHANGE:` footer per global rule 18.
    - Body includes a migration note section listing every renamed tool, the auth flip, and the new flag.

This is a deliberate deviation from strict 1:1 batching because:

- Releasing #250's rename, #251, #253, and #255 separately would produce up to four consecutive major version cuts from release-please.
- Folding #250's non-breaking DQL execution into the same PR keeps the issue closeable with a single PR; splitting #250 into two PRs would violate 1:1 in a different direction.

## 4. Per-issue protocol

For every issue, before opening a PR:

1. Read the full issue body — not just the title.
2. Locate the referenced code; verify the finding still applies (the review is a snapshot in time; code may have moved or already been fixed).
3. If the finding is stale or the recommended option no longer fits, comment on the issue and pause for direction rather than implementing blindly.
4. Write tests first when feasible (project workflow §4 — TDD).
5. Update [`docs/help/en.md`](../../help/en.md) and any sibling locale files in the same PR if user-facing surfaces change (project rule 5).
6. If the tool registry changes (add/remove/rename), regenerate [`docs/tools.generated.md`](../../tools.generated.md) with `npm run docs:tools` (project rule 5; CI's `docs:check` will fail otherwise).
7. Run the gate: `npm run lint`, `npm test`, `npm run typecheck` — all clean.
8. If any UI surface (settings tab, modal, ribbon, command palette entry, status bar, notice) is touched, capture before/after screenshots (project CLAUDE.md, "Mandatory before/after screenshots for UI work").
9. Branch name: `<type>/issue-<n>-<slug>` per project rule 7.

## 5. Branch and PR conventions

- One branch per PR; never work on `main` (global rule 36).
- Commit messages follow Conventional Commits 1.0.0 with hierarchical scopes (global rules 17–21).
- Every commit body includes `Refs #<issue-number>` for traceability (global rule 35).
- PR title mirrors the primary commit subject (global rule 39).
- PR body includes:
  - `Closes #<issue-number>` (one per closed issue; the bundle PR has four).
  - **Summary** — 1–3 bullets: what changed and why.
  - **Test plan** — verification steps.
- No AI attribution anywhere (global rule 16, project rule 2).
- One PR open at a time; wait for user merge before opening the next (project workflow §7).

## 6. Risk and coordination notes

- **Bundle PR blast radius:** the Phase 5 PR flips the auth default and renames 6+ public tool names in one go. Mitigation: thorough migration notes in the PR body; linked release notes; explicit `BREAKING CHANGE:` footer so downstream tooling and release-please pick it up correctly.
- **Auth default flip (#253):** users currently relying on the default-insecure mode will need to either set the new opt-in unauthenticated setting explicitly or provide a token. The opt-in setting must be documented in `docs/help/en.md` and the help locale siblings, and called out prominently in the bundle PR body.
- **Phase 3 churn:** #248 (`outputSchema`) and #249 (description docs) touch every tool file. Reviews should focus on schema correctness and description accuracy rather than diff size.
- **`mcp_best_practices.md` rubric coverage:** the campaign closes the rubric's gaps for naming (#247, #251, #255), output schema (#248), description-vs-schema (#249), description-vs-behaviour (#250, #254), error envelope (#252, #257), security (#245, #246, #253), and transport (#256). After Phase 5 ships, the project should pass a re-review cleanly.
- **Stale finding fallback:** if any issue's finding no longer applies, the assistant comments on the issue with evidence and pauses; the user decides whether to close the issue or revise scope.

## 7. Out of scope

- Implementing modal UI for `ui_confirm` / `ui_prompt` (#254 Option A) — explicitly rejected.
- Creating new GitHub labels (global rule 32; use existing ones only).
- Touching anything outside the 13 listed issues. Adjacent improvements that surface during work are filed as new issues, not folded into existing PRs.
- Releasing the bundle PR; release-please cuts the major automatically when the `feat!:` PR merges.

## 8. Definition of done

- All 10 PRs merged.
- `#258` tracker checklist fully checked.
- Re-running the mcp-builder rubric on the project produces no remaining findings on the items listed in #258.
