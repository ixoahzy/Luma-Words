"""Private stdio worker, launched only with the dedicated TTS Python."""
import base64
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
protocol = sys.stdout
cancel = threading.Event()
signal.signal(signal.SIGUSR1, lambda *_: cancel.set())
parent = os.getppid()


def watch_parent():
    while True:
        time.sleep(2)
        if os.getppid() != parent: os._exit(0)


threading.Thread(target=watch_parent, daemon=True).start()
with redirect_stdout(sys.stderr):
    import torch
    import soundfile as sf
    from qwen_tts import Qwen3TTSModel
    from transformers import StoppingCriteria, StoppingCriteriaList

    class CancelGeneration(StoppingCriteria):
        def __call__(self, input_ids, scores, **kwargs): return cancel.is_set()

    model = Qwen3TTSModel.from_pretrained(str(ROOT / '.tts-models/qwen3-0.6b-customvoice'),
        device_map='mps', dtype=torch.bfloat16, attn_implementation='sdpa')
    # qwen-tts 0.1.1 drops extra generation kwargs at its outer model boundary.
    # Attach cancellation to the actual HF talker and skip decoding cancelled tokens.
    talker_generate = model.model.talker.generate

    def generate_cancellable(*args, **kwargs):
        if cancel.is_set(): raise RuntimeError('cancelled')
        kwargs['stopping_criteria'] = StoppingCriteriaList([CancelGeneration()])
        result = talker_generate(*args, **kwargs)
        if cancel.is_set(): raise RuntimeError('cancelled')
        return result

    model.model.talker.generate = generate_cancellable

for line in sys.stdin:
    cancel.clear()
    try:
        body = json.loads(line)
        text = ' '.join(part['text'] for part in body['parts'])
        languages = {part['lang'] for part in body['parts']}
        language = 'English' if languages == {'en-US'} else 'Chinese' if languages == {'zh-CN'} else 'Auto'
        with redirect_stdout(sys.stderr):
            wavs, rate = model.generate_custom_voice(text=text, language=language,
                speaker=body['speaker'], max_new_tokens=1000)
        if cancel.is_set(): raise RuntimeError('cancelled')
        output = io.BytesIO(); sf.write(output, wavs[0], rate, format='WAV', subtype='PCM_16')
        audio = output.getvalue()
        if body['rate'] != 1:
            audio = subprocess.run(['/opt/homebrew/bin/ffmpeg', '-v', 'error', '-i', 'pipe:0',
                '-af', f"atempo={body['rate']}", '-f', 'wav', 'pipe:1'], input=audio,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10, check=True).stdout
        if len(audio) > 8 * 1024 * 1024: raise RuntimeError('audio too long')
        result = {'audio': base64.b64encode(audio).decode()}
    except Exception as error:
        print(type(error).__name__ + ': ' + str(error), file=sys.stderr, flush=True)
        result = {'error': 'generation failed'}
    protocol.write(json.dumps(result) + '\n'); protocol.flush()
