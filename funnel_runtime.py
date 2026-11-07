"""DeskTalk's isolated Tailscale node; no system VPN or shared daemon changes."""
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time

from host_runtime import STATE

DIRECTORY = STATE / 'funnel'
SOCKET = DIRECTORY / 'tailscaled.sock'
TARGET = 'http://127.0.0.1:8001'


def binary(name):
    path = shutil.which(name) or '/opt/homebrew/bin/' + name
    if not Path(path).is_file():
        raise RuntimeError('请先安装开源命令行版：brew install tailscale。')
    return path


def cli(*arguments):
    return [binary('tailscale'), '--socket=' + str(SOCKET), *arguments]


def fixed_origin(status):
    name = (status.get('Self') or {}).get('DNSName', '').rstrip('.').lower()
    if status.get('BackendState') != 'Running' or not re.fullmatch(r'[a-z0-9-]+\.[a-z0-9-]+\.ts\.net', name):
        raise RuntimeError('固定入口未就绪，请完成 Tailscale 登录和 Funnel 授权。')
    return 'https://' + name


def status():
    result = subprocess.run(cli('status', '--json'), capture_output=True, text=True, timeout=5)
    return json.loads(result.stdout)


@contextmanager
def daemon():
    DIRECTORY.mkdir(mode=0o700, parents=True, exist_ok=True)
    DIRECTORY.chmod(0o700)
    with (DIRECTORY / 'lock').open('a') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise RuntimeError('DeskTalk 的 Tailscale 节点正在使用，请先停止共享或结束授权。') from None
        fd = os.open(DIRECTORY / 'daemon.log', os.O_CREAT | os.O_WRONLY | os.O_APPEND, 0o600)
        with os.fdopen(fd, 'wb') as log:
            process = subprocess.Popen([binary('tailscaled'), '--tun=userspace-networking', '--port=0',
                '--socket=' + str(SOCKET), '--state=' + str(DIRECTORY / 'node.state')], stdout=log, stderr=log)
        try:
            for _ in range(60):
                if process.poll() is not None: raise RuntimeError('Tailscale 节点未启动，请检查 .remote-share/funnel/daemon.log。')
                if SOCKET.exists():
                    try: status(); break
                    except (OSError, ValueError, subprocess.TimeoutExpired): pass
                time.sleep(.1)
            else: raise RuntimeError('等待 Tailscale 节点启动超时。')
            yield process
        finally:
            if process.poll() is None:
                process.terminate()
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired: process.kill(); process.wait()
