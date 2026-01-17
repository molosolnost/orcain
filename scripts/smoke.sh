#!/usr/bin/env sh
# Quick smoke: build + server/cards syntax check.
# Usage: ./scripts/smoke.sh  or  npm run test:smoke
set -e
echo "[smoke] client build..."
(cd client && npm run build)
echo "[smoke] node -c server/index.js..."
node -c server/index.js
echo "[smoke] node -c server/cards.js..."
node -c server/cards.js
echo "[smoke] OK"
