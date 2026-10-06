"""Slices the illustrated sticker sheets in assets/stickers into individual WebP stickers.

Each sheet is a 2x2 grid of panels holding outlined characters with handwritten labels.
Characters are found from their dark outlines (filled in to solid shapes), titles and labels are
rejected because they are almost entirely dark ink, and nearby coloured decorations (hearts,
sparkles, music notes) are kept with the character they belong to.

Output: client/public/stickers/<pack>-NN.webp and client/src/data/stickers.json
Usage:  python tools/slice_stickers.py [--preview]
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "stickers"
OUT = ROOT / "client" / "public" / "stickers"
MANIFEST = ROOT / "client" / "src" / "data" / "stickers.json"
PACKS = ["berri", "chatty", "dino", "pepo", "pomi"]
SIZE = 240  # longest side of exported stickers
STROKE = 5  # white sticker edge, px at source scale


def hsv_parts(rgb: np.ndarray):
    mx = rgb.max(axis=2).astype(np.float32)
    mn = rgb.min(axis=2).astype(np.float32)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
    return mx, sat


def slice_sheet(path: Path, pack: str):
    im = Image.open(path).convert("RGB")
    rgb = np.asarray(im)
    H, W, _ = rgb.shape
    lum = rgb @ np.array([0.299, 0.587, 0.114])
    value, sat = hsv_parts(rgb)

    dark = lum < 105
    # Close small gaps in outlines, then fill the inside to get solid character shapes.
    shapes = ndi.binary_fill_holes(ndi.binary_closing(ndi.binary_dilation(dark, iterations=2), iterations=2))
    labels, n = ndi.label(shapes)
    objs = ndi.find_objects(labels)

    chars = []
    for i, sl in enumerate(objs, start=1):
        if sl is None:
            continue
        h = sl[0].stop - sl[0].start
        w = sl[1].stop - sl[1].start
        comp = labels[sl] == i
        area = comp.sum()
        if area < 3500 or h < 55 or w < 55 or h > H * 0.45 or w > W * 0.3:
            continue
        ink = (dark[sl] & comp).sum() / area
        if ink > 0.55:  # titles / big lettering are mostly ink (~0.67)
            continue
        if ink > 0.3:
            # Outline has gaps so the inside didn't fill — close harder and refill this one shape.
            pad = 12
            ys = slice(max(0, sl[0].start - pad), min(H, sl[0].stop + pad))
            xs = slice(max(0, sl[1].start - pad), min(W, sl[1].stop + pad))
            local = labels[ys, xs] == i
            filled = ndi.binary_fill_holes(ndi.binary_closing(local, iterations=10))
            labels[ys, xs][filled & (labels[ys, xs] == 0)] = i
            shapes[ys, xs] |= filled
        chars.append((i, sl))

    # Coloured decorations: saturated, not-too-light pixels that aren't part of a character.
    deco = (sat > 0.28) & (value > 60) & ~shapes
    deco = ndi.binary_opening(deco, iterations=1)
    deco_labels, _ = ndi.label(ndi.binary_dilation(deco, iterations=1))
    # Background of each panel (pale pastel): very light, low saturation.

    results = []
    for i, sl in chars:
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        pad = 34
        Y0, Y1 = max(0, y0 - pad), min(H, y1 + pad // 3)
        X0, X1 = max(0, x0 - pad), min(W, x1 + pad)
        mask = labels[Y0:Y1, X0:X1] == i
        # Shapes fully enclosed by this sticker's box (e.g. a face inside headphones) belong to it.
        char_ids = {c for c, _ in chars}
        for j in np.unique(labels[Y0:Y1, X0:X1]):
            if j in (0, i) or j in char_ids:
                continue
            osl = objs[j - 1]
            if osl[0].start >= y0 and osl[0].stop <= y1 and osl[1].start >= x0 and osl[1].stop <= x1:
                mask |= labels[Y0:Y1, X0:X1] == j
        # Add decorations whose bounding box sits mostly inside the padded box.
        local = deco_labels[Y0:Y1, X0:X1]
        for d in np.unique(local):
            if d == 0:
                continue
            dm = local == d
            full = (deco_labels == d).sum()
            if dm.sum() >= 0.8 * full and full < 6000:
                mask |= dm
        # Sticker edge
        solid = ndi.binary_fill_holes(ndi.binary_closing(mask, iterations=6))
        body = solid[y0 - Y0:y1 - Y0, x0 - X0:x1 - X0]
        if body.mean() < 0.42:  # outline never closed — the cut-out would be hollow
            continue
        edge = ndi.binary_dilation(solid, iterations=STROKE)
        crop = rgb[Y0:Y1, X0:X1].copy()
        out = np.zeros((Y1 - Y0, X1 - X0, 4), dtype=np.uint8)
        out[..., :3] = 255
        out[solid, :3] = crop[solid]
        alpha = ndi.gaussian_filter(edge.astype(np.float32), 0.8)
        out[..., 3] = np.clip(alpha * 255, 0, 255).astype(np.uint8)
        ys, xs = np.nonzero(edge)
        out = out[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        cy, cx = (y0 + y1) / 2, (x0 + x1) / 2
        panel = (1 if cy > H / 2 else 0) * 2 + (1 if cx > W / 2 else 0)
        results.append({"panel": panel, "cy": cy, "cx": cx, "img": Image.fromarray(out, "RGBA")})

    # Reading order: panel, then rows (within ~70px), then left→right.
    results.sort(key=lambda r: (r["panel"], r["cy"]))
    ordered, row, last_y = [], [], None
    for r in results:
        if row and (r["panel"] != row[0]["panel"] or r["cy"] - last_y > 70):
            ordered += sorted(row, key=lambda x: x["cx"])
            row = []
        row.append(r)
        last_y = r["cy"]
    ordered += sorted(row, key=lambda x: x["cx"])
    return ordered


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.webp"):
        old.unlink()
    manifest = {"packs": []}
    previews = []
    for pack in PACKS:
        src = SRC / f"{pack.capitalize()}.png"
        stickers = slice_sheet(src, pack)
        items = []
        for n, s in enumerate(stickers, start=1):
            img = s["img"]
            scale = SIZE / max(img.size)
            if scale < 1:
                img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
            sid = f"{pack}-{n:02d}"
            img.save(OUT / f"{sid}.webp", "WEBP", quality=88, method=6)
            items.append({"id": sid, "w": img.width, "h": img.height})
            previews.append(img)
        manifest["packs"].append({"id": pack, "name": pack.capitalize(), "stickers": items})
        print(f"{pack}: {len(items)} stickers")
    MANIFEST.write_text(json.dumps(manifest, indent=1))
    total = sum(len(p["stickers"]) for p in manifest["packs"])
    print(f"total: {total} -> {MANIFEST.relative_to(ROOT)}")

    if "--preview" in sys.argv:
        cols, cell = 16, 120
        rows = (len(previews) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * cell, rows * cell), (210, 220, 245))
        for k, img in enumerate(previews):
            t = img.copy()
            t.thumbnail((cell - 6, cell - 6))
            sheet.paste(t, ((k % cols) * cell + 3, (k // cols) * cell + 3), t)
        p = ROOT / "tools" / "_sticker_preview.png"
        sheet.save(p)
        print(f"preview -> {p}")


if __name__ == "__main__":
    main()
