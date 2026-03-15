#!/usr/bin/env bash
# Build Validator Staking frontend and restart service (served at https://stk-v3.mynode.uk/).
# Run from repo root: ./new-shared-node-staking/frontend/deploy.sh
# Or from this dir: ./deploy.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Installing dependencies (validator-staking frontend)..."
npm install --legacy-peer-deps

echo "Building..."
npm run build

echo "Restarting staking-validator-frontend.service..."
sudo systemctl stop staking-validator-frontend 2>/dev/null || true
sleep 1
if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -ti :3001 2>/dev/null) && [ -n "$PIDS" ] && echo "Freeing port 3001..." && sudo kill $PIDS 2>/dev/null && sleep 1 || true
fi
sudo systemctl start staking-validator-frontend
echo "Done. Check: sudo systemctl status staking-validator-frontend"
echo "URL: https://stk-v3.mynode.uk/"
