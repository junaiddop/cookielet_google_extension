#!/usr/bin/env bash
#
# Rebuild the public `main` branch from a source branch, minus internal-only paths.
#
#   bash scripts/sync-main.sh                 # main <- main_raw (new commit on top of main)
#   bash scripts/sync-main.sh some-branch     # main <- some-branch
#   bash scripts/sync-main.sh main_raw --orphan   # discard main's history entirely
#
# `main` is *generated*, never hand-edited and never merged into. Every file it
# contains comes from the source branch; the paths in EXCLUDE below are dropped
# and .gitignore.main is installed as main's .gitignore.
#
# Because the tree is assembled directly (git read-tree / commit-tree) there is
# no merge and therefore no modify/delete conflict, however often docs change.
set -euo pipefail

SRC="main_raw"
DST="${DST_BRANCH:-main}"
ORPHAN=0
for arg in "$@"; do
  case "$arg" in
    --orphan) ORPHAN=1 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) SRC="$arg" ;;
  esac
done

# Paths on the source branch that must never appear on `main`.
EXCLUDE=(
  CLAUDE.md
  code.md
  docs
  dist
  .gitignore.main
  scripts/sync-main.sh
  scripts/install-branch-ignore-hook.sh
)

cd "$(git rev-parse --show-toplevel)"

git rev-parse --verify --quiet "${SRC}^{commit}" >/dev/null \
  || { echo "error: no such branch: $SRC" >&2; exit 1; }

if [ "$(git rev-parse --abbrev-ref HEAD)" = "$DST" ]; then
  echo "error: '$DST' is checked out; switch to $SRC first (git checkout $SRC)" >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export GIT_INDEX_FILE="$tmp/index"

git read-tree "$SRC"
git rm -r --cached -q -f --ignore-unmatch -- "${EXCLUDE[@]}"

# main ships .gitignore.main as its own .gitignore.
if git cat-file -e "${SRC}:.gitignore.main" 2>/dev/null; then
  blob="$(git rev-parse "${SRC}:.gitignore.main")"
  git update-index --add --cacheinfo "100644,${blob},.gitignore"
fi

tree="$(git write-tree)"
unset GIT_INDEX_FILE

src_sha="$(git rev-parse --short "$SRC")"
msg="sync: ${DST} from ${SRC} @ ${src_sha}"

parent="$(git rev-parse --verify --quiet "refs/heads/${DST}" || true)"
if [ "$ORPHAN" = "1" ]; then parent=""; fi

if [ -n "$parent" ]; then
  if [ "$(git rev-parse "${parent}^{tree}")" = "$tree" ]; then
    echo "$DST is already in sync with $SRC ($src_sha) — nothing to do."
    exit 0
  fi
  new="$(git commit-tree "$tree" -p "$parent" -m "$msg")"
else
  new="$(git commit-tree "$tree" -m "$msg")"
fi

git update-ref "refs/heads/${DST}" "$new"
echo "$DST -> $(git rev-parse --short "$new")  ($msg)"
echo
git ls-tree -r --name-only "$DST" | awk -F/ '{print $1}' | sort -u | sed 's/^/  /'
echo
if [ "$ORPHAN" = "1" ]; then
  echo "History was discarded — publish with:  git push --force-with-lease origin ${DST}"
else
  echo "Publish with:  git push origin ${DST}"
fi
