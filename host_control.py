"""Local dashboard controller. Never added to the remote static/API allowlists."""
import importlib.util
import fcntl
import json
from pathlib import Path
import subprocess
import sys
from threading import Lock
import time
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
import host_runtime as runtime
from invite_store import InviteStore
import qwen_tts_backend
import voice_backend

ROOT, STATE = runtime.ROOT, runtime.STATE
QR = STATE / 'DeskTalk-邀请二维码.png'


class HostControl:
    def __init__(self, config):
        self.config = config
        self.store = InviteStore(STATE)
        self.lock = Lock()
        self.invite_url = None
        self.origin = None
        self.model_checked = 0
        self.model_reachable = False

    def rotate(self, origin):
        token = self.store.issue(origin)
        link = origin + '/join#' + token
        python = ROOT / '.venv-share/bin/python'
        if not python.exists():
            self.store.revoke()
            raise RuntimeError('二维码依赖未安装，请运行 sh scripts/setup_share.sh。')
        try:
            png = subprocess.run([str(python), str(ROOT / 'scripts/make_invite_qr.py')], input=link.encode(),
                                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True, timeout=10).stdout
            import os
            fd = os.open(str(QR) + '.tmp', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, 'wb') as out: out.write(png)
            Path(str(QR) + '.tmp').replace(QR)
        except (OSError, subprocess.SubprocessError):
            self.store.revoke(); self.invite_url = None
            raise RuntimeError('二维码生成失败，请检查 .venv-share 环境。') from None
        self.invite_url, self.origin = link, origin

    def current(self):
        state = runtime.sharing()
        running = bool(state and state.get('origin') and runtime.listening(8001))
        origin = state.get('origin') if running else None
        if origin and (origin != self.origin or not self.invite_url) and self.lock.acquire(blocking=False):
            try: self.rotate(origin)
            finally: self.lock.release()
        if not running and self.origin and self.lock.acquire(blocking=False):
            try:
                self.store.revoke(); self.invite_url = None; self.origin = None
                QR.unlink(missing_ok=True)
            finally: self.lock.release()
        invite = self.store.status()
        if not running: invite['valid'] = False
        return {'running': running, 'origin': origin, 'invite': invite, 'mode': runtime.share_mode(),
                'provider': state.get('provider', 'quick') if running else None,
                'busy': self.lock.locked() or bool(state and not state.get('origin'))}

    def action(self, name):
        if not self.lock.acquire(blocking=False): raise RuntimeError('正在处理上一次主机操作，请稍候。')
        lifecycle = None
        try:
            lifecycle = (STATE / 'start.lock').open('a')
            # The Finder launcher/stopper uses the same lock: a stop cannot miss an in-flight spawn.
            fcntl.flock(lifecycle, fcntl.LOCK_EX)
            if name == 'start':
                existing = runtime.sharing()
                if existing:
                    if not existing.get('origin') or not runtime.listening(8001): raise RuntimeError('共享服务正在启动或退出，请稍候。')
                    if not self.invite_url or self.origin != existing['origin']: self.rotate(existing['origin'])
                    return
                if runtime.listening(8001): raise RuntimeError('8001 端口被其他进程占用，未终止该进程。')
                process = runtime.detached([sys.executable, str(ROOT / 'scripts/share_remote.py')], 'share-launcher.log')
                deadline = time.monotonic() + 75
                while time.monotonic() < deadline:
                    if process.poll() is not None: raise RuntimeError('共享启动失败，请查看 .remote-share/share-launcher.log。')
                    state = runtime.sharing()
                    if state and state.get('origin') and state['pid'] == process.pid:
                        self.rotate(state['origin']); return
                    time.sleep(.25)
                if runtime.belongs(process.pid, 'scripts/share_remote.py'):
                    runtime.stop_process(process.pid, 'scripts/share_remote.py')
                raise RuntimeError('等待共享地址超时，请检查网络后重试。')
            if name == 'rotate':
                state = runtime.sharing()
                if not state or not state.get('origin') or not runtime.listening(8001): raise RuntimeError('请先开启共享。')
                self.rotate(state['origin']); return
            if name == 'stop':
                self.store.revoke(); self.invite_url = None; self.origin = None; QR.unlink(missing_ok=True)
                state = runtime.sharing()
                if state: runtime.stop_process(state['pid'], 'scripts/share_remote.py')
                return
            raise RuntimeError('未知的主机操作。')
        finally:
            if lifecycle: lifecycle.close()
            self.lock.release()

    def status(self, calls):
        result = self.current()
        if time.monotonic() - self.model_checked > 15:
            self.model_checked = time.monotonic()
            self.model_reachable = False
            base = self.config.get('QWEN_BASE_URL', 'http://localhost:11434/v1').rstrip('/')
            # This project is intentionally local; never probe an unexpected external model URL.
            if urlsplit(base).hostname in ('127.0.0.1', 'localhost'):
                try:
                    headers = {}
                    if self.config.get('QWEN_API_KEY'): headers['Authorization'] = 'Bearer ' + self.config['QWEN_API_KEY']
                    with urlopen(Request(base + '/models', headers=headers), timeout=2) as response:
                        ids = {row.get('id') for row in json.load(response).get('data', [])}
                    self.model_reachable = self.config.get('QWEN_MODEL', 'qwen2.5:latest') in ids
                except (OSError, ValueError, TypeError): pass
        result.update(local=runtime.LOCAL, website=True, modelReachable=self.model_reachable,
                      whisperInstalled=bool(importlib.util.find_spec('faster_whisper')) and (voice_backend.MODEL_DIR / 'model.bin').is_file(),
                      whisperLoaded=voice_backend._model is not None,
                      ttsInstalled=qwen_tts_backend.available(),
                      ttsRunning=qwen_tts_backend._worker is not None and qwen_tts_backend._worker.poll() is None,
                      defaultBackend=self.config.get('TTS_BACKEND', 'qwen'), lastCalls=calls, now=time.time())
        return result
