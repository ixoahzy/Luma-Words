#!/bin/sh
set -eu
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export UV_CACHE_DIR="$PROJECT_DIR/.voice-cache/uv"
export HF_HOME="$PROJECT_DIR/.voice-cache/huggingface"
UV_BIN=${UV_BIN:-/opt/homebrew/bin/uv}
if [ ! -x "$PROJECT_DIR/.venv-voice/bin/python" ]; then
  "$UV_BIN" venv --python 3.10 --no-python-downloads "$PROJECT_DIR/.venv-voice"
fi
"$UV_BIN" pip install --python "$PROJECT_DIR/.venv-voice/bin/python" -r "$PROJECT_DIR/requirements-voice.txt"
"$PROJECT_DIR/.venv-voice/bin/python" "$PROJECT_DIR/scripts/download_voice.py"
