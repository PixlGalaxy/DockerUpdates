#!/usr/bin/env sh
# Publishes docs/wiki to the GitHub wiki of the repository.
#
# The wiki must exist first: enable it (Settings > Features > Wikis) and create any first
# page from the web. Then, from the repository root, with push access to GitHub:
#
#   sh scripts/publish-wiki.sh
#
# Pages use "Page.md" links so they also work when browsing docs/wiki on GitHub;
# they are rewritten to wiki links ("Page") while copying.
set -eu

REPO_URL="${WIKI_URL:-https://github.com/PixlGalaxy/DockerUpdates.wiki.git}"
SRC="$(cd "$(dirname "$0")/../docs/wiki" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --quiet "$REPO_URL" "$TMP/wiki"

for f in "$SRC"/*.md; do
  name="$(basename "$f")"
  [ "$name" = "README.md" ] && continue
  # ](Page.md) -> ](Page)   ](Page.md#anchor) -> ](Page#anchor)   (relative links only)
  sed -E 's/\]\(([A-Za-z0-9_-]+)\.md([)#])/](\1\2/g' "$f" > "$TMP/wiki/$name"
done

cd "$TMP/wiki"
git add -A
if git diff --cached --quiet; then
  echo "The wiki is already up to date."
  exit 0
fi
git commit --quiet -m "Update documentation from docs/wiki"
git push --quiet
echo "Wiki updated: ${REPO_URL%.git}"
