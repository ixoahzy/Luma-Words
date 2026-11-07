"""Render installed macOS voices to WAV for playback on the caller's device."""
from functools import lru_cache
from io import BytesIO
from pathlib import Path
import math
import re
import shutil
import subprocess
from tempfile import TemporaryDirectory
from threading import BoundedSemaphore
import time
import wave
from voice_backend import VoiceError
import qwen_tts_backend

_slots = BoundedSemaphore(2)


def validate_speech(body):
    if not isinstance(body, dict):
        raise VoiceError(400, "语音请求格式不正确。")
    parts = body.get("parts")
    if not isinstance(parts, list) or not 1 <= len(parts) <= 24:
        raise VoiceError(400, "语音内容为空或过长。")
    clean = []
    for part in parts:
        if (not isinstance(part, dict) or part.get("lang") not in ("en-US", "zh-CN")
                or not isinstance(part.get("text"), str) or not part["text"].strip()):
            raise VoiceError(400, "语音内容或语言不正确。")
        clean.append({"text": part["text"].replace("[[", "(").replace("]]", ")"), "lang": part["lang"]})
    if sum(len(part["text"]) for part in clean) > 4000:
        raise VoiceError(413, "单次朗读最多 4000 字。")
    rate, pause = body.get("rate", 1), body.get("pause", 120)
    if (isinstance(rate, bool) or not isinstance(rate, (int, float)) or not math.isfinite(rate)
            or not 0.8 <= rate <= 1.2 or isinstance(pause, bool) or pause not in (0, 120, 300)):
        raise VoiceError(400, "朗读语速或停顿设置不正确。")
    options = {"rate": rate, "pause": int(pause)}
    backend, speaker = body.get('backend', 'system'), body.get('speaker', 'Serena')
    if backend not in ('system', 'qwen') or speaker not in qwen_tts_backend.SPEAKERS:
        raise VoiceError(400, '语音后端或角色音色不正确。')
    options.update(backend=backend, speaker=speaker)
    for key in ("enVoiceName", "zhVoiceName"):
        name = body.get(key, "")
        if not isinstance(name, str) or len(name) > 200:
            raise VoiceError(400, "音色设置不正确。")
        options[key] = name
    return clean, options


@lru_cache(maxsize=1)
def installed_voices():
    output = subprocess.check_output(["/usr/bin/say", "-v", "?"], timeout=5, text=True)
    voices = []
    for line in output.splitlines():
        match = re.match(r"(.+?)\s{2,}([a-z]{2}_[A-Z]{2})\s+#", line)
        if match:
            voices.append((match[1].strip(), match[2]))
    return voices


def speech_capabilities(default='qwen'):
    return {'defaultBackend': default if default in ('qwen', 'system') else 'qwen',
            'qwenAvailable': qwen_tts_backend.available(), 'speakers': qwen_tts_backend.SPEAKERS,
            'systemVoices': [{'name': name, 'lang': lang.replace('_', '-'), 'voiceURI': name, 'localService': True}
                             for name, lang in installed_voices()]}


def synthesize_speech(body, cancelled=lambda: False):
    parts, options = validate_speech(body)
    if options['backend'] == 'qwen':
        return qwen_tts_backend.synthesize(parts, options, cancelled)
    ffmpeg = shutil.which("ffmpeg")
    if not Path("/usr/bin/say").is_file() or not ffmpeg:
        raise VoiceError(503, "本机语音合成不可用，需要 macOS 系统声音和已有的 ffmpeg。")
    if not _slots.acquire(blocking=False):
        raise VoiceError(429, "语音服务正忙，请稍后重播。")
    try:
        voices = installed_voices()
        pcm, deadline = [], time.monotonic() + 40
        with TemporaryDirectory(prefix="desktalk-speech-") as directory:
            for index, part in enumerate(parts):
                prefix = part["lang"][:2]
                available = [name for name, lang in voices if lang.startswith(prefix)]
                requested = options["enVoiceName" if prefix == "en" else "zhVoiceName"]
                voice = next((name for name in available if name == requested), None)
                if not voice:
                    preferred = ("Samantha", "Daniel", "Karen") if prefix == "en" else ("Tingting", "Ting-Ting", "Meijia", "Sinji")
                    voice = next((name for name in preferred if name in available), available[0] if available else None)
                if not voice:
                    raise VoiceError(503, "没有安装所需语言的系统声音，请在 macOS 声音设置中添加。")
                text_path, audio_path = Path(directory) / "text.txt", Path(directory) / "speech.aiff"
                text_path.write_text(part["text"], encoding="utf-8")
                remaining = max(.1, deadline - time.monotonic())
                subprocess.run(["/usr/bin/say", "-v", voice, "-r", str(round(180 * options["rate"])), "-o", str(audio_path), "-f", str(text_path)],
                               check=True, timeout=remaining, capture_output=True)
                raw = subprocess.run([ffmpeg, "-v", "error", "-i", str(audio_path), "-ar", "24000", "-ac", "1", "-f", "s16le", "pipe:1"],
                                     check=True, timeout=max(.1, deadline - time.monotonic()), capture_output=True).stdout
                pcm.append(raw)
                if index + 1 < len(parts):
                    pcm.append(b"\0\0" * (24 * options["pause"]))
                if sum(len(chunk) for chunk in pcm) > 8 * 1024 * 1024:
                    raise VoiceError(413, "生成的语音过长，请缩短回复后再试。")
        output = BytesIO()
        with wave.open(output, "wb") as audio:
            audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(24000)
            audio.writeframes(b"".join(pcm))
        return output.getvalue()
    except (subprocess.SubprocessError, OSError):
        raise VoiceError(503, "系统语音生成失败，请点击重播或检查本机声音设置。") from None
    finally:
        _slots.release()
