# Reconcile `docs/help/en.md` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `docs/help/en.md` back in sync with the audited PRD by applying five surgical edits (auth one-liner, four Feature Modules table rows, repo URL typo) in a single commit on branch `docs/issue-318-reconcile-en-md`.

**Architecture:** Pure documentation change — one Markdown file. Edits applied in stable line-order so earlier edits do not shift later line numbers (every edit replaces a 1-line string with a 1-line string). All verification is text-grep based plus the project's standard CI checks (`npm run lint` / `npm test` / `npm run typecheck` are no-ops for doc-only changes but are run as a sanity check per `CLAUDE.md`). One commit total, then push and open a PR.

**Tech Stack:** Markdown, GitHub CLI (`gh`), grep.

**Spec:** [`docs/superpowers/specs/2026-05-07-reconcile-help-en-md-design.md`](../specs/2026-05-07-reconcile-help-en-md-design.md)
**Issue:** [#318](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/issues/318)

---

## Pre-flight

Branch `docs/issue-318-reconcile-en-md` already exists locally (off latest `main`) and the spec has already been committed to it.

- [ ] **Step 1: Confirm branch and clean tree**

Run: `git status`
Expected: `On branch docs/issue-318-reconcile-en-md` and `nothing to commit, working tree clean`.

- [ ] **Step 2: Confirm baseline tests are green**

Run: `npm test`
Expected: vitest exits 0 (all tests pass).

If they fail, stop — don't try to fix unrelated test failures here. Surface to the user.

---

## Task 1: Edit 1 — Auth elevator pitch (line 26)

**Files:**
- Modify: `docs/help/en.md:26`

- [ ] **Step 1: Apply the edit**

Use the `Edit` tool on `docs/help/en.md`:

- `old_string`: `- **Auth**: opt-in HTTP Bearer token`
- `new_string`: `- **Auth**: HTTP Bearer token, on by default`
- `replace_all`: false

(The string is unique — only occurrence in the file.)

- [ ] **Step 2: Verify the replacement**

Run: `grep -n "opt-in HTTP Bearer" docs/help/en.md`
Expected: no output (exit 1).

Run: `grep -n "HTTP Bearer token, on by default" docs/help/en.md`
Expected: one match on line 26.

---

## Task 2: Edit 2 — Feature Modules table (lines 204–210)

**Files:**
- Modify: `docs/help/en.md:204` (Vault row)
- Modify: `docs/help/en.md:205` (Search row)
- Modify: `docs/help/en.md:208` (UI row)
- Modify: `docs/help/en.md:210` (Plugin Interop row)

Apply the four edits below in order. Each replaces an entire table row (the leading `|` through the trailing `|`) so the `old_string` is guaranteed unique.

- [ ] **Step 1: Update Vault row (count 16 → 18, append "daily note")**

Use `Edit` on `docs/help/en.md`:

- `old_string`: `| Vault and File Operations | 16 | Create / read / update / delete files and folders, rename, move, copy, list, binary I/O, metadata. |`
- `new_string`: `| Vault and File Operations | 18 | Create / read / update / delete files and folders, rename, move, copy, list, binary I/O, metadata, daily note. |`
- `replace_all`: false

- [ ] **Step 2: Update Search row (count 12 → 6, drop aspect-getter capabilities)**

Use `Edit` on `docs/help/en.md`:

- `old_string`: `| Search and Metadata | 12 | Full-text search, frontmatter, tags, headings, links, embeds, backlinks, block refs. |`
- `new_string`: `| Search and Metadata | 6 | Full-text search, list tags, find notes by tag / frontmatter, find resolved / unresolved links. |`
- `replace_all`: false

- [ ] **Step 3: Update UI row (count 3 → 1, drop confirm/prompt modals)**

Use `Edit` on `docs/help/en.md`:

- `old_string`: `| UI Interactions | 3 | Show notices and confirm/prompt modals. |`
- `new_string`: `| UI Interactions | 1 | Show notices. |`
- `replace_all`: false

- [ ] **Step 4: Update Plugin Interop row (count 5 → 6, surface describe-* tools)**

Use `Edit` on `docs/help/en.md`:

- `old_string`: `| Plugin Interop | 5 | List plugins, run Dataview / Templater queries, execute commands. |`
- `new_string`: `| Plugin Interop | 6 | List plugins, run / describe Dataview queries, describe Templater templates, execute commands. |`
- `replace_all`: false

- [ ] **Step 5: Verify the four rows**

Run: `sed -n '204,210p' docs/help/en.md`

Expected output (exact):
```
| Vault and File Operations | 18 | Create / read / update / delete files and folders, rename, move, copy, list, binary I/O, metadata, daily note. |
| Search and Metadata | 6 | Full-text search, list tags, find notes by tag / frontmatter, find resolved / unresolved links. |
| Editor Operations | 10 | Read/insert/replace/delete text in the active editor, cursor and selection management. |
| Workspace and Navigation | 5 | Inspect / open / focus leaves, read the layout. |
| UI Interactions | 1 | Show notices. |
| Templates | 3 | List templates, create from template, expand variables. |
| Plugin Interop | 6 | List plugins, run / describe Dataview queries, describe Templater templates, execute commands. |
```

- [ ] **Step 6: Verify dead phrasing is gone**

Run: `grep -n "confirm/prompt modals" docs/help/en.md`
Expected: no output (exit 1).

---

## Task 3: Edit 3 — Repo URL typo (lines 62, 488)

**Files:**
- Modify: `docs/help/en.md:62`
- Modify: `docs/help/en.md:488`

Both occurrences carry the same typo (`obisdian` instead of `obsidian`) and the same target plugin id (`-plugin-mcp` vs `-plugin-vault-mcp-server`). The `Edit` tool's `replace_all` lets us fix both at once.

- [ ] **Step 1: Replace all typo'd URLs**

Use `Edit` on `docs/help/en.md`:

- `old_string`: `https://github.com/KingOfKalk/obisdian-plugin-mcp`
- `new_string`: `https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server`
- `replace_all`: true

- [ ] **Step 2: Verify the typo is gone**

Run: `grep -n "obisdian-plugin-mcp" docs/help/en.md`
Expected: no output (exit 1).

- [ ] **Step 3: Verify all four GitHub URLs are canonical**

Run: `grep -n "github.com/KingOfKalk" docs/help/en.md`
Expected output (exact, four matches, all canonical):
```
62:   https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server
79:1. Open the [latest release](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/releases)
287:Source of truth: [`src/server/mcp-server.ts`](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/blob/main/src/server/mcp-server.ts)
488:   <https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/issues>. The bundle
```

---

## Task 4: Verification

**Files:** none modified.

- [ ] **Step 1: Final grep gates from the spec**

Run all three:

```
grep -n "obisdian-plugin-mcp" docs/help/en.md
grep -n "opt-in HTTP Bearer" docs/help/en.md
grep -n "confirm/prompt modals" docs/help/en.md
```

Expected: each command produces no output and exits 1.

- [ ] **Step 2: Sanity-check the diff**

Run: `git diff --stat docs/help/en.md`
Expected: one file changed, single-digit insertions and deletions (changes are line-replacements; net line count unchanged).

Run: `git diff docs/help/en.md`
Expected: exactly the seven changed lines (1 auth + 4 table rows + 2 URL lines = 7 lines).

- [ ] **Step 3: Run the project checks**

Run each (`CLAUDE.md` requires all three before committing — they are no-ops for doc-only edits but confirm we did not accidentally touch source):

```
npm run lint
npm run typecheck
npm test
```

Expected: each exits 0.

- [ ] **Step 4: Run docs:check (CI gate)**

Run: `npm run docs:check`
Expected: exits 0 (no diff between regenerated and committed `docs/tools.generated.md`).

We are not modifying `tools.generated.md`, so this stays green; we run it locally to catch any pre-existing drift before CI does.

---

## Task 5: Commit, push, open PR

- [ ] **Step 1: Stage the change**

Run: `git add docs/help/en.md`

- [ ] **Step 2: Commit**

Run (using HEREDOC to preserve newlines):

```bash
git commit -m "$(cat <<'EOF'
docs(help): reconcile en.md with audited PRD

- Auth one-liner: drop "opt-in" framing — auth is on by default since v10.
- Feature Modules: refresh tool counts (Vault 16→18, Search 12→6, UI 3→1,
  Plugin Interop 5→6) and rewrite descriptions to surface daily-note,
  describe-template, and describe-Dataview-JS tools and to drop the
  removed UI confirm/prompt modals and migrated `vault_get_*` aspects.
- Bug-report and BRAT URLs: fix the "obisdian" typo and standardise on
  the canonical repo URL.

Refs #318
EOF
)"

- [ ] **Step 3: Verify commit**

Run: `git log --oneline -1`
Expected: a single commit titled `docs(help): reconcile en.md with audited PRD` on the current branch.

Run: `git status`
Expected: `nothing to commit, working tree clean`.

- [ ] **Step 4: Push the branch**

Run: `git push -u origin docs/issue-318-reconcile-en-md`
Expected: branch pushed and tracking origin.

- [ ] **Step 5: Open the PR**

Run:

```bash
gh pr create --title "docs(help): reconcile en.md with audited PRD" --body "$(cat <<'EOF'
Closes #318

## Summary

- Re-aligns the user manual at `docs/help/en.md` with the audited PRD (#264).
- Five surgical edits in a single commit: auth elevator pitch, four
  Feature Modules table rows, and the typo'd repo URL on lines 62 / 488.
- No behaviour changes; no restructuring.

## Test plan

- `grep -n "obisdian-plugin-mcp" docs/help/en.md` → no output
- `grep -n "opt-in HTTP Bearer" docs/help/en.md` → no output
- `grep -n "confirm/prompt modals" docs/help/en.md` → no output
- `grep -n "github.com/KingOfKalk" docs/help/en.md` → four matches, all on canonical URL
- Feature Modules table counts match `docs/tools.generated.md`
  (Vault 18, Search 6, Editor 10, Workspace 5, UI 1, Templates 3,
  Plugin Interop 6)
- `npm run lint`, `npm test`, `npm run typecheck`, `npm run docs:check`
  green locally
EOF
)"
```

- [ ] **Step 6: Verify PR opened**

Run: `gh pr view --json number,title,state,headRefName`
Expected: PR exists, title matches, state `OPEN`, head ref `docs/issue-318-reconcile-en-md`.

Hand the PR URL back to the user. Wait for them to merge — never merge yourself (`CLAUDE.md` rule 7 of the development workflow).

---

## Done

When all tasks above show ✅:

- `docs/help/en.md` reflects the audited PRD on every user-facing surface called out in #318.
- One commit on `docs/issue-318-reconcile-en-md`, pushed, with an open PR linking back to the issue.
- All six acceptance criteria from #318 are met (the sibling-locales one being a no-op since only `en.md` exists).
