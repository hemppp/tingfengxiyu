#!/usr/bin/env python
# ============================================================
# 桌面控制 MCP server —— 把真鼠标键盘能力暴露成 MCP 工具
#
# 与 scripts/desktop-control.py 同一套底座（pyautogui），区别是接入方式：
#   · CLI 版：当次会话就能用（agent 通过 shell 调）
#   · 本文件：注册进 ~/.workbuddy/mcp.json，**下次会话**才有工具形态
#     （MCP 工具集在会话启动时快照，新装的需要重开会话 + 用户在连接器页点「信任」）
#
# 注册示例（~/.workbuddy/mcp.json → mcpServers）：
#   "desktop-control": {
#     "command": "F:/work buddy/.workbuddy/binaries/python/envs/default/Scripts/python.exe",
#     "args": ["F:/new1.2/scripts/mcp-desktop-server.py"]
#   }
#
# 依赖：pip install pyautogui pillow pyperclip mcp
#
# 安全：FAILSAFE 保持开启 —— 鼠标甩到屏幕左上角即中止（人工刹车）。
# ============================================================

from __future__ import annotations

import ctypes
import time

import pyautogui
import pyperclip
from mcp.server.fastmcp import FastMCP

pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.06

mcp = FastMCP("desktop-control")


@mcp.tool()
def screen_size() -> str:
    """返回屏幕分辨率（像素）。做坐标换算前先查它。"""
    w, h = pyautogui.size()
    return f"{w}x{h}"


@mcp.tool()
def mouse_position() -> str:
    """返回鼠标当前坐标，格式 "x,y"。"""
    x, y = pyautogui.position()
    return f"{x},{y}"


@mcp.tool()
def active_window() -> str:
    """返回当前前台窗口标题 —— 点击前用它确认目标窗口没被切换掉。"""
    try:
        user32 = ctypes.windll.user32
        hwnd = user32.GetForegroundWindow()
        length = user32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        return buf.value or "(无标题)"
    except Exception as e:  # noqa: BLE001
        return f"(失败: {e})"


@mcp.tool()
def screenshot(path: str = "") -> str:
    """截取整屏保存为 PNG，返回文件路径。

    参数 path 为空时保存到系统临时目录。截图后应当用图像查看能力确认结果，
    不要凭想象判断界面状态。
    """
    import os
    import tempfile

    out = path or os.path.join(tempfile.gettempdir(), f"desktop-shot-{int(time.time())}.png")
    img = pyautogui.screenshot()
    img.save(out)
    return f"{out} ({img.width}x{img.height})"


@mcp.tool()
def click(x: int, y: int, button: str = "left", clicks: int = 1) -> str:
    """在屏幕绝对坐标 (x, y) 点击。

    button: left / right / middle；clicks: 1 单击，2 双击。
    """
    pyautogui.click(x=x, y=y, clicks=max(1, int(clicks)), interval=0.08, button=button)
    return f"clicked {x},{y} button={button} clicks={clicks}"


@mcp.tool()
def move_mouse(x: int, y: int) -> str:
    """把鼠标移到 (x, y)，不点击（用于先悬停确认位置）。"""
    pyautogui.moveTo(x, y, duration=0.15)
    return f"moved to {x},{y}"


@mcp.tool()
def drag(x1: int, y1: int, x2: int, y2: int, duration: float = 0.4) -> str:
    """按住左键从 (x1,y1) 拖到 (x2,y2)。"""
    pyautogui.moveTo(x1, y1, duration=0.15)
    pyautogui.dragTo(x2, y2, duration=duration, button="left")
    return f"dragged {x1},{y1} -> {x2},{y2}"


@mcp.tool()
def type_text(text: str) -> str:
    """输入文本到当前焦点控件。

    中文等非 ASCII 字符会走剪贴板粘贴（pyautogui 的原生输入只支持 ASCII，
    直接输入中文会静默丢字）。
    """
    if text.isascii():
        pyautogui.typewrite(text, interval=0.02)
        return f"typed {len(text)} chars (direct)"
    pyperclip.copy(text)
    time.sleep(0.12)
    pyautogui.hotkey("ctrl", "v")
    return f"typed {len(text)} chars (clipboard)"


@mcp.tool()
def press_key(keys: str) -> str:
    """按单个键，可空格分隔多个顺序键。例如 "enter"、"esc"、"tab"、"enter tab"。"""
    seq = [k for k in keys.split() if k]
    if not seq:
        return "no key given"
    for k in seq:
        pyautogui.press(k)
        time.sleep(0.08)
    return f"pressed {' '.join(seq)}"


@mcp.tool()
def hotkey(keys: str) -> str:
    """按组合键，空格分隔。例如 "ctrl v"、"ctrl shift s"、"alt tab"。"""
    seq = [k for k in keys.split() if k]
    if len(seq) < 2:
        return "need at least 2 keys, e.g. 'ctrl v'"
    pyautogui.hotkey(*seq)
    return f"hotkey {'+'.join(seq)}"


@mcp.tool()
def scroll(amount: int = -500) -> str:
    """滚轮滚动。负值向下，正值向上（单位约为像素级刻度）。"""
    pyautogui.scroll(amount)
    return f"scrolled {amount}"


if __name__ == "__main__":
    mcp.run()
