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
#   "$PY" scripts/desktop-control.py open [url]      # 默认浏览器打开（默认 http://localhost:5173/）
#   "$PY" scripts/desktop-control.py windows         # 列出可见窗口标题
#   "$PY" scripts/desktop-control.py activate <关键词>   # 激活目标窗口 —— **每次操作前必做**
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

    if cmd == "script":
        # 从文件读动作序列，**单进程连续执行**。
        # 为什么需要：每条命令单独调用之间会有几百毫秒空档，宿主应用可能在这期间抢到前台，
        # 结果是点击/输入打到别的窗口上（实测踩过——密码差点敲进聊天框）。
        # 文件格式：每行一个子命令，支持 # 注释，参数可用引号。
        import shlex

        if len(argv) < 3:
            print("用法: script <动作文件>")
            return 2
        with open(argv[2], encoding="utf-8") as f:
            lines = [ln.strip() for ln in f if ln.strip() and not ln.strip().startswith("#")]
        for line in lines:
            parts = shlex.split(line)
            if not parts:
                continue
            print(f">> {line}")
            rc = main([argv[0], *parts])
            if rc not in (0, None):
                print(f"   （该步返回 {rc}）")
        return 0

    if cmd == "focus":
        # 硬置前：ctypes 直接枚举顶层窗口 → ShowWindow(RESTORE) + SetForegroundWindow。
        # 为什么不用 pygetwindow 的 activate：宿主应用（WorkBuddy）抢走前台后，
        # pygetwindow **枚举不到** Chrome（实测连 getAllWindows 都没有它），
        # 而这条路径不依赖 visible 状态，也不会因为窗口被最小化而失败。
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        pat = (argv[2] if len(argv) > 2 else "").lower()
        if not pat:
            print("用法: focus <窗口标题的一部分>")
            return 2

        found: list[tuple[int, str]] = []
        EnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

        # ★ 必须显式声明 argtypes/restype：64 位下 HWND 是 8 字节，
        #   不声明的话 ctypes 按 C int 传参 → hwnd 被截断 → 一律取不到标题（实测踩过，
        #   表现为「明明窗口在却找不到」）。
        user32.EnumWindows.argtypes = [EnumProc, wintypes.LPARAM]
        user32.EnumWindows.restype = wintypes.BOOL
        user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
        user32.GetWindowTextLengthW.restype = ctypes.c_int
        user32.GetWindowTextW.argtypes = [wintypes.HWND, ctypes.c_wchar_p, ctypes.c_int]
        user32.GetWindowTextW.restype = ctypes.c_int
        user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
        user32.ShowWindow.restype = wintypes.BOOL
        user32.SetForegroundWindow.argtypes = [wintypes.HWND]
        user32.SetForegroundWindow.restype = wintypes.BOOL

        def _cb(hwnd, _lparam):  # noqa: ANN001
            n = user32.GetWindowTextLengthW(hwnd)
            if n == 0:
                return True
            buf = ctypes.create_unicode_buffer(n + 1)
            user32.GetWindowTextW(hwnd, buf, n + 1)
            if pat in buf.value.lower():
                found.append((int(hwnd), buf.value))
            return True

        cb_ref = EnumProc(_cb)  # 必须持引用，否则回调被回收
        user32.EnumWindows(cb_ref, wintypes.LPARAM(0))
        if not found:
            print(f"没找到标题含 {pat!r} 的窗口（含不可见/最小化）")
            return 1

        hwnd, title = found[0]
        SW_RESTORE = 9
        user32.ShowWindow(hwnd, SW_RESTORE)
        time.sleep(0.25)
        # 前台锁定绕行：先模拟一次 Alt 键，让本进程拿到前台权限
        user32.keybd_event(0x12, 0, 0, 0)
        user32.keybd_event(0x12, 0, 2, 0)
        user32.SetForegroundWindow(hwnd)
        time.sleep(0.45)
        print(f"已置前: {title}")
        return 0

    if cmd in ("windows", "windows-all"):
        import pygetwindow as gw

        show_all = cmd == "windows-all"  # windows-all 连不可见/最小化的也列出来（排查用）
        for w in gw.getAllWindows():
            title = (w.title or "").strip()
            if not title:
                continue
            vis = bool(getattr(w, "visible", False))
            mini = bool(getattr(w, "isMinimized", False))
            if not show_all and not vis:
                continue
            print(f"  [{'V' if vis else '-'}|{'M' if mini else '-'}] {title[:70]}")
        return 0

    if cmd == "activate":
        # ★ 这一步不能省：agent 执行命令时宿主应用（WorkBuddy）常会抢到前台，
        #   直接 click/type 会打到它自己身上（实测踩过）。所以每次操作前先激活目标窗口，
        #   并且**在同一个 shell 调用里**紧接着做动作。
        import pygetwindow as gw

        pat = (argv[2] if len(argv) > 2 else "").lower()
        if not pat:
            print("用法: activate <窗口标题的一部分>，例如 activate NovelMuse")
            return 2
        wins = [w for w in gw.getAllWindows() if w.visible and pat in (w.title or "").lower()]
        if not wins:
            print(f"没找到标题含 {pat!r} 的可见窗口")
            return 1
        w = wins[0]
        try:
            if getattr(w, "isMinimized", False):
                w.restore()
            w.activate()
            time.sleep(0.45)  # 等置前生效，太急会点到旧的前台窗口
            print(f"已激活: {w.title}")
        except Exception as e:  # noqa: BLE001
            print(f"激活失败（可能被系统拒绝置前）: {e}")
            return 1
        return 0

    if cmd == "open":
        # 用默认浏览器打开 URL。
        # 注：不要用 `cmd /c start` —— 那会绕过命令校验，本机安全策略直接拦。
        import webbrowser

        url = argv[2] if len(argv) > 2 else "http://localhost:5173/"
        ok = webbrowser.open(url)
        print(f"打开 {url} -> {ok}")
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
        # ★ 一律走剪贴板粘贴 —— 不要用 typewrite 逐字敲：
        #   中文输入法（IME）会截获逐字键入，**连 ASCII 都会被吞进拼音候选框**
        #   （实测：用户名 probemty3qnbx 变成了「喂日本昨天…」，密码框全空）。
        #   剪贴板粘贴不经过 IME，是唯一可靠的路子。
        import pyperclip

        try:
            prev = pyperclip.paste()
        except Exception:  # noqa: BLE001
            prev = ""
        pyperclip.copy(text)
        time.sleep(0.15)
        pyautogui.hotkey("ctrl", "v")
        time.sleep(0.3)  # 等粘贴落地再恢复剪贴板，否则可能截断
        if prev:
            try:
                pyperclip.copy(prev)  # 还回用户原来的剪贴板内容
            except Exception:  # noqa: BLE001
                pass
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
