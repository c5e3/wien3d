#!/bin/sh
# Pulls main, builds it and switches the live site over (run by wien3d-deploy.service every minute).
# Does nothing unless the commit or /srv/wien3d/.env changed; a failed build leaves the live site untouched
# and is not retried until something changes again.
set -eu
# everything in braces is parsed before it runs, so checking out a new version of this file mid-run is safe
{
ROOT=/srv/wien3d
REPO=$ROOT/repo
BRANCH=main
export PATH=/opt/node/bin:$PATH

cd "$REPO"
git fetch -q origin "$BRANCH"
NEW=$(git rev-parse "origin/$BRANCH")
ENVHASH=$(cat "$ROOT/.env" 2>/dev/null | sha1sum | cut -c1-12)
STAMP="$NEW $ENVHASH"
CUR=$(cat "$ROOT/deployed" 2>/dev/null || true)
[ "$STAMP" = "$CUR" ] && exit 0
[ "$STAMP" = "$(cat "$ROOT/failed" 2>/dev/null || true)" ] && exit 0

OLD=${CUR%% *}
echo "deploying $NEW (was ${OLD:-nothing})"
fail() {
  echo "deploy of $NEW failed, keeping $OLD live"
  echo "$STAMP" > "$ROOT/failed"
  [ -n "$OLD" ] && git checkout -q --force "$OLD"
  exit 1
}
trap fail EXIT

git checkout -q --force "$NEW"
git clean -q -fdx -e node_modules
LOCK=$(sha1sum package-lock.json | cut -c1-12)
if [ "$LOCK" != "$(cat node_modules/.lock-hash 2>/dev/null || true)" ]; then
  npm ci --no-audit --no-fund
  echo "$LOCK" > node_modules/.lock-hash
fi
[ -f "$ROOT/.env" ] && cp "$ROOT/.env" .env
npm run build

REL=$ROOT/releases/$(date +%Y%m%d-%H%M%S)-$(echo "$NEW" | cut -c1-7)
mkdir -p "$ROOT/releases"
cp -a dist "$REL"
ln -sfn "$REL" "$ROOT/current.tmp"
mv -T "$ROOT/current.tmp" "$ROOT/current"

# the lod2 server runs from this checkout; ask the service's ExecStartPost to restart it if its code changed
if [ -z "$OLD" ] || ! git diff --quiet "$OLD" "$NEW" -- server package-lock.json; then
  touch "$ROOT/restart-api"
fi

trap - EXIT
echo "$STAMP" > "$ROOT/deployed"
rm -f "$ROOT/failed"
ls -1d "$ROOT"/releases/* | head -n -3 | xargs -r rm -rf
echo "live: $REL"
exit 0
}
