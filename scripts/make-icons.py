"""アプリアイコンを生成する（python3 scripts/make-icons.py）。Pillow が必要。"""
from PIL import Image, ImageDraw

NAVY, WHITE, AMBER = (11, 61, 145), (255, 255, 255), (242, 169, 0)
S = 1024

def draw(maskable: bool) -> Image.Image:
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, S, S], fill=NAVY)
        scale, off = 0.72, S * 0.14  # 端末ごとの切り抜きに収まる安全領域
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.2), fill=NAVY)
        scale, off = 0.86, S * 0.07
    p = lambda x, y: (off + x * S * scale, off + y * S * scale)
    # 地表面
    d.rectangle([*p(0.10, 0.30), *p(0.90, 0.335)], fill=WHITE)
    # ハンマー
    d.rounded_rectangle([*p(0.36, 0.06), *p(0.64, 0.19)], radius=int(S * 0.02), fill=WHITE)
    # ロッド
    d.rectangle([*p(0.465, 0.19), *p(0.535, 0.74)], fill=WHITE)
    # 先端コーン
    d.polygon([p(0.40, 0.74), p(0.60, 0.74), p(0.50, 0.93)], fill=WHITE)
    # 深度目盛り
    for i, y in enumerate([0.44, 0.56, 0.68, 0.80]):
        x2 = 0.86 if i % 2 == 0 else 0.80
        d.rectangle([*p(0.68, y), *p(x2, y + 0.035)], fill=AMBER)
    return img

def save(img: Image.Image, size: int, name: str, background=None):
    out = img.resize((size, size), Image.LANCZOS)
    if background:
        bg = Image.new('RGB', out.size, background)
        bg.paste(out, mask=out.split()[3])
        out = bg
    out.save(f'public/{name}')

normal, maskable = draw(False), draw(True)
save(normal, 192, 'icon-192.png')
save(normal, 512, 'icon-512.png')
save(maskable, 512, 'icon-maskable-512.png')
save(maskable, 180, 'apple-touch-icon.png', NAVY)  # iOS は透過不可
save(normal, 64, 'favicon.png')
print('icons written to public/')
