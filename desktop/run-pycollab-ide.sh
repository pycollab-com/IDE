#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="/Users/adam/.t3/worktrees/Web/t3code-8d6345c3"
NODE_BIN="/Users/adam/.nvm/versions/node/v24.11.1/bin"
PYTHON_BIN="/Library/Frameworks/Python.framework/Versions/3.13/bin"
LOG_FILE="/tmp/pycollab-ide.log"

export PATH="$NODE_BIN:$PYTHON_BIN:/usr/bin:/bin:/usr/sbin:/sbin"
export PYCOLLAB_IDE_PYTHON="$PYTHON_BIN/python3"

cd "$REPO_ROOT"
exec "$NODE_BIN/npm" --prefix "$REPO_ROOT/desktop" start >>"$LOG_FILE" 2>&1
