#!/bin/sh
# Development helper: put the current web files into the data folder of a running endpoint as an update that is
# always used (no image build, no restart of the endpoint that answers the batteries), then restart only the
# web process. Needs ssh access to the Docker host and a container named marstek-offline-endpoint.
#   tools/dev-push.sh user@dockerhost /path/to/marstek-offline-endpoint/data
# The result is a test build: it carries the version of web-version.json plus "-dev" in the name of its folder.
set -e
HOST="$1"; DATA="$2"
[ -n "$HOST" ] && [ -n "$DATA" ] || { echo "usage: $0 user@host /host/path/to/data"; exit 2; }
cd "$(dirname "$0")/../src"
VER=$(node -e "console.log(require('./web-version.json').version)")
DIR="$DATA/web-override/$VER"
FILES="web.cjs auth.cjs devices.cjs history.cjs updates.cjs ping.cjs db.cjs keydefs.cjs notify.cjs mqtt.cjs support.cjs store.cjs logbuf.cjs uptime-history.cjs webupdate.cjs web-version.json"
LIST=$(node -e "const f='$FILES'.split(' ');for(const n of require('fs').readdirSync('web'))f.push('web/'+n);console.log(JSON.stringify(f))")
tar czf - $FILES web | ssh "$HOST" "sudo rm -rf '$DIR' && sudo mkdir -p '$DIR' && sudo tar xzf - -C '$DIR'"
printf '{"version":"%s","requires":{"ipc":1},"files":%s}' "$VER" "$LIST" | ssh "$HOST" "sudo tee '$DIR/manifest.json' >/dev/null"
printf '{"version":"%s","force":true,"installedAt":%s}' "$VER" "$(date +%s)000" | ssh "$HOST" "sudo tee '$DATA/web-override/current.json' >/dev/null"
ssh "$HOST" "docker exec marstek-offline-endpoint pkill -TERM -f webproc.cjs" || true
echo "web $VER pushed; the web process restarts in a moment"
