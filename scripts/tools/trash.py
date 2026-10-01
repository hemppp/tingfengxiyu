#!/usr/bin/env python
# ============================================================
# 送回收站（不是 rm）—— 清理项目垃圾时用它，删错了还能捞回来
#
# 为什么不用 rm / Remove-Item：
#   · rm 直接抹掉，回收站都进不去
#   · PowerShell 5.1 传中文路径容易踩编码坑
# 这里直接调 Windows Shell API（SHFileOperationW + FOF_ALLOWUNDO），
# 中文路径安全，且行为与「右键 → 删除」完全一致。
#
# 用法：
#   PY="F:/work buddy/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
#   "$PY" scripts/tools/trash.py <路径1> <路径2> ...          # 送回收站
#   "$PY" scripts/tools/trash.py --list <路径> ...            # 只看会删什么，不动手
#
# 退出码：0 全部成功；1 有失败（逐条打印原因）
# ============================================================

from __future__ import annotations

import ctypes
import os
import sys
from ctypes import wintypes

FO_DELETE = 3
FOF_SILENT = 0x0004
FOF_NOCONFIRMATION = 0x0010
FOF_ALLOWUNDO = 0x0040
FOF_NOERRORUI = 0x0400


class SHFILEOPSTRUCTW(ctypes.Structure):
    _fields_ = [
        ("hwnd", wintypes.HWND),
        ("wFunc", wintypes.UINT),
        ("pFrom", wintypes.LPCWSTR),
        ("pTo", wintypes.LPCWSTR),
        ("fFlags", ctypes.c_ushort),
        ("fAnyOperationsAborted", wintypes.BOOL),
        ("hNameMappings", ctypes.c_void_p),
        ("lpszProgressTitle", wintypes.LPCWSTR),
    ]


def _trash_one(path: str) -> tuple[bool, str]:
    abspath = os.path.abspath(path)
    if not os.path.exists(abspath):
        return False, "路径不存在"

    # pFrom 必须是双 null 结尾的多字符串
    from_buf = abspath + "\0\0"
    op = SHFILEOPSTRUCTW()
    op.wFunc = FO_DELETE
    op.pFrom = from_buf
    op.fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI

    res = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
    # 不拿返回值当判据：实测删除成功后 SHFileOperationW 仍可能返回 2（ERROR_FILE_NOT_FOUND），
    # 看文件还在不在才是真的（早期版本因此把成功报成了失败）。
    if os.path.exists(abspath):
        return False, f"未删除（Shell API 返回 {res}，可能被进程占用）"
    return True, "已送回收站"


def _size_of(path: str) -> str:
    abspath = os.path.abspath(path)
    if os.path.isfile(abspath):
        n = os.path.getsize(abspath)
    else:
        n = 0
        for root, _dirs, files in os.walk(abspath):
            for f in files:
                try:
                    n += os.path.getsize(os.path.join(root, f))
                except OSError:
                    pass
    for unit in ("B", "K", "M", "G"):
        if n < 1024 or unit == "G":
            return f"{n:.0f}{unit}" if unit == "B" else f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}G"


def main(argv: list[str]) -> int:
    args = argv[1:]
    dry = "--list" in args
    targets = [a for a in args if a != "--list"]

    if not targets:
        print(__doc__)
        return 2

    ok = fail = 0
    for t in targets:
        if not os.path.exists(t):
            print(f"  跳过（不存在）: {t}")
            continue
        if dry:
            kind = "目录" if os.path.isdir(t) else "文件"
            print(f"  [将删] {kind} {_size_of(t):>8}  {t}")
            continue
        success, msg = _trash_one(t)
        mark = "✔" if success else "✘"
        print(f"  {mark} {msg}: {t}")
        ok += 1 if success else 0
        fail += 0 if success else 1

    if not dry:
        print(f"\n完成：成功 {ok}，失败 {fail}（失败项通常是被进程占用；停掉相关进程后重试）")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
