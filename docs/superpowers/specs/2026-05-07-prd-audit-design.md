# PRD Audit — Design

- **Issue:** [#264](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/264)
- **Audit date:** 2026-05-07
- **PRD last touched:** 2026-05-02
- **Branch (planned):** `chore/issue-264-prd-audit`

## Goal

Bring `docs/PRD.md` back into agreement with shipped behaviour. Every
existing ID (R\*, CR\*, NFR\*, TR\*, DR\*, I\*) is marked ✅, ⚠️, ❌, or 🆕
inline. Drifted requirements are struck through and replaced with new
IDs. Follow-up GitHub issues are filed for any code or manual gaps the
audit surfaces. The audit itself does not change product behaviour.

## Scope

### In scope

- Every R\*, CR\*, NFR\*, TR\*, DR\*, I\* ID in `docs/PRD.md`.
- Cross-checks against the live codebase:
  - `src/tools/**` and `docs/tools.generated.md` for tool-related IDs.
  - `src/settings/**` and `src/types.ts` for settings IDs.
  - `src/server/**` for transport, auth, and CORS IDs.
  - `src/lang/**` for I18N IDs.
  - `src/utils/logger.ts`, status bar, and diagnostics code for
    observability IDs.
  - `package.json` and `.github/workflows/**` for build/CI IDs.
- A spot-check of `docs/help/en.md` while marking each PRD requirement.
  When a setting, command, tool, or other user-facing surface is touched
  during the sweep, glance at the manual entry for it; if it's missing,
  out of date, or contradicts the code, capture the gap. Non-trivial
  drift is rolled into a single follow-up issue.
- New IDs (🆕) for protocol-visible behaviour AND LLM-facing metadata
  (tool titles, output schemas, MCP `instructions`, MCP resources, MCP
  prompts) that ship today but are not described in the PRD.

### Out of scope

- Implementing any of the changes the audit recommends. Each becomes
  its own GitHub issue.
- Restructuring the PRD or rewording untouched requirements.
- Translating the PRD or editing `docs/help/de.md`.
- A full manual-vs-code re-read. The manual is spot-checked only.
- Internal architecture details (e.g. the TypedHandler signature, the
  registry shape) that have no protocol-visible or LLM-visible effect.

## Notation conventions

Inline format applied per ID:

- ✅ items: **no change**. Untouched bullets read as "audited and
  matches current behaviour".
- ⚠️ items: keep the original text and append
  `— *audit (2026-05-07): <one-line reason>*` after the description.
- ❌ items: strike through the original line in place (`~~CR16~~`-style)
  and add a new ID below it. The new ID references the struck-through
  one in its body, per the PRD's existing ID Governance rules.
- 🆕 items: insert a new ID under the appropriate subsection. No
  strike-through.

New IDs continue the existing per-prefix counters:

- Next R is `R56`.
- Next CR is `CR28`.
- Next NFR is `NFR37`.
- Next TR is `TR28`.

## Audit method

One top-to-bottom sweep through `docs/PRD.md`. For each ID:

1. **Tool requirements (R1–R55)** — diff against `docs/tools.generated.md`
   and the implementation files under `src/tools/<module>/`.
2. **Configuration requirements (CR\*)** — read against `src/settings/**`
   and the persisted shape in `src/types.ts`. Verify each row in the
   settings UI still exists, still has the described default, and
   persists under the documented key.
3. **Server/auth requirements (NFR5, NFR6, NFR8–NFR10, NFR32, NFR34)** —
   read against `src/server/**` (`http-server.ts`, `auth.ts`, transport
   wiring). Particular attention to **CR24** / **NFR5** /
   Appendix A v6, because issue #253 (now closed) was supposed to flip
   the auth default — the PRD body still says "default off" and may now
   be ❌.
4. **Internationalization (I1–I4)** — read against `src/lang/helpers.ts`
   and `src/lang/locale/*.ts`.
5. **Diagnostics and observability (CR22, CR23, NFR24–NFR26, NFR36)** —
   read against the diagnostics modal, the logger, and the status-bar
   integration.
6. **Build, test, and CI (TR\*)** — read against `package.json`,
   `tsconfig.json`, `eslint.config.*`, `.prettierrc*`, and every
   workflow under `.github/workflows/`.
7. **Documentation (DR\*)** — check the repo root and `docs/` for the
   referenced files.

For each ID, either silently confirm ✅ or write the audit note (and,
for ❌, the strike-through plus replacement ID).

## Already-known 🆕 candidates

From the post-2026-05-02 commit log and `docs/tools.generated.md`:

- `vault_get_aspect` (PR #307) — replaces R20–R23 and R26 (the original
  per-aspect getters). Those four R\*s likely become ❌ with a new R\*
  describing the unified aspect tool.
- `vault_daily_note` tool (the underlying tool of PR #313) — new R\*.
- MCP resources exposing vault files (PR #303) — new TR\* under "MCP
  Server" (transport surface beyond tools).
- MCP prompts / slash commands (PRs #306, #313, #314) — new TR\* (or a
  small subsection) describing the prompt registration surface.
- MCP server `instructions` field (PR #301) — new TR\*.
- Output schemas on read tools (PR #288) — new TR\*. LLM-facing
  metadata, in scope per the audit decision.
- Tool titles and sibling cross-references (PRs #296, #310–#312) — new
  TR\* covering tool annotations.
- Plugin id rename to `vault-mcp-server` (PR #308) — TR3 mentions
  `manifest.json` but does not pin the id; verify and either ✅ or add
  an audit note that fixes the wording.
- `extras_get_date` rename (issue #251, closed) — R55 already names the
  tool correctly; expected ✅.
- Auth default flip (issue #253, closed) — possible mismatch between
  shipped behaviour and CR24 / NFR5 / Appendix A v6. Will be the most
  important verification step.
- `search_*` / `vault_*` rename pass (issue #255, closed) — R17–R28
  prose vs. the shipped tool names in `docs/tools.generated.md` may
  need ⚠️ on each affected R, or a single grouped note.

This list is the working hypothesis only. Final markings come from the
sweep itself, not from this list.

## Deliverables

1. **One PR** updating `docs/PRD.md` with inline audit notes,
   strike-throughs, and new IDs. Title: `chore(docs/prd): audit
   requirement IDs against current code (#264)`.
2. **N follow-up GitHub issues**, one per code or manual gap the audit
   surfaces. Each issue links back to #264. The PR description lists
   them.
3. **Branch:** `chore/issue-264-prd-audit`.
4. **PR description note:** issue #264's scope text describes the four
   mcp-builder follow-ups (#249/#250/#251/#253/#254/#255) as "pending",
   but they are now closed. The substance of the audit is unchanged —
   they participate in the normal ✅/⚠️/❌/🆕 marking — and the
   discrepancy is recorded in the PR description so the issue's framing
   can be tidied up after merge.

## Risks

- **Auth default mismatch** — PRD body and Appendix A v6 both state
  `authEnabled` defaults to `false`. If issue #253 flipped the actual
  default to `true`, the PRD entries for CR24, CR2, CR21, NFR5, and
  Appendix A v6 all need ❌ treatment plus replacement IDs. Verifying
  this is the highest-priority single check in the sweep.
- **Tool rename reconciliation** — issue #255 renamed `search_*`
  getters; the PRD prose for R17–R28 may not reflect the shipped tool
  names. Either each affected R gets a ⚠️ note, or a single grouped
  note covers the rename — decide during the sweep based on how many
  are affected.
- **PR diff size** — 14 commits have landed since the PRD was last
  touched. The PR will be additive (mostly new IDs and audit notes,
  not deletions), so reviewer load is the trade-off, not correctness
  risk. The follow-up issues are independent of the audit PR and can
  be triaged separately.

## Acceptance criteria (mirrors issue #264)

- [ ] Every R\*, CR\*, NFR\*, TR\*, DR\*, I\* ID in `docs/PRD.md` has
      either no change (✅) or an inline audit note.
- [ ] Drifted/removed requirements are struck through with a brief
      reason, and the replacement ID references the struck-through one.
- [ ] New requirements implemented since the last PRD pass have new IDs
      assigned in the appropriate subsection.
- [ ] Follow-up issues are filed for any code or manual changes the
      audit recommends, and listed in the PR description.
- [ ] `docs/help/en.md` agreement with the PRD is verified by spot
      check; non-trivial drift, if any, is captured in a single
      follow-up issue.
