"""Project-local process identity helpers; never stop a foreign listener."""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import time
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
STATE = ROOT / '.remote-share'
LOCAL = 'http://127.0.0.1:8000'


def share_mode():
    try: return 'tailscale' if (STATE / 'share-mode').read_text().strip() == 'tailscale' else 'quick'
    except FileNotFoundError: return 'quick'


def listening(port):
    with socket.socket() as connection:
        connection.settimeout(.3)
        return connection.connect_ex(('127.0.0.1', port)) == 0


def belongs(pid, script):
    try:
        command = subprocess.check_output(['ps', '-p', str(int(pid)), '-o', 'command='], text=True, stderr=subprocess.DEVNULL).strip()
        return command.endswith(str(ROOT / script)) and int(pid) != os.getpid()
    except (ValueError, OSError, subprocess.SubprocessError): return False


def identity():
    try:
        with urlopen(LOCAL + '/api/host/identity', timeout=2) as response: value = json.load(response)
        if value.get('project') == str(ROOT) and belongs(value['pid'], 'server.py'): return value
    except (OSError, ValueError, KeyError): pass
    return None


def sharing():
    try:
        value = json.loads((STATE / 'launcher.json').read_text())
        if belongs(value['pid'], 'scripts/share_remote.py'): return value
    except (OSError, ValueError, KeyError): pass
    return None


def stop_process(pid, script, timeout=20):
    if not belongs(pid, script): raise RuntimeError('进程不属于当前 DeskTalk，保持原状。')
    os.kill(int(pid), signal.SIGTERM)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not belongs(pid, script): return
        time.sleep(.15)
    raise RuntimeError('DeskTalk 尚未完全停止，请检查本项目日志；未终止其他进程。')


def detached(command, log):
    STATE.mkdir(mode=0o700, exist_ok=True)
    fd = os.open(STATE / log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(fd, 'ab') as output:
        return subprocess.Popen(command, cwd=ROOT, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
