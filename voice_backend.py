"""Local microphone transcription. Audio is decoded in memory and never saved."""
from io import BytesIO
from pathlib import Path
from threading import Lock

MODEL_DIR = Path(__file__).resolve().parent / ".voice-models" / "base"
MAX_AUDIO_BYTES = 8 * 1024 * 1024
_model = None
_lock = Lock()


class VoiceError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def validate_recording(audio, mime, language):
    if not audio:
        raise VoiceError(400, "没有收到录音，请重新录制。")
    if len(audio) > MAX_AUDIO_BYTES:
        raise VoiceError(413, "录音过大，请控制在一分钟以内。")
    if mime not in ("audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/mpeg", "audio/aiff"):
        raise VoiceError(415, "此录音格式不受支持，请重新录制。")
    if language not in ("auto", "zh", "en"):
        raise VoiceError(400, "请选择中文、英文或自动识别。")
    return language


def transcribe_audio(audio, mime, language="auto"):
    global _model
    validate_recording(audio, mime, language)
    if not _lock.acquire(blocking=False):
        raise VoiceError(429, "上一段语音仍在识别，请稍候。")
    try:
        if not (MODEL_DIR / "model.bin").is_file():
            raise VoiceError(503, "本地语音模型尚未安装，请运行 sh scripts/setup_voice.sh。")
        try:
            from faster_whisper import WhisperModel
            from faster_whisper.audio import decode_audio
        except ImportError:
            raise VoiceError(503, "语音依赖未就绪，请运行 sh scripts/setup_voice.sh 后重启服务。") from None
        try:
            samples = decode_audio(BytesIO(audio), sampling_rate=16000)
        except Exception:
            raise VoiceError(422, "无法读取这段录音，请重试。") from None
        duration = len(samples) / 16000
        if duration > 61:
            raise VoiceError(413, "录音最长一分钟，请分段提问。")
        if duration < 0.25:
            raise VoiceError(422, "录音太短，请说完一句话后再停止。")
        if _model is None:
            _model = WhisperModel(str(MODEL_DIR), device="cpu", compute_type="int8", cpu_threads=4, local_files_only=True)
        segments, info = _model.transcribe(
            samples, language=None if language == "auto" else language,
            beam_size=3, vad_filter=True, condition_on_previous_text=False,
        )
        text = "".join(segment.text for segment in segments).strip()
        if not text:
            raise VoiceError(422, "没有识别到清晰的人声，请靠近麦克风再试一次。")
        return {"text": text[:4000], "language": info.language}
    except VoiceError:
        raise
    except Exception:
        raise VoiceError(500, "本地语音识别失败，请重试；文字聊天仍可使用。") from None
    finally:
        _lock.release()
