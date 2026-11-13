#!/bin/bash
set -Eeuo pipefail

APP_WORKSPACE_PATH="${APP_WORKSPACE_PATH:-$(pwd)}"

cd "${APP_WORKSPACE_PATH}"

echo "Installing dependencies..."
bash "$APP_WORKSPACE_PATH/scripts/prepare-node-modules.sh" --prefer-frozen-lockfile --prefer-offline --loglevel debug --reporter=append-only


