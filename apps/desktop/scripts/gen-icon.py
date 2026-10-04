#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ADR-0008 D10.2 冻结的图标生成脚本。

用法（在 F:\\new1.2 执行）：
    python apps/desktop/scripts/gen-icon.py

输入（唯一源，ADR D10.2 冻结；不得引用不存在的文件）：
    apps/web/public/images/bamboo-ink.png     1672x941 RGB

输出：
    apps/desktop/build-resources/icon.png     512x512 RGBA
    apps/desktop/build-resources/icon.ico     256x256 RGBA 多尺寸 ICO

冻结细节：
  - 裁剪框 (365, 0, 1306, 941) => 941x941 正方形（居中于墨竹主体）
  - PNG: Image.LANCZOS 重采样，RGBA
  - ICO: save(sizes=[(256,256),(128,128),(64,64),(48,48),(32,32),(16,16)])
  - 尺寸下限 >= 256x256（NSIS 要求）
  - 目录必须叫 build-resources/ 而不是 build/（.gitignore:12 的 build/ 会忽略任意层级同名目录）

幂等：重复运行覆盖同名产物。
"""

from __future__ import annotations

import os
import sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.stderr.write("[gen-icon] 需要 Pillow：pip install Pillow\n")
    raise SystemExit(1)

# 冻结常量（ADR-0008 D10.2）
CROP_BOX = (365, 0, 1306, 941)
PNG_SIZE = (512, 512)
ICO_SIZES = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]


def repo_root() -> str:
    """apps/desktop/scripts/gen-icon.py -> 仓库根 F:\\new1.2"""
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, "..", "..", ".."))


def main() -> int:
    root = repo_root()
    src = os.path.join(root, "apps", "web", "public", "images", "bamboo-ink.png")
    out_dir = os.path.join(root, "apps", "desktop", "build-resources")
    out_png = os.path.join(out_dir, "icon.png")
    out_ico = os.path.join(out_dir, "icon.ico")

    if not os.path.isfile(src):
        sys.stderr.write("[gen-icon] 源图不存在：%s\n" % src)
        return 1

    os.makedirs(out_dir, exist_ok=True)

    with Image.open(src) as im:
        sys.stdout.write("[gen-icon] 源图 %s  %dx%d %s\n" % (src, im.width, im.height, im.mode))
        if im.width < CROP_BOX[2] or im.height < CROP_BOX[3]:
            sys.stderr.write(
                "[gen-icon] 源图尺寸 %dx%d 小于冻结裁剪框 %s\n" % (im.width, im.height, CROP_BOX)
            )
            return 1
        square = im.convert("RGBA").crop(CROP_BOX)
        sys.stdout.write("[gen-icon] 裁剪 %s => %dx%d\n" % (CROP_BOX, square.width, square.height))

        icon_png = square.resize(PNG_SIZE, Image.LANCZOS)
        icon_png.save(out_png, format="PNG")
        sys.stdout.write(
            "[gen-icon] 写出 %s  %dx%d %s  %d B\n"
            % (out_png, icon_png.width, icon_png.height, icon_png.mode, os.path.getsize(out_png))
        )

        # ICO：从 256x256 起点再 save(sizes=...) 让 Pillow 自行降采样各尺寸
        icon_256 = square.resize((256, 256), Image.LANCZOS)
        icon_256.save(out_ico, format="ICO", sizes=ICO_SIZES)
        sys.stdout.write(
            "[gen-icon] 写出 %s  sizes=%s  %d B\n"
            % (out_ico, ICO_SIZES, os.path.getsize(out_ico))
        )

        # 自检：尺寸下限 >= 256x256
        with Image.open(out_png) as chk:
            if chk.width < 256 or chk.height < 256:
                sys.stderr.write("[gen-icon] 自检失败：icon.png %dx%d < 256x256\n" % (chk.width, chk.height))
                return 1
        with Image.open(out_ico) as chk:
            if chk.width < 256 or chk.height < 256:
                sys.stderr.write("[gen-icon] 自检失败：icon.ico %dx%d < 256x256\n" % (chk.width, chk.height))
                return 1

    sys.stdout.write("[gen-icon] OK\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())