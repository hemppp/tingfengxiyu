#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ADR-0008 D4.5 冻结的便携版启动图生成脚本。

用法（在 F:\\new1.2 执行）：
    python apps/desktop/scripts/gen-splash.py

输出：
    apps/desktop/build-resources/splash.bmp    640x400 24-bit BMP（768054 B）

为什么必须有这张图（ADR D4.5）：
    electron-builder 的 `portable` target 若**未**配 `portable.splashImage`，
    `app-builder-lib/templates/nsis/portable.nsi:11-13` 会执行 `SetSilent silent`
    ⇒ 双击后全程无窗口，首启解压 ~1-2 分钟内用户看不到任何反馈，会判定
    「启动失败」。配了启动图才会走 `.onGUIInit` 的 `BgImage::SetBg` 分支。

冻结细节（ADR D4.5）：
  - 画布 640x400，RGB（BMP 24-bit，BgImage 插件只认 BMP）
  - 顶部 4px 强调色条 #569CD6，背景 #1E1E20 -> #2D2D32 竖向线性渐变
  - 主标题「听风细雨」#FFFFFF，副标题「NovelMuse 便携版 · v<version>」#9CDCFE
  - 版本号取自 apps/desktop/package.json（不硬编码，避免漂移）
  - 字体：微软雅黑 msyhbd.ttc / msyh.ttc（Windows 自带）

幂等：重复运行覆盖同名产物；同一 Pillow + 同一字体下输出逐字节一致。
"""

from __future__ import annotations

import argparse
import json
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover
    sys.stderr.write("[gen-splash] 需要 Pillow：pip install Pillow\n")
    raise SystemExit(1)

# 冻结常量（ADR-0008 D4.5）
WIDTH, HEIGHT = 640, 400
BG_TOP = (30, 30, 32)      # #1E1E20
BG_BOTTOM = (45, 45, 50)   # #2D2D32
ACCENT = (86, 156, 214)    # #569CD6
FG_TITLE = (255, 255, 255)
FG_SUBTITLE = (156, 220, 254)  # #9CDCFE
FG_HINT = (168, 168, 172)
FG_FOOT = (110, 110, 116)
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_REGULAR = r"C:\Windows\Fonts\msyh.ttc"


def repo_root() -> str:
    """apps/desktop/scripts/gen-splash.py -> 仓库根"""
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, "..", "..", ".."))


def read_version(root: str) -> str:
    pkg = os.path.join(root, "apps", "desktop", "package.json")
    with open(pkg, "r", encoding="utf-8") as fh:
        return json.load(fh)["version"]


def build(version: str) -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT))
    draw = ImageDraw.Draw(img)

    # 竖向线性渐变背景（逐行，确定性）
    for y in range(HEIGHT):
        t = y / (HEIGHT - 1)
        draw.line(
            [(0, y), (WIDTH, y)],
            fill=(
                round(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t),
                round(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t),
                round(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t),
            ),
        )

    draw.rectangle([0, 0, WIDTH, 4], fill=ACCENT)

    def font(path: str, size: int) -> ImageFont.FreeTypeFont:
        if not os.path.isfile(path):
            sys.stderr.write("[gen-splash] 字体不存在：%s\n" % path)
            raise SystemExit(1)
        return ImageFont.truetype(path, size)

    f_title = font(FONT_BOLD, 44)
    f_sub = font(FONT_REGULAR, 18)
    f_hint = font(FONT_REGULAR, 14)
    f_foot = font(FONT_REGULAR, 12)

    def center(text: str, f: ImageFont.FreeTypeFont, y: int, fill: tuple) -> None:
        box = draw.textbbox((0, 0), text, font=f)
        draw.text(((WIDTH - (box[2] - box[0])) / 2 - box[0], y), text, font=f, fill=fill)

    center("听风细雨", f_title, 132, FG_TITLE)
    center("NovelMuse 便携版 · v%s" % version, f_sub, 206, FG_SUBTITLE)
    draw.line([(200, 250), (440, 250)], fill=(70, 70, 78))
    center("首次启动正在解压，请稍候（约 1-2 分钟）", f_hint, 282, FG_HINT)
    center("请勿关闭本窗口", f_hint, 306, FG_HINT)
    center("听风细雨 · 伴写小说工具", f_foot, 358, FG_FOOT)

    return img


def main() -> int:
    root = repo_root()
    parser = argparse.ArgumentParser(description="生成便携版启动图 splash.bmp（ADR D4.5）")
    parser.add_argument(
        "--out",
        default=os.path.join(root, "apps", "desktop", "build-resources", "splash.bmp"),
        help="输出路径（默认 apps/desktop/build-resources/splash.bmp）",
    )
    parser.add_argument("--version", default=None, help="覆盖版本号（默认读 apps/desktop/package.json）")
    args = parser.parse_args()

    version = args.version or read_version(root)
    out_dir = os.path.dirname(os.path.abspath(args.out))
    os.makedirs(out_dir, exist_ok=True)

    img = build(version)
    img.save(args.out, "BMP")

    size = os.path.getsize(args.out)
    sys.stdout.write("[gen-splash] 写出 %s  %dx%d %s  %d B  (v%s)\n"
                     % (args.out, img.width, img.height, img.mode, size, version))

    # 自检：尺寸与位深必须满足 BgImage（24-bit BMP）
    with Image.open(args.out) as chk:
        if (chk.width, chk.height) != (WIDTH, HEIGHT):
            sys.stderr.write("[gen-splash] 自检失败：尺寸 %dx%d != %dx%d\n"
                             % (chk.width, chk.height, WIDTH, HEIGHT))
            return 1
        if chk.mode != "RGB":
            sys.stderr.write("[gen-splash] 自检失败：位深模式 %s != RGB（需 24-bit BMP）\n" % chk.mode)
            return 1

    sys.stdout.write("[gen-splash] OK\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
