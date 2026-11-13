#!/bin/bash
set -Eeuo pipefail

APP_WORKSPACE_PATH="${APP_WORKSPACE_PATH:-$(pwd)}"
PORT="${APP_RUN_PORT:-${PORT:-5000}}"
APP_ENV="${APP_ENV:-PROD}"
export APP_ENV

cd "${APP_WORKSPACE_PATH}"
echo "Starting HTTP service on port ${PORT} for deploy..."
PORT="${PORT}" node dist/server.js
