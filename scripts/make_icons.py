"""生成 PWA 图标"""
import os
from PIL import Image, ImageDraw, ImageFont

# 仓库根：脚本位于 <repo>/scripts/，向上一级即仓库根。
# 图标输出到 assets 目录（PWA manifest 与网页同目录）。
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, 'app', 'src', 'main', 'assets', 'icons')
os.makedirs(OUT, exist_ok=True)

FONT_CANDIDATES = [
    r'C:\Windows\Fonts\arialbd.ttf',
    r'C:\Windows\Fonts\seguisb.ttf',
    r'C:\Windows\Fonts\segoeui.ttf',
    r'C:\Windows\Fonts\msyhbd.ttc',
]

FONT_PATH = None
for f in FONT_CANDIDATES:
    if os.path.exists(f):
        FONT_PATH = f
        break
print('font:', FONT_PATH)


def lerp(c1, c2, t):
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))


def draw(size, maskable=False):
    S = size * 4  # 超采样抗锯齿
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 背景
    inset = int(S * 0.09) if maskable else 0
    radius = int(S * (0.22 if maskable else 0.235))
    bg = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bg)
    bd.rounded_rectangle([inset, inset, S - inset, S - inset], radius=radius, fill=(255, 255, 255, 255))
    # 渐变
    grad = Image.new('RGB', (S, S))
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        t = y / S
        gd.line([(0, y), (S, y)], fill=lerp((96, 141, 255), (138, 107, 255), t))
    img.paste(grad, (0, 0), bg)
    d = ImageDraw.Draw(img)

    # ABC
    fs = int(S * (0.30 if not maskable else 0.26))
    font = ImageFont.truetype(FONT_PATH, fs) if FONT_PATH else None
    text = 'ABC'
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (S - tw) / 2 - bbox[0]
    ty = S * (0.20 if not maskable else 0.26) - bbox[1]
    d.text((tx, ty), text, font=font, fill=(255, 255, 255, 255))

    # 底部三条声波（长短不一）
    cy = int(S * (0.73 if not maskable else 0.70))
    bar_w = int(S * 0.052)
    gap = int(S * 0.042)
    heights = [0.055, 0.115, 0.075, 0.135, 0.075, 0.115, 0.055]
    total_w = len(heights) * bar_w + (len(heights) - 1) * gap
    x = (S - total_w) / 2
    for h in heights:
        bh = int(S * h)
        d.rounded_rectangle([x, cy - bh / 2, x + bar_w, cy + bh / 2],
                            radius=bar_w / 2, fill=(255, 255, 255, 235))
        x += bar_w + gap

    return img.resize((size, size), Image.LANCZOS)


for size in (180, 192, 512):
    im = draw(size, maskable=False)
    p = os.path.join(OUT, 'icon-%d.png' % size)
    im.save(p, 'PNG', optimize=True)
    print('saved', p, os.path.getsize(p))

im = draw(512, maskable=True)
p = os.path.join(OUT, 'icon-512-maskable.png')
im.save(p, 'PNG', optimize=True)
print('saved', p, os.path.getsize(p))
