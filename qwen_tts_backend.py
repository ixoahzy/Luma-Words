"""One persistent, isolated Qwen worker. No extra HTTP service or shared Python deps."""
import atexit
import base64
import json
import os
from pathlib import Path
import select
import signal
import subprocess
from threading import BoundedSemaphore
import time
from voice_backend import VoiceError

ROOT = Path(__file__).resolve().parent
PYTHON = ROOT / '.venv-qwen-tts/bin/python'
MODEL = ROOT / '.tts-models/qwen3-0.6b-customvoice'
SPEAKERS = ('Serena', 'Vivian', 'Uncle_Fu', 'Dylan', 'Eric', 'Ryan', 'Aiden', 'Ono_Anna', 'Sohee')
_slot = BoundedSemaphore(1)
_worker = None


def available():
    return PYTHON.is_file() and (MODEL / 'model.safetensors').is_file() and (MODEL / 'speech_tokenizer/model.safetensors').is_file()


def close_worker():
    global _worker
    worker, _worker = _worker, None
    if worker:
        if worker.poll() is None:
            worker.terminate()
            try: worker.wait(timeout=3)
            except subprocess.TimeoutExpired: worker.kill(); worker.wait()
        worker.stdin.close(); worker.stdout.close()


atexit.register(close_worker)


def synthesize(parts, options, cancelled=lambda: False):
    global _worker
    if not available():
        raise VoiceError(503, '本机 Qwen3-TTS 未安装，请运行 sh scripts/setup_qwen_tts.sh，或选择系统声音。')
    if sum(len(part['text']) for part in parts) > 1200:
        raise VoiceError(413, 'Qwen3-TTS 单次最多朗读 1200 字，请缩短回复或选择系统声音。')
    if not _slot.acquire(blocking=False):
        raise VoiceError(429, 'Qwen3-TTS 正在生成另一段语音，请稍后重播。')
    try:
        if _worker is None or _worker.poll() is not None:
            close_worker()
            cache = ROOT / '.tts-cache'; cache.mkdir(exist_ok=True)
            with (cache / 'worker.log').open('ab') as log:
                _worker = subprocess.Popen([str(PYTHON), '-u', str(ROOT / 'scripts/worker_qwen_tts.py')],
                    cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log,
                    env={**os.environ, 'HF_HOME': str(cache), 'HF_HUB_OFFLINE': '1', 'PYTORCH_ENABLE_MPS_FALLBACK': '1'})
        _worker.stdin.write((json.dumps({'parts': parts, **options}) + '\n').encode()); _worker.stdin.flush()
        deadline, abandoned = time.monotonic() + 90, False
        while True:
            if cancelled() or time.monotonic() >= deadline:
                if not abandoned:
                    abandoned = True; deadline = time.monotonic() + 5
                elif time.monotonic() >= deadline:
                    close_worker()
                    raise VoiceError(504, 'Qwen3-TTS 生成已取消或超时，请缩短文字后重播。')
                if _worker.poll() is None: _worker.send_signal(signal.SIGUSR1)
            if _worker.poll() is not None:
                raise VoiceError(503, 'Qwen3-TTS 进程已停止，请重播或选择系统声音。')
            if not select.select([_worker.stdout], [], [], .1)[0]: continue
            result = json.loads(_worker.stdout.readline())
            if abandoned or cancelled():
                raise VoiceError(499, '语音生成已取消。')
            if result.get('error'):
                raise VoiceError(503, 'Qwen3-TTS 合成失败，请重播或选择系统声音。')
            return base64.b64decode(result['audio'], validate=True)
    except (OSError, ValueError, KeyError):
        close_worker()
        raise VoiceError(503, 'Qwen3-TTS 连接失败，请重播或选择系统声音。') from None
    finally:
        _slot.release()
