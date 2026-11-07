#!/bin/sh
set -eu
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
UV_BIN=${UV_BIN:-/opt/homebrew/bin/uv}
if [ ! -x "$PROJECT_DIR/.venv-share/bin/python" ]; then
  "$UV_BIN" venv --python 3.10 "$PROJECT_DIR/.venv-share"
fi
"$UV_BIN" pip install --python "$PROJECT_DIR/.venv-share/bin/python" -r "$PROJECT_DIR/requirements-share.txt"
