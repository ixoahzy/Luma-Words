#!/bin/zsh
PROJECT_DIR=${0:A:h}
cd "$PROJECT_DIR" || exit 1
DESKTALK_PYTHON="$PROJECT_DIR/.venv-voice/bin/python"
[[ -x "$DESKTALK_PYTHON" ]] || DESKTALK_PYTHON=python3
"$DESKTALK_PYTHON" "$PROJECT_DIR/scripts/launch_desktalk.py" --stop
if [[ $? -ne 0 ]]; then
  read "?停止未完成，请查看上方提示。按回车关闭。"
fi
