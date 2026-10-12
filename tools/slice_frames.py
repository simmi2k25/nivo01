"""Cuts the profile-frame sheets in assets/frames into one transparent WebP per frame.

The sheets are transparent PNGs with frames laid out in groups (a pack on the left half, another on
the right). Pieces close together (a frame and its floating bats or stars) are one frame. The photo
hole is the biggest empty circle inside each frame: every frame is saved centred on that hole, and the
manifest records how much bigger than the photo the frame is drawn (`scale`).

Output: client/public/frames/<id>.webp, client/src/data/frames.json, server/src/frameIds.ts
Usage:  python tools/slice_frames.py [--preview]
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "frames"
OUT = ROOT / "client" / "public" / "frames"
MANIFEST = ROOT / "client" / "src" / "data" / "frames.json"
SERVER_IDS = ROOT / "server" / "src" / "frameIds.ts"
SIZE = 384  # exported frames are square, this many px
UNDER = 1.05  # photo radius as a share of the ring's inner radius
JOIN = 6  # pieces this close (px, at sheet scale) are one piece
ATTACH = 120  # small floating bits (bats, stars) this close join the nearest frame

# pack id, name, sheet, which part of the sheet ("left", "right" or "all")
PACKS = [
    ("ninja", "Ninja", "sheet-1.png", "left"),
    ("spooky", "Spooky", "sheet-1.png", "right"),
    ("crochet", "Crochet", "sheet-2.png", "left"),
    ("gamer", "Gamer", "sheet-2.png", "right"),
    ("japan", "Japan", "sheet-3.png", "all"),
    ("paper", "Paper Cute", "sheet-4.png", "left"),
    ("scrapbook", "Scrapbook", "sheet-4.png", "right"),
    ("fantasy", "Fantasy", "sheet-5.png", "right"),
]


def inscribed_circle(mask: np.ndarray):
    """Biggest circle of empty space inside a frame's box, looked for near the middle: a first guess at the hole."""
    h, w = mask.shape
    free = ~mask
    free[0, :] = free[-1, :] = free[:, 0] = free[:, -1] = False
    dist = ndi.distance_transform_edt(free)
    yy, xx = np.mgrid[0:h, 0:w]
    weight = 1 - 0.6 * (((yy - h / 2) / h) ** 2 + ((xx - w / 2) / w) ** 2)
    y, x = np.unravel_index(np.argmax(dist * weight), dist.shape)
    return float(x), float(y), float(dist[y, x])


def ring_circle(ring: np.ndarray):
    """Centre and inner radius of the ring itself.

    Rays go out from the middle and stop at the first solid pixel. Decorations that reach into the
    middle (an umbrella, a wave, a ghost) stop a few rays early, and gaps in brush rings let a few run
    long; fitting a circle to the hits that agree with the typical distance ignores both.
    """
    h, w = ring.shape
    cx, cy, r0 = inscribed_circle(ring)
    angles = np.linspace(0, 2 * np.pi, 360, endpoint=False)
    r = r0
    for _ in range(4):
        hits = []
        for a in angles:
            dx, dy = np.cos(a), np.sin(a)
            for t in np.arange(max(4.0, r0 * 0.5), max(h, w), 1.5):
                px, py = int(cx + dx * t), int(cy + dy * t)
                if not (0 <= px < w and 0 <= py < h):
                    break
                if ring[py, px]:
                    hits.append((cx + dx * t, cy + dy * t, t))
                    break
        if len(hits) < 60:
            break
        hits = np.array(hits)
        pts = hits[:, :2]
        # RANSAC: the circle that the most hits sit on is the ring; decorations and gaps are the rest.
        rng = np.random.default_rng(7)
        best, best_in = None, -1
        for _ in range(600):
            a, b, c3 = pts[rng.choice(len(pts), 3, replace=False)]
            M = np.array([[2 * (b[0] - a[0]), 2 * (b[1] - a[1])], [2 * (c3[0] - a[0]), 2 * (c3[1] - a[1])]])
            if abs(np.linalg.det(M)) < 1e-6:
                continue
            ox, oy = np.linalg.solve(M, [b @ b - a @ a, c3 @ c3 - a @ a])
            rr = np.hypot(a[0] - ox, a[1] - oy)
            if not (0.25 * max(h, w) < rr < 0.6 * max(h, w)):
                continue
            n_in = int((np.abs(np.hypot(pts[:, 0] - ox, pts[:, 1] - oy) - rr) < 0.03 * rr).sum())
            if n_in > best_in:
                best, best_in = (ox, oy, rr), n_in
        if best is None:
            break
        ox, oy, rr = best
        good = pts[np.abs(np.hypot(pts[:, 0] - ox, pts[:, 1] - oy) - rr) < 0.03 * rr]
        # Least-squares circle through the agreeing hits.
        A = np.c_[2 * good[:, 0], 2 * good[:, 1], np.ones(len(good))]
        b = good[:, 0] ** 2 + good[:, 1] ** 2
        (ncx, ncy, c), *_ = np.linalg.lstsq(A, b, rcond=None)
        r = float(np.sqrt(c + ncx**2 + ncy**2))
        cx, cy = float(ncx), float(ncy)
    return cx, cy, r


_sheets: dict[str, list] = {}


def frames_on(sheet: str):
    """Every frame on a sheet: (centre x as a fraction of the width, RGBA image centred on the hole, scale)."""
    if sheet in _sheets:
        return _sheets[sheet]
    rgba = np.asarray(Image.open(SRC / sheet).convert("RGBA"))
    solid = rgba[..., 3] > 20
    pieces, n = ndi.label(ndi.binary_dilation(solid, iterations=JOIN))
    big = [i for i, sl in enumerate(ndi.find_objects(pieces), start=1) if sl and min(sl[0].stop - sl[0].start, sl[1].stop - sl[1].start) >= 300]
    groups = np.zeros(pieces.shape, np.int32)
    for k, i in enumerate(big, start=1):
        groups[pieces == i] = k
    dist, (iy, ix) = ndi.distance_transform_edt(groups == 0, return_indices=True)
    groups = np.where((groups == 0) & (pieces > 0) & (dist <= ATTACH), groups[iy, ix], groups)
    found = []
    for i, sl in enumerate(ndi.find_objects(groups), start=1):
        if sl is None:
            continue
        mine = groups[sl] == i
        cx, cy, r = ring_circle((rgba[sl][..., 3] > 140) & mine)
        r *= UNDER  # the photo tucks a little under the ring so no gap shows
        tile = rgba[sl].copy()
        tile[..., 3] = np.where(mine, tile[..., 3], 0)
        h, w = mine.shape
        half = int(max(cx, w - cx, cy, h - cy)) + 6
        cx, cy = int(round(cx)), int(round(cy))
        canvas = Image.new("RGBA", (2 * half, 2 * half), (0, 0, 0, 0))
        canvas.alpha_composite(Image.fromarray(tile), (half - cx, half - cy))
        found.append((sl[1].start + cx, sl[0].start + cy, canvas, (2 * half) / (2 * r)))
    width = rgba.shape[1]
    # Reading order: rows top to bottom, then left to right.
    found.sort(key=lambda f: (round(f[1] / 300), f[0]))
    _sheets[sheet] = [(x / width, img, scale) for x, _, img, scale in found]
    return _sheets[sheet]


def main():
    preview = "--preview" in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.webp"):
        old.unlink()
    packs, ids, shots = [], [], []
    for pack, name, sheet, part in PACKS:
        items = []
        chosen = [f for f in frames_on(sheet) if part == "all" or (f[0] < 0.5) == (part == "left")]
        for n, (_, img, scale) in enumerate(chosen, start=1):
            fid = f"{pack}-{n:02d}"
            img.resize((SIZE, SIZE), Image.LANCZOS).save(OUT / f"{fid}.webp", "WEBP", quality=88, method=6)
            items.append({"id": fid, "scale": round(scale, 3)})
            ids.append(fid)
            shots.append((img, scale))
        packs.append({"id": pack, "name": name, "frames": items})
        print(f"{pack}: {len(items)} frames")
    MANIFEST.write_text(json.dumps({"packs": packs}, indent=1) + "\n", encoding="utf8")
    SERVER_IDS.write_text(
        "// Generated by tools/slice_frames.py: every profile frame someone can buy.\n"
        f"export const FRAME_IDS: ReadonlySet<string> = new Set({json.dumps(ids)});\n",
        encoding="utf8",
    )
    print(f"{len(ids)} frames in total")
    if preview:
        # Each frame over a stand-in photo, on light and dark, so the hole alignment can be checked.
        cols, cell = 10, 150
        rows = (len(shots) + cols - 1) // cols
        sheet = Image.new("RGBA", (cols * cell, rows * cell * 2), (0, 0, 0, 0))
        for k, (img, scale) in enumerate(shots):
            t = img.resize((cell - 10, cell - 10), Image.LANCZOS)
            photo = int((cell - 10) / scale)
            x, y = (k % cols) * cell, (k // cols) * cell * 2
            for dy, bg in ((0, (233, 236, 252, 255)), (cell, (30, 34, 70, 255))):
                tile = Image.new("RGBA", (cell, cell), bg)
                dot = Image.new("RGBA", (photo, photo), (0, 0, 0, 0))
                from PIL import ImageDraw

                ImageDraw.Draw(dot).ellipse((0, 0, photo - 1, photo - 1), fill=(240, 150, 170, 255))
                tile.alpha_composite(dot, ((cell - photo) // 2, (cell - photo) // 2))
                tile.alpha_composite(t, (5, 5))
                sheet.paste(tile, (x, y + dy))
        sheet.save(ROOT / "tools" / "_frames_preview.png")
        print("preview: tools/_frames_preview.png")


if __name__ == "__main__":
    main()
