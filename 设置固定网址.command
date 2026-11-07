#!/bin/zsh
PROJECT_DIR=${0:A:h}
cd "$PROJECT_DIR" || exit 1
python3 "$PROJECT_DIR/scripts/setup_funnel.py"
read '?按回车关闭。'
