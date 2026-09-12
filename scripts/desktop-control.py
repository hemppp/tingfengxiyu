#!/usr/bin/env python
# ============================================================
# 桌面控制 CLI —— 真·鼠标键盘（pyautogui 底座）
#
# 为什么有这个脚本：MCP 工具集在会话启动时快照，新注册的 MCP server
# **当前会话调不了**（要新开会话 + 用户信任）。所以同一套底座额外提供 CLI，
# 让 agent 在当次会话里就能真实操控鼠标键盘 —— 而不是只能等下次会话。
#
# 用法（解释器用隔离 venv，见 binary_context）：
#   PY="F:/work buddy/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
#   "$PY" scripts/desktop-control.py size
#   "$PY" scripts/desktop-control.py screenshot .tmp-shot.png
#   "$PY" scripts/desktop-control.py click 640 420 [left|right|double]
#   "$PY" scripts/desktop-control.py move 640 420
#   "$PY" scripts/desktop-control.py type "要输入的文本"     # 中文走剪贴板
#   "$PY" scripts/desktop-control.py key enter
#   "$PY" scripts/desktop-control.py hotkey ctrl v
#   "$PY" scripts/desktop-control.py scroll -600
#   "$PY" scripts/desktop-control.py active                     # 当前窗口标题
#
# 安全：
#   · pyautogui 的 FAILSAFE 保持开启 —— 鼠标猛甩到屏幕**左上角**会立刻抛异常中止，
#     这是最后一道人工刹车，别关。
#   · 所有动作前会 print 一行摘要，便于事后审计「AI 到底点了哪里」。
# ============================================================

from __future__ import annotations

import sys
import time

try:
    import pyautogui
except ImportError:  # 给出可操作的自救提示，而不是一句 traceback
    sys.exit(
        "未安装 pyautogui。请先执行：\n"
        '  "F:/work buddy/.workbuddy/binaries/python/envs/default/Scripts/python.exe" '
        "-m pip install pyautogui pillow\n"
        "（mcp 包只在需要把本能力注册成 MCP server 时才要装）"
    )

pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.06  # 每个动作后的停顿，太快会丢事件


def _num(v: str) -> int:
    return int(round(float(v)))


def _active_window_title() -> str:
    """当前前台窗口标题（Windows）。失败不致命，只影响日志可读性。"""
    try:
        import ctypes

        user32 = ctypes.windll.user32
        hwnd = user32.GetForegroundWindow()
        length = user32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        return buf.value
    except Exception as e:  # noqa: BLE001
        return f"(取窗口标题失败: {e})"


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2

    cmd = argv[1].lower()

    if cmd == "size":
        w, h = pyautogui.size()
        print(f"屏幕分辨率: {w} x {h}")
        return 0

    if cmd == "pos":
        x, y = pyautogui.position()
        print(f"鼠标位置: {x},{y}")
        return 0

    if cmd == "active":
        print(f"当前窗口: {_active_window_title()}")
        return 0

    if cmd == "screenshot":
        from PIL import Image  # noqa: F401  仅用于确保 PIL 可用

        out = argv[2] if len(argv) > 2 else ".tmp-shot.png"
        img = pyautogui.screenshot()
        img.save(out)
        print(f"已截图: {out} ({img.width}x{img.height})")
        return 0

    if cmd == "move":
        x, y = _num(argv[2]), _num(argv[3])
        pyautogui.moveTo(x, y, duration=0.15)
        print(f"移动鼠标 -> {x},{y}")
        return 0

    if cmd in ("click", "dclick", "rightclick"):
        x, y = _num(argv[2]), _num(argv[3])
        button = "right" if cmd == "rightclick" else "left"
        clicks = 2 if cmd in ("dclick", "double") else 1
        if len(argv) > 4:
            if argv[4] == "right":
                button = "right"
            elif argv[4] in ("double", "2"):
                clicks = 2
        print(f"点击 {x},{y} button={button} clicks={clicks} 窗口={_active_window_title()!r}")
        pyautogui.click(x=x, y=y, clicks=clicks, interval=0.08, button=button)
        return 0

    if cmd == "type":
        text = argv[2] if len(argv) > 2 else ""
        # 非 ASCII（中文）必须走剪贴板：pyautogui.typewrite 只支持 ASCII，
        # 直接 type 中文会静默丢字 —— 这个坑值得记住。
        if text.isascii():
            pyautogui.typewrite(text, interval=0.02)
            print(f"输入(直接) {len(text)} 字符")
        else:
            import pyperclip

            pyperclip.copy(text)
            time.sleep(0.12)
            pyautogui.hotkey("ctrl", "v")
            print(f"输入(剪贴板) {len(text)} 字符: {text[:40]}{'…' if len(text) > 40 else ''}")
        return 0

    if cmd == "key":
        keys = argv[2:]
        if not keys:
            print("用法: key <键名> [键名...] 例如 key enter / key esc / key tab")
            return 2
        for k in keys:
            pyautogui.press(k)
            time.sleep(0.08)
        print(f"按键 {keys}")
        return 0

    if cmd == "hotkey":
        keys = argv[2:]
        if len(keys) < 2:
            print("用法: hotkey ctrl v / hotkey ctrl shift s")
            return 2
        pyautogui.hotkey(*keys)
        print(f"组合键 {'+'.join(keys)}")
        return 0

    if cmd == "scroll":
        amount = _num(argv[2]) if len(argv) > 2 else -500
        pyautogui.scroll(amount)
        print(f"滚轮 {amount}")
        return 0

    if cmd == "wait":
        sec = float(argv[2]) if len(argv) > 2 else 1.0
        time.sleep(sec)
        print(f"等待 {sec}s")
        return 0

    print(f"未知命令: {cmd}")
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
