#!/bin/bash
# Double-click to start Jira Linear. Close the terminal window to stop it.
cd "$(dirname "$0")"
PORT="${PORT:-8766}"
# already running in the background (deno task service:install)? just open it
if curl -fs "http://127.0.0.1:$PORT/api/status" >/dev/null 2>&1; then
  open "http://localhost:$PORT"
  exit 0
fi
if [ ! -d web/dist ]; then
  echo "Building the web app (first run)…"
  (cd web && npm install && npm run build) || { echo "Build failed"; exit 1; }
fi
deno run --allow-net --allow-read --allow-write --allow-env server/main.ts &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT
sleep 2
open "http://localhost:$PORT"
wait $SERVER_PID
