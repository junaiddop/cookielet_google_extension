#!/usr/bin/env bash
#
# Install a post-checkout hook that swaps in branch-specific ignore rules.
#
#   bash scripts/install-branch-ignore-hook.sh
#
# On every branch checkout the hook copies .git/info/gitignore.<branch> over
# .git/info/exclude (a local, unversioned .gitignore for this clone).
#
# NOTE: this only affects *untracked* files. It cannot remove a file that is
# already committed on a branch — that is what scripts/sync-main.sh does.
# The tracked .gitignore on each branch is the primary mechanism; this hook is
# a local safety net so `git add .` on any branch can't stage internal docs.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
git_dir="$(git rev-parse --git-dir)"
mkdir -p "$git_dir/info"

cat > "$git_dir/hooks/post-checkout" <<'HOOK'
#!/usr/bin/env bash
# Branch-specific ignore rules: .git/info/gitignore.<branch> -> .git/info/exclude
# Installed by scripts/install-branch-ignore-hook.sh — edits nothing tracked.
[ "$3" = "1" ] || exit 0   # $3=1 means branch checkout, 0 means file checkout
git_dir="$(git rev-parse --git-dir)"
branch="$(git rev-parse --abbrev-ref HEAD)"
src="$git_dir/info/gitignore.$branch"
[ -f "$src" ] || src="$git_dir/info/gitignore.default"
[ -f "$src" ] || exit 0
cp "$src" "$git_dir/info/exclude"
HOOK
chmod 755 "$git_dir/hooks/post-checkout"

cat > "$git_dir/info/gitignore.default" <<'IGN'
# Local ignore rules for any branch without its own template.
node_modules/
.DS_Store
*.log
IGN

cat > "$git_dir/info/gitignore.main" <<'IGN'
# Local ignore rules while `main` is checked out.
# Internal-only paths: never stage these on the public branch.
CLAUDE.md
code.md
/docs
/dist
node_modules/
.DS_Store
*.log
IGN

cp "$git_dir/info/gitignore.default" "$git_dir/info/gitignore.main_raw"

echo "installed: $git_dir/hooks/post-checkout"
echo "templates: $(ls "$git_dir"/info/gitignore.* | sed "s|$git_dir/info/||" | tr '\n' ' ')"
