#!/usr/bin/env python3
"""
生成 RemoteCMD 的 PWA 自适应图标（PWA 安装需要）。

输出（到 public/）：
  - icon-maskable-512.png : 512x512 铺满背景，用于自适应启动器图标（maskable，主体在安全区）
  - icon-512.png          : 512x512 圆角版，purpose=any
  - icon-192.png          : 192x192 圆角版，purpose=any

设计：Stripe 风垂直渐变（靛蓝 #6366f1 -> 紫 #8b5cf6）+ 白色终端提示符 ">" + 小光标方块。
依赖：Pillow (PIL)。本机已装（PIL 12.3.0）。
"""
from pathlib import Path
from PIL import Image, ImageDraw

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = REPO_ROOT / "public"
OUT_DIR.mkdir(exist_ok=True)

C_TOP = (99, 102, 241)     # #6366f1 靛蓝
C_BOT = (139, 92, 246)     # #8b5cf6 紫
FG = (255, 255, 255)       # 白色前景


def make_gradient(size):
    """垂直渐变背景（铺满，无圆角）。"""
    w, h = size, size
    img = Image.new("RGBA", (w, h))
    px = img.load()
    for y in range(h):
        t = y / (h - 1)
        r = int(C_TOP[0] + (C_BOT[0] - C_TOP[0]) * t)
        g = int(C_TOP[1] + (C_BOT[1] - C_TOP[1]) * t)
        b = int(C_TOP[2] + (C_BOT[2] - C_TOP[2]) * t)
        for x in range(w):
            px[x, y] = (r, g, b, 255)
    return img


def draw_glyph(draw, cx, cy, scale):
    """白色 '>' 提示符 + 光标方块，整体落在安全区（中心 ~80%）。"""
    arm = int(95 * scale)      # 单臂长度
    thick = int(34 * scale)    # 线宽
    # 两条粗线组成 ">"
    draw.line([(cx - arm, cy - arm), (cx + arm, cy)], fill=FG, width=thick, joint="curve")
    draw.line([(cx + arm, cy), (cx - arm, cy + arm)], fill=FG, width=thick, joint="curve")
    # 光标方块（位于 ">" 右下）
    cw, ch = int(78 * scale), int(15 * scale)
    draw.rectangle([cx + int(20 * scale), cy + int(70 * scale),
                    cx + int(20 * scale) + cw, cy + int(70 * scale) + ch], fill=FG)


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def build(size, radius, out_name):
    img = make_gradient(size)
    d = ImageDraw.Draw(img)
    draw_glyph(d, size // 2, size // 2, size / 512.0)
    if radius > 0:
        # 用蒙版裁圆角（透明四角）
        img.putalpha(rounded_mask(size, radius))
    img.save(OUT_DIR / out_name)
    print(f"written {out_name} ({size}x{size})")


if __name__ == "__main__":
    build(512, 0, "icon-maskable-512.png")   # maskable：铺满，无圆角
    build(512, 100, "icon-512.png")          # any：圆角
    build(192, 38, "icon-192.png")           # any：小尺寸圆角
    print("done ->", OUT_DIR)
