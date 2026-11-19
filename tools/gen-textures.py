#!/usr/bin/env python3
"""Procedural, seamless texture tiles for the hyper-real table (Blok 4 visual layer).
No photos: every pixel is generated here from seeded noise. Run from the repo root:
    python3 tools/gen-textures.py      → public/img/real/{felt,wood,paper,leather}.webp
Felt / paper / leather are neutral grey (mean 128) and are blended with CSS (background-blend-mode: overlay/soft-light),
so the colour stays in CSS. Wood is a coloured tile (walnut)."""
import numpy as np
from PIL import Image
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'img', 'real')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(19112026)


def field(h, w, lo, hi, aniso=(1.0, 1.0)):
    """Periodic (tileable) band-limited noise: white noise filtered in the frequency domain, normalised to std 1."""
    n = rng.standard_normal((h, w))
    fy = np.fft.fftfreq(h)[:, None] * h * aniso[0]
    fx = np.fft.fftfreq(w)[None, :] * w * aniso[1]  # aniso > 1 → streaks along that axis
    r = np.sqrt(fx ** 2 + fy ** 2)
    mask = ((r >= lo) & (r <= hi)).astype(float) / np.maximum(r, 1) ** 0.6
    f = np.real(np.fft.ifft2(np.fft.fft2(n) * mask))
    return (f - f.mean()) / (f.std() + 1e-9)


def save_gray(a, name, q):
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'L')
    p = os.path.join(OUT, name)
    img.save(p, 'WEBP', quality=q, method=6)
    print(name, img.size, os.path.getsize(p), 'bytes')


# felt (baize): dense fine fibres + a little low-frequency mottling
S = 256
fib = field(S, S, 40, 128)
fuzz = field(S, S, 12, 40)
mott = field(S, S, 1, 6)
felt = 128 + 15 * fib + 7 * fuzz + 6 * mott
save_gray(felt, 'felt.webp', 72)

# paper (card stock): soft grain with a few fibres
P = 128
paper = 128 + 9 * field(P, P, 20, 64) + 5 * field(P, P, 4, 16) + 6 * field(P, P, 10, 40, aniso=(1, 4))
save_gray(paper, 'paper.webp', 74)

# leather / pebble grain (plates, rail pad)
L = 192
cells = field(L, L, 10, 30) + 0.6 * field(L, L, 24, 48)
leather = 128 + 14 * np.tanh(cells * 1.2) - 8 * np.abs(field(L, L, 6, 20)) + 6 * field(L, L, 40, 96)
save_gray(leather, 'leather.webp', 70)

# wood: walnut with flowing horizontal grain, tileable both ways
W, Hh = 640, 200
y = np.arange(Hh)[:, None] / Hh
warp = 0.45 * field(Hh, W, 1, 4, aniso=(1, 5)) + 0.06 * field(Hh, W, 3, 10, aniso=(1, 5))
rings = np.sin(2 * np.pi * (y * 7 + warp))
rings = np.sign(rings) * np.abs(rings) ** 0.55
fibres = field(Hh, W, 30, 100, aniso=(1, 8))
pores = field(Hh, W, 60, 100, aniso=(1, 3))
t = 0.5 + 0.22 * rings + 0.10 * fibres + 0.05 * pores + 0.08 * field(Hh, W, 1, 4, aniso=(1, 3))
t = np.clip(t, 0, 1)[..., None]
dark = np.array([30, 14, 7], float)    # dark walnut
mid = np.array([74, 36, 17], float)
light = np.array([122, 66, 32], float)  # figure highlights
rgb = np.where(t < 0.5, dark + (mid - dark) * (t / 0.5), mid + (light - mid) * ((t - 0.5) / 0.5))
img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), 'RGB')
p = os.path.join(OUT, 'wood.webp')
img.save(p, 'WEBP', quality=70, method=6)
print('wood.webp', img.size, os.path.getsize(p), 'bytes')
