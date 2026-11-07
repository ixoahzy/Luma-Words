"""Run the protected DeskTalk gateway through a fixed or temporary HTTPS tunnel."""
import argparse
from contextlib import ExitStack
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import shutil
import socket
import subprocess
import sys
import time
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from invite_store import InviteStore
from host_runtime import share_mode
STATE = ROOT / '.remote-share'
STATUS = STATE / 'launcher.json'
LOCAL_BINARY = ROOT / '.tools' / 'cloudflared'
BINARY = LOCAL_BINARY if LOCAL_BINARY.is_file() else Path(shutil.which('cloudflared') or '/opt/homebrew/bin/cloudflared')


def listening(port):
    with socket.socket() as connection:
        connection.settimeout(.3)
        return connection.connect_ex(('127.0.0.1', port)) == 0


def stop_existing():
    try:
        pid = int(json.loads(STATUS.read_text())['pid'])
        command = subprocess.check_output(['ps', '-p', str(pid), '-o', 'command='], text=True)
        if str(Path(__file__).resolve()) not in command or pid == os.getpid():
            raise ValueError('进程身份不匹配')
        os.kill(pid, signal.SIGTERM)
        print('已通知共享服务关闭；本机原有 AI 服务不受影响。')
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        raise SystemExit('没有找到由本项目启动的共享进程。')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stop', action='store_true')
    arguments = parser.parse_args()
    if arguments.stop:
        stop_existing()
        return
    mode = share_mode()
    if mode == 'quick' and not BINARY.is_file():
        raise SystemExit('未找到 cloudflared，请先运行 brew install cloudflared，或将官方工具放在 .tools/cloudflared。')
    STATE.mkdir(mode=0o700, exist_ok=True)
    lock_file = (STATE / 'share.lock').open('a')
    try: fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError: raise SystemExit('本项目共享已在运行，请打开主机控制台。')
    if listening(8001):
        raise SystemExit('共享端口 8001 已被占用，请先关闭已有共享服务。')
    STATE.mkdir(mode=0o700, exist_ok=True)
    STATE.chmod(0o700)
    InviteStore(STATE).revoke()
    (STATE / 'public-origin.json').unlink(missing_ok=True)
    children, files = [], []
    tunnel_resources = ExitStack()

    def cleanup(*_):
        raise KeyboardInterrupt()

    signal.signal(signal.SIGTERM, cleanup)

    def launch(command, filename):
        path = STATE / filename
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        os.chmod(path, 0o600)
        output = os.fdopen(descriptor, 'w')
        files.append(output)
        process = subprocess.Popen(command, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT)
        children.append(process)
        return process

    def wait_port(port, process):
        for _ in range(100):
            if process.poll() is not None:
                raise RuntimeError('本机服务启动失败，请查看 .remote-share 中的对应日志。')
            if listening(port):
                return
            time.sleep(.2)
        raise RuntimeError('等待本机服务启动超时。')

    try:
        STATUS.write_text(json.dumps({'pid': os.getpid(), 'origin': None, 'phase': 'starting'}))
        STATUS.chmod(0o600)
        if not listening(8000):
            core = launch([sys.executable, str(ROOT / 'server.py')], 'website.log')
            wait_port(8000, core)
        with urlopen('http://127.0.0.1:8000/ai-chat.js', timeout=5) as response:
            if response.read() != (ROOT / 'ai-chat.js').read_bytes():
                raise RuntimeError('8000 端口运行的不是当前 DeskTalk，请先处理端口占用。')
        gateway = launch([sys.executable, str(ROOT / 'remote_gateway.py')], 'gateway.log')
        wait_port(8001, gateway)
        if mode == 'tailscale':
            from funnel_runtime import cli, daemon, fixed_origin, status, TARGET
            tunnel_node = tunnel_resources.enter_context(daemon())
            expected_origin = fixed_origin(status())
            tunnel_command = cli('funnel', '--https=443', TARGET)
            pattern = re.escape(expected_origin) + r'(?=[/\s]|$)'
        else:
            tunnel_node = None
            tunnel_command = [str(BINARY), '--no-autoupdate', 'tunnel', '--url',
                              'http://127.0.0.1:8001', '--protocol', 'http2']
            pattern = r'https://[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com'
        tunnel = launch(tunnel_command, 'tunnel.log')
        origin = None
        for _ in range(240):
            if tunnel.poll() is not None:
                raise RuntimeError('HTTPS 通道启动失败，请查看 .remote-share/tunnel.log。')
            log = (STATE / 'tunnel.log').read_text(errors='replace')
            found = re.search(pattern, log)
            if found:
                origin = found.group(0)
                break
            time.sleep(.25)
        if not origin:
            raise RuntimeError('未取得公网地址，请查看 .remote-share/tunnel.log。')
        (STATE / 'public-origin.json').write_text(json.dumps({'origin': origin}))
        STATUS.write_text(json.dumps({'pid': os.getpid(), 'origin': origin, 'provider': mode, 'children': [p.pid for p in children]}))
        STATUS.chmod(0o600)
        if Path('/usr/bin/caffeinate').exists():
            launch(['/usr/bin/caffeinate', '-i', '-w', str(tunnel.pid)], 'awake.log')
        print('共享地址：' + origin, flush=True)
        print('访问口令保存在：' + str(STATE / 'access-code.txt'), flush=True)
        print('请保持电脑开机、联网并保持此程序运行。' + ('固定地址随此 Tailscale 节点保留。' if mode == 'tailscale' else '重新启动共享程序后地址会变化。'), flush=True)
        print('关闭共享：python3 scripts/share_remote.py --stop', flush=True)
        while True:
            if any(process.poll() is not None for process in children) or (tunnel_node and tunnel_node.poll() is not None):
                raise RuntimeError('共享服务意外退出，请查看 .remote-share 中的日志后重新启动。')
            time.sleep(1)
    except KeyboardInterrupt:
        print('正在关闭共享服务。', flush=True)
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr, flush=True)
        return 1
    finally:
        InviteStore(STATE).revoke()
        (STATE / 'public-origin.json').unlink(missing_ok=True)
        (STATE / 'DeskTalk-邀请二维码.png').unlink(missing_ok=True)
        for process in reversed(children):
            if process.poll() is None:
                process.terminate()
        for process in reversed(children):
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        for output in files:
            output.close()
        tunnel_resources.close()
        if STATUS.exists():
            try:
                if json.loads(STATUS.read_text()).get('pid') == os.getpid():
                    STATUS.unlink()
            except (OSError, ValueError):
                pass
    return 0


if __name__ == '__main__':
    # Preserve an unambiguous absolute process identity for --stop even when
    # launched with the documented relative command.
    if not Path(sys.argv[0]).is_absolute():
        os.execv(sys.executable, [sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]])
    sys.exit(main())
