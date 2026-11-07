#!/bin/sh
# Dedicated environment; does not change the chat or Whisper environment.
set -eu
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export UV_CACHE_DIR="$PROJECT_DIR/.tts-cache/uv"
export HF_HOME="$PROJECT_DIR/.tts-cache"
UV_BIN=${UV_BIN:-/opt/homebrew/bin/uv}
if [ ! -x "$PROJECT_DIR/.venv-qwen-tts/bin/python" ]; then
  "$UV_BIN" venv --python 3.12 "$PROJECT_DIR/.venv-qwen-tts"
fi
"$UV_BIN" pip install --python "$PROJECT_DIR/.venv-qwen-tts/bin/python" -r "$PROJECT_DIR/requirements-qwen-tts.txt"
cd "$PROJECT_DIR"
"$PROJECT_DIR/.venv-qwen-tts/bin/python" - <<'PY'
from huggingface_hub import snapshot_download
snapshot_download(
    'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
    revision='85e237c12c027371202489a0ec509ded67b5e4b5',
    local_dir='.tts-models/qwen3-0.6b-customvoice',
    allow_patterns=['*.json', '*.safetensors', 'merges.txt', 'vocab.json'],
    max_workers=3,
)
PY
