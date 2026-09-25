#!/usr/bin/env bash
# Build a static snapshot of the site and publish it to the gh-pages branch (GitHub Pages).
# Data = current local data/poc.db. Re-run after `npm run ingest` to refresh the live site.
set -euo pipefail

# Git Bash (MSYS) on Windows rewrites arguments and env values that look like POSIX paths,
# e.g. VITE_BASE="/<repo>/" becomes "C:/Program Files/Git/<repo>/", which breaks every asset
# URL, the router basename and the static API path. Turn that conversion off.
# Harmless on macOS/Linux: these variables are only read by MSYS.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

cd "$(dirname "$0")/.."
REMOTE_URL=$(git remote get-url origin)
REPO_NAME=$(basename -s .git "$REMOTE_URL")
OUT=dist/web

echo "[DEPLOY] building for /$REPO_NAME/"
VITE_STATIC_API=1 VITE_BASE="/$REPO_NAME/" npx vite build --config web/vite.config.ts
npx tsx src/export.ts "$OUT"

# SPA fallback: GitHub Pages serves 404.html for deep links like /notices/3 or /calendar
cp "$OUT/index.html" "$OUT/404.html"
touch "$OUT/.nojekyll"

# Publish as a single fresh commit on gh-pages (the branch only ever holds build output)
cd "$OUT"
rm -rf .git
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C ../.. config user.name)" -c user.email="$(git -C ../.. config user.email)" \
  commit -q -m "Deploy $(date -u +%Y-%m-%dT%H:%MZ) from $(git -C ../.. rev-parse --short HEAD)"
git push -q -f "$REMOTE_URL" gh-pages
rm -rf .git
echo "[DEPLOY] pushed gh-pages"
