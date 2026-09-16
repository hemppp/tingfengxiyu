#!/usr/bin/env python
# ============================================================
# 桌面控制 MCP server —— 把真鼠标键盘能力暴露成 MCP 工具
#
# 与 scripts/desktop/desktop-control.py 同一套底座（pyautogui），区别是接入方式：
#   · CLI 版：当次会话就能用（agent 通过 shell 调）
#   · 本文件：注册进 ~/.workbuddy/mcp.json，**新会话**才有工具形态
#     （MCP 工具集在会话启动时快照，需重开会话 + 在连接器页点「信任」）
#
# 注册（~/.workbuddy/mcp.json → mcpServers）：
#   "desktop-control": {
#     "command": "F:/work buddy/.workbuddy/binaries/python/envs/default/Scripts/python.exe",
#     "args": ["F:/new1.2/scripts/desktop/mcp-desktop-server.py"]
#   }
#
# 依赖：pip install pyautogui pillow pyperclip mcp   （mcp 必须 <2）
#
# 两条最重要的使用纪律（都是实测踩出来的）：
#   1. **每次点击/输入前先 focus_window** —— agent 执行操作时宿主应用会抢前台，
#      不置前就会点到宿主自己身上（曾把登录密码敲进别处）。
#   2. **优先用 run_actions** 把一串动作一次下发 —— 逐个工具调用之间的空档正是被抢焦点的窗口。
#
# 安全：FAILSAFE 保持开启（鼠标甩到屏幕左上角即中止，人工刹车）。
# ============================================================

from __future__ import annotations

import ctypes
import shlex
import time

import pyautogui
import pyperclip
from mcp.server.fastmcp import FastMCP

pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.06

mcp = FastMCP("desktop-control")


# ---------------- 底层动作（供工具与 run_actions 共用） ----------------

def _focus(title_part: str) -> str:
    """按标题片段硬置前。走 Win32 API 而不是 pygetwindow：
    宿主抢走前台后 pygetwindow 可能枚举不到目标窗口（实测）。"""
    user32 = ctypes.windll.user32
    pat = title_part.lower()
    found: list[tuple[int, str]] = []
    EnumProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

    # 必须显式声明 argtypes：64 位下 HWND 是 8 字节，不声明会被当 C int 截断，
    # 表现为「窗口明明在却找不到」。
    user32.EnumWindows.argtypes = [EnumProc, ctypes.c_void_p]
    user32.EnumWindows.restype = ctypes.c_bool
    user32.GetWindowTextLengthW.argtypes = [ctypes.c_void_p]
    user32.GetWindowTextLengthW.restype = ctypes.c_int
    user32.GetWindowTextW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_int]
    user32.GetWindowTextW.restype = ctypes.c_int
    user32.ShowWindow.argtypes = [ctypes.c_void_p, ctypes.c_int]
    user32.SetForegroundWindow.argtypes = [ctypes.c_void_p]

    def _cb(hwnd, _lp):
        n = user32.GetWindowTextLengthW(hwnd)
        if n == 0:
            return True
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(hwnd, buf, n + 1)
        if pat in buf.value.lower():
            found.append((hwnd, buf.value))
        return True

    cb_ref = EnumProc(_cb)
    user32.EnumWindows(cb_ref, None)
    if not found:
        return f"没找到标题含 {title_part!r} 的窗口"
    hwnd, title = found[0]
    SW_RESTORE = 9
    user32.ShowWindow(hwnd, SW_RESTORE)
    time.sleep(0.25)
    # 前台锁定绕行：先模拟一次 Alt 键
    user32.keybd_event(0x12, 0, 0, 0)
    user32.keybd_event(0x12, 0, 2, 0)
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.45)
    return f"已置前: {title}"


def _click(x: int, y: int, button: str = "left", clicks: int = 1) -> str:
    pyautogui.click(x=int(x), y=int(y), clicks=max(1, int(clicks)), interval=0.08, button=button)
    return f"clicked {x},{y} {button} x{clicks}"


def _type(text: str) -> str:
    """一律走剪贴板：中文输入法会截获逐字键入，**连 ASCII 都会被吞进拼音候选框**。"""
    try:
        prev = pyperclip.paste()
    except Exception:  # noqa: BLE001
        prev = ""
    pyperclip.copy(text)
    time.sleep(0.15)
    pyautogui.hotkey("ctrl", "v")
    time.sleep(0.3)
    if prev:
        try:
            pyperclip.copy(prev)
        except Exception:  # noqa: BLE001
            pass
    return f"typed {len(text)} chars (clipboard)"


def _press(keys: str) -> str:
    seq = [k for k in keys.split() if k]
    for k in seq:
        pyautogui.press(k)
        time.sleep(0.08)
    return f"pressed {' '.join(seq)}"


def _hotkey(keys: str) -> str:
    seq = [k for k in keys.split() if k]
    if len(seq) < 2:
        return "need >=2 keys, e.g. 'ctrl v'"
    pyautogui.hotkey(*seq)
    return f"hotkey {'+'.join(seq)}"


def _screenshot(path: str) -> str:
    import os
    import tempfile

    out = path or os.path.join(tempfile.gettempdir(), f"desktop-shot-{int(time.time())}.png")
    img = pyautogui.screenshot()
    img.save(out)
    return f"{out} ({img.width}x{img.height})"


# ---------------- MCP 工具 ----------------

@mcp.tool()
def focus_window(title_part: str = "NovelMuse") -> str:
    """把标题含 title_part 的窗口置前（ShowWindow + SetForegroundWindow）。

    **每次点击/输入前都要调它**：agent 执行操作时宿主应用（WorkBuddy）会抢到前台，
    不置前的话点击/输入会打在宿主自己身上（实测把登录密码敲进了别的窗口）。
    """
    return _focus(title_part)


@mcp.tool()
def run_actions(actions: str) -> str:
    """按行执行一串动作，**单进程连续跑** —— 推荐优先用它，而不是逐个调用工具：
    每次工具调用之间的空档正是宿主抢焦点的时间窗。

    每行一个子命令（# 开头为注释），支持：
      focus NovelMuse            # 硬置前（建议每段开头都写）
      wait 1.5                   # 等待秒数
      click 640 420 [left|right|double]
      move 640 420
      type_text 要输入的文本      # 中文走剪贴板，安全
      press_key enter            # 空格分隔多键
      hotkey ctrl v
      scroll -600
      screenshot [路径]
      active                     # 当前前台窗口标题

    例：
      focus NovelMuse
      wait 0.5
      click 134 865
      type_text 写第3章：陈默决定主动查清姐姐失踪的真相。
      wait 0.5
      press_key enter
    """
    log: list[str] = []
    for raw in actions.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        try:
            parts = shlex.split(line)
        except ValueError as e:
            log.append(f"{line} -> 解析失败: {e}")
            continue
        cmd, args = parts[0], parts[1:]
        try:
            if cmd in ("focus", "focus_window"):
                log.append(_focus(args[0] if args else "NovelMuse"))
            elif cmd == "wait":
                sec = float(args[0]) if args else 1.0
                time.sleep(sec)
                log.append(f"waited {sec}s")
            elif cmd == "click":
                log.append(_click(args[0], args[1], *(args[2:] or [])))
            elif cmd == "move":
                pyautogui.moveTo(int(args[0]), int(args[1]), duration=0.15)
                log.append(f"moved {args[0]},{args[1]}")
            elif cmd in ("type", "type_text"):
                log.append(_type(args[0] if args else ""))
            elif cmd in ("key", "press_key"):
                log.append(_press(" ".join(args)))
            elif cmd == "hotkey":
                log.append(_hotkey(" ".join(args)))
            elif cmd == "scroll":
                amt = int(args[0]) if args else -500
                pyautogui.scroll(amt)
                log.append(f"scrolled {amt}")
            elif cmd == "screenshot":
                log.append(_screenshot(args[0] if args else ""))
            elif cmd == "active":
                log.append(f"前台窗口: {active_window()}")
            else:
                log.append(f"{line} -> 未知子命令")
        except Exception as e:  # noqa: BLE001
            log.append(f"{line} -> 失败: {e}")
    return "\n".join(log)


@mcp.tool()
def screen_size() -> str:
    """屏幕分辨率（像素）。坐标换算前先查它。"""
    w, h = pyautogui.size()
    return f"{w}x{h}"


@mcp.tool()
def active_window() -> str:
    """当前前台窗口标题 —— 点击前用它确认目标窗口没被切走。"""
    try:
        user32 = ctypes.windll.user32
        user32.GetForegroundWindow.restype = ctypes.c_void_p
        hwnd = user32.GetForegroundWindow()
        user32.GetWindowTextLengthW.argtypes = [ctypes.c_void_p]
        n = user32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_int]
        user32.GetWindowTextW(hwnd, buf, n + 1)
        return buf.value or "(无标题)"
    except Exception as e:  # noqa: BLE001
        return f"(失败: {e})"


@mcp.tool()
def screenshot(path: str = "") -> str:
    """整屏截图存为 PNG，返回路径。**别凭想象判断界面状态，截一张看一眼。**"""
    return _screenshot(path)


@mcp.tool()
def click(x: int, y: int, button: str = "left", clicks: int = 1) -> str:
    """在屏幕绝对坐标点击。button: left/right/middle；clicks: 1 单击，2 双击。"""
    return _click(x, y, button, clicks)


@mcp.tool()
def move_mouse(x: int, y: int) -> str:
    """移动鼠标到 (x, y)，不点击（先悬停确认位置用）。"""
    pyautogui.moveTo(int(x), int(y), duration=0.15)
    return f"moved {x},{y}"


@mcp.tool()
def drag(x1: int, y1: int, x2: int, y2: int, duration: float = 0.4) -> str:
    """按住左键从 (x1,y1) 拖到 (x2,y2)。"""
    pyautogui.moveTo(x1, y1, duration=0.15)
    pyautogui.dragTo(x2, y2, duration=duration, button="left")
    return f"dragged {x1},{y1} -> {x2},{y2}"


@mcp.tool()
def type_text(text: str) -> str:
    """输入文本到当前焦点控件（中文走剪贴板，安全）。"""
    return _type(text)


@mcp.tool()
def press_key(keys: str) -> str:
    """按键，空格分隔多个顺序键。例 "enter"、"esc"、"enter tab"。"""
    return _press(keys)


@mcp.tool()
def hotkey(keys: str) -> str:
    """组合键，空格分隔。例 "ctrl v"、"ctrl shift s"、"alt tab"。"""
    return _hotkey(keys)


@mcp.tool()
def scroll(amount: int = -500) -> str:
    """滚轮滚动（负值向下）。"""
    pyautogui.scroll(int(amount))
    return f"scrolled {amount}"


if __name__ == "__main__":
    mcp.run()
