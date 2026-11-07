"""Idempotent Finder launcher. Background processes outlive this command/Codex."""
import argparse
import fcntl
import os
from pathlib import Path
import subprocess
import sys
import time
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import host_runtime as runtime


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--stop', action='store_true')
    parser.add_argument('--no-open', action='store_true')
    args = parser.parse_args()
    runtime.STATE.mkdir(mode=0o700, exist_ok=True)
    with (runtime.STATE / 'start.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.stop:
            shared = runtime.sharing()
            if shared: runtime.stop_process(shared['pid'], 'scripts/share_remote.py')
            core = runtime.identity()
            if core: runtime.stop_process(core['pid'], 'server.py')
            elif runtime.listening(8000): raise RuntimeError('8000 端口身份不匹配，未停止该进程。')
            print('DeskTalk 已停止。Ollama 与其他项目保持运行。'); return
        core = runtime.identity()
        if not core:
            if runtime.listening(8000): raise RuntimeError('8000 端口已被占用或运行旧版 DeskTalk，请先正常关闭原服务；未终止该进程。')
            python = ROOT / '.venv-voice/bin/python'
            process = runtime.detached([str(python) if python.exists() else sys.executable, str(ROOT / 'server.py')], 'website.log')
            for _ in range(80):
                if process.poll() is not None: raise RuntimeError('网站启动失败，请查看 .remote-share/website.log。')
                core = runtime.identity()
                if core: break
                time.sleep(.2)
            if not core: raise RuntimeError('等待网站启动超时，请检查本项目日志。')
        print('DeskTalk 主机控制台：http://127.0.0.1:8000/host')
        if not args.no_open: subprocess.run(['/usr/bin/open', runtime.LOCAL + '/host'], check=True)


if __name__ == '__main__':
    try: main()
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr); sys.exit(1)
