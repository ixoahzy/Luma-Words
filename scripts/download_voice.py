"""Download only the local multilingual speech model, never user audio."""
from pathlib import Path

from huggingface_hub import snapshot_download

root = Path(__file__).resolve().parent.parent
snapshot_download(
    "Systran/faster-whisper-base",
    local_dir=root / ".voice-models" / "base",
    allow_patterns=["config.json", "model.bin", "tokenizer.json", "vocabulary.*"],
)
print("Local voice model is ready.")
