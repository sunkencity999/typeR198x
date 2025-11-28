#!/bin/bash
set -euo pipefail

PORT=${PORT:-8000}
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required but not installed. Install Python 3 and retry." >&2
  exit 1
fi

if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use. Set a different PORT environment variable and relaunch." >&2
  exit 1
fi

trap 'echo "\nStopping local server..."; kill "$SERVER_PID" 2>/dev/null || true' EXIT

echo "Starting Type-R 198X on http://localhost:$PORT" 
python3 -m http.server "$PORT" >/dev/null 2>&1 &
SERVER_PID=$!

sleep 1
if command -v open >/dev/null 2>&1; then
  open "http://localhost:$PORT/index.html"
else
  echo "Open http://localhost:$PORT/index.html in your browser." 
fi

echo "Server running. Press Ctrl+C in this window to stop."
wait "$SERVER_PID"
