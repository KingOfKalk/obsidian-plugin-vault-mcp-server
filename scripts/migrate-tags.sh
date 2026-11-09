#!/usr/bin/env bash
# One-off migration of release tags from `vX.Y.Z` to plain `X.Y.Z` (#421).
#
# For every tag `vX.Y.Z` (and the single legacy `obsidian-mcp-vX.Y.Z` tag),
# strictly in this order:
#   1. create tag `X.Y.Z` on the same commit (skipped if it already exists
#      there; aborts if it exists on a different commit),
#   2. move the GitHub release from the old tag to `X.Y.Z` and drop the
#      prefix from its title,
#   3. delete the old tag, but only once the release points at the new tag.
#
# Annotated vs. lightweight: a lightweight tag becomes a lightweight tag. An
# annotated tag becomes an annotated tag with the same message and tagger
# (name, email, date) via the Git database API; a GPG signature can't be
# carried over. The new tag object is therefore not byte-identical.
#
# Every step checks the current state first, so a second run changes nothing.
#
# Usage:
#   scripts/migrate-tags.sh --local-plan  plan from local `git tag` only, no API
#   scripts/migrate-tags.sh --dry-run     read-only API checks, print the plan
#   scripts/migrate-tags.sh --apply       perform the migration
#
# --dry-run and --apply need `gh` with GH_TOKEN and GITHUB_REPOSITORY=owner/repo.
set -euo pipefail

MODE="${1:-}"
case "$MODE" in
  --local-plan | --dry-run | --apply) ;;
  *)
    echo "usage: $0 --local-plan | --dry-run | --apply" >&2
    exit 2
    ;;
esac

TAG_RE='^(v|obsidian-mcp-v)([0-9]+\.[0-9]+\.[0-9]+.*)$'
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

log() { printf '%s\n' "$*"; }
summary() { printf '%s\n' "$*" >>"$SUMMARY"; }

# Old tags, oldest version first, so the newest release is moved last.
# Portable on purpose (macOS ships bash 3.2 and BSD sed/sort): no mapfile,
# no "\t" in sed replacements, no sort -V. awk prints "major minor patch tag"
# and sort orders numerically on the first three fields.
OLD_TAGS=()
while IFS= read -r tag; do
  [[ -n "$tag" ]] && OLD_TAGS+=("$tag")
done < <(git tag --list | grep -E "$TAG_RE" |
  awk '{ v = $0; sub(/^(obsidian-mcp-)?v/, "", v); split(v, p, /[.-]/); print p[1], p[2], p[3], $0 }' |
  sort -k1,1n -k2,2n -k3,3n | awk '{ print $4 }' || true)

new_name() { [[ "$1" =~ $TAG_RE ]] && printf '%s' "${BASH_REMATCH[2]}"; }

if [[ "$MODE" == "--local-plan" ]]; then
  log "Local plan: ${#OLD_TAGS[@]} tag(s) to migrate"
  for old in "${OLD_TAGS[@]}"; do
    kind=$(git cat-file -t "refs/tags/$old")
    [[ "$kind" == "tag" ]] && kind="annotated" || kind="lightweight"
    sha=$(git rev-list -n 1 "refs/tags/$old")
    log "  $old -> $(new_name "$old")  (${kind}, ${sha:0:7})"
  done
  others=$(git tag --list | grep -vE "$TAG_RE" | grep -vE '^[0-9]+\.[0-9]+\.[0-9]+' || true)
  log "Tags left untouched (not version tags): ${others:-none}"
  exit 0
fi

: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set to owner/repo}"
REPO="$GITHUB_REPOSITORY"
APPLY=false
[[ "$MODE" == "--apply" ]] && APPLY=true

# Commit a remote tag points to (peels annotated tags), empty if missing.
remote_tag_commit() {
  local ref type sha
  ref=$(gh api "repos/$REPO/git/ref/tags/$1" --jq '.object.type + " " + .object.sha' 2>/dev/null) || return 0
  read -r type sha <<<"$ref"
  if [[ "$type" == "tag" ]]; then
    gh api "repos/$REPO/git/tags/$sha" --jq '.object.sha'
  else
    printf '%s\n' "$sha"
  fi
}

# All releases (drafts included) as "id<TAB>tag_name<TAB>name" lines.
list_releases() {
  gh api --paginate "repos/$REPO/releases?per_page=100" \
    --jq '.[] | [(.id | tostring), .tag_name, (.name // "")] | @tsv'
}

LATEST_ID=$(gh api "repos/$REPO/releases/latest" --jq '.id' 2>/dev/null || true)
RELEASES=$(list_releases)

log "Repository: $REPO  mode: $MODE  tags: ${#OLD_TAGS[@]}  latest release id: ${LATEST_ID:-none}"
summary "## Tag migration ($MODE)"
summary ""
summary "| Old tag | New tag | Tag | Release | Old tag deleted |"
summary "| --- | --- | --- | --- | --- |"

for old in "${OLD_TAGS[@]}"; do
  new=$(new_name "$old")
  commit=$(git rev-list -n 1 "refs/tags/$old")
  log "== $old -> $new (commit ${commit:0:7})"

  # 1. New tag.
  existing=$(remote_tag_commit "$new")
  if [[ -n "$existing" && "$existing" != "$commit" ]]; then
    log "   ERROR: $new already exists on ${existing:0:7}, expected ${commit:0:7}"
    summary "| $old | $new | conflict | - | - |"
    exit 1
  elif [[ -n "$existing" ]]; then
    tag_state="exists"
    log "   tag: $new already exists, skipping"
  elif ! $APPLY; then
    tag_state="would create"
    log "   tag: would create $new"
  elif [[ "$(git cat-file -t "refs/tags/$old")" == "tag" ]]; then
    msg=$(git for-each-ref "refs/tags/$old" --format='%(contents)')
    tagger_name=$(git for-each-ref "refs/tags/$old" --format='%(taggername)')
    tagger_email=$(git for-each-ref "refs/tags/$old" --format='%(taggeremail:trim)')
    tagger_date=$(git for-each-ref "refs/tags/$old" --format='%(taggerdate:iso-strict)')
    tag_obj=$(gh api "repos/$REPO/git/tags" -f tag="$new" -f message="$msg" \
      -f object="$commit" -f type=commit -f "tagger[name]=$tagger_name" \
      -f "tagger[email]=$tagger_email" -f "tagger[date]=$tagger_date" --jq '.sha')
    gh api "repos/$REPO/git/refs" -f ref="refs/tags/$new" -f sha="$tag_obj" --silent
    tag_state="created (annotated)"
    log "   tag: created annotated $new"
  else
    gh api "repos/$REPO/git/refs" -f ref="refs/tags/$new" -f sha="$commit" --silent
    tag_state="created"
    log "   tag: created lightweight $new"
  fi

  # 2. Release.
  old_rel=$(awk -F'\t' -v t="$old" '$2 == t' <<<"$RELEASES")
  new_rel=$(awk -F'\t' -v t="$new" '$2 == t' <<<"$RELEASES")
  if [[ -n "$old_rel" ]]; then
    IFS=$'\t' read -r rel_id _ rel_name <<<"$old_rel"
    new_title="${rel_name//$old/$new}"
    new_title="${new_title//v$new/$new}"
    args=(-X PATCH "repos/$REPO/releases/$rel_id" -f tag_name="$new")
    [[ "$new_title" != "$rel_name" ]] && args+=(-f name="$new_title")
    # PATCH would otherwise mark every touched release as the latest one.
    if [[ "$rel_id" == "$LATEST_ID" ]]; then args+=(-f make_latest=true); else args+=(-f make_latest=false); fi
    if $APPLY; then
      gh api "${args[@]}" --silent
      now=$(gh api "repos/$REPO/releases/$rel_id" --jq '.tag_name')
      [[ "$now" == "$new" ]] || { log "   ERROR: release $rel_id still on $now"; exit 1; }
      rel_state="moved ($rel_id)"
      log "   release: moved $rel_id to $new, title '$rel_name' -> '$new_title'"
    else
      rel_state="would move ($rel_id)"
      log "   release: would move $rel_id to $new, title '$rel_name' -> '$new_title'"
    fi
  elif [[ -n "$new_rel" ]]; then
    rel_state="already on $new"
    log "   release: already on $new, skipping"
  else
    rel_state="none"
    log "   release: no release for $old"
  fi

  # 3. Old tag, only once the new tag exists and no release uses the old one.
  if [[ -z "$(remote_tag_commit "$old")" ]]; then
    del_state="already gone"
    log "   old tag: $old already deleted"
  elif ! $APPLY; then
    del_state="would delete"
    log "   old tag: would delete $old"
  elif [[ "$(remote_tag_commit "$new")" != "$commit" ]] ||
    [[ -n "$(list_releases | awk -F'\t' -v t="$old" '$2 == t')" ]]; then
    log "   ERROR: refusing to delete $old, $new is not in place"
    exit 1
  else
    gh api -X DELETE "repos/$REPO/git/refs/tags/$old" --silent
    del_state="deleted"
    log "   old tag: deleted $old"
  fi

  summary "| \`$old\` | \`$new\` | $tag_state | $rel_state | $del_state |"
done

# Verification.
log "== Verification"
remote_tags=$(gh api --paginate "repos/$REPO/git/matching-refs/tags" --jq '.[].ref | sub("^refs/tags/"; "")')
leftover=$(grep -E "$TAG_RE" <<<"$remote_tags" || true)
orphans=$(list_releases | awk -F'\t' 'NR == FNR { tags[$0] = 1; next } !($2 in tags) { print $2 " (release " $1 ")" }' \
  <(printf '%s\n' "$remote_tags") -)
latest_after=$(gh api "repos/$REPO/releases/latest" --jq '.tag_name' 2>/dev/null || true)

log "Remaining prefixed tags: ${leftover:-none}"
log "Releases without a matching tag: ${orphans:-none}"
log "Latest release tag: ${latest_after:-none}"
summary ""
summary "**Remaining prefixed tags:** ${leftover:-none}"
summary ""
summary "**Releases without a matching tag:** ${orphans:-none}"
summary ""
summary "**Latest release:** ${latest_after:-none}"

if $APPLY && [[ -n "$leftover" || -n "$orphans" ]]; then
  log "ERROR: verification failed"
  exit 1
fi
log "Done."
