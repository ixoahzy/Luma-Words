"""One-time account authorization for the isolated DeskTalk node."""
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from funnel_runtime import cli, daemon, fixed_origin, status, TARGET
from host_runtime import STATE


def main():
    with daemon():
        subprocess.run(cli('up', '--hostname=desktalk', '--accept-dns=false', '--accept-routes=false'), check=True)
        origin = fixed_origin(status())
        # The CLI prompts the owner to enable HTTPS/Funnel if the tailnet needs it.
        command = cli('funnel', '--bg', '--https=443', TARGET)
        try: subprocess.run(command, check=True)
        finally: subprocess.run(command + ['off'], check=False)
        path = STATE / 'share-mode'
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as out: out.write('tailscale\n')
        print('已完成授权，固定地址：' + origin)
        print('返回主机控制台开启共享。若旧临时通道在运行，请先停止它。')


if __name__ == '__main__':
    try: main()
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as error:
        print('固定入口设置未完成：' + str(error), file=sys.stderr); sys.exit(1)
