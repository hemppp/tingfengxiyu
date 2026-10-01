#!/usr/bin/env bash
# 停止后台运行的 NovelMuse（配合 start-daemon.sh）
PID_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/data/novelmuse.pid"
if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE")"
  # tsx 包装进程会派生真实持有端口的 node 子进程，必须一并终止，否则留下孤儿服务
  pkill -f "apps/server/src/index.ts" 2>/dev/null
  kill "$PID" 2>/dev/null
  rm -f "$PID_FILE"
  echo "[stop] 已停止"
else
  echo "[stop] 未找到 PID 文件（服务未在后台运行？）"
fi
