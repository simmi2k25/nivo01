"""Builds every icon NivoTalk needs from assets/logo.png (and the garden illustration).

Web:     client/public/icons/{favicon-32,favicon-64,apple-touch-icon,icon-192,icon-512,maskable-512}.png
In-app:  client/public/brand/badge.png (round badge), client/public/brand/garden.webp (default profile background)
Android: client/android/app/src/main/res/mipmap-*/ic_launcher*.png and drawable*/splash.png (when the
         Capacitor Android project exists)
Usage:   python tools/make_app_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / "assets" / "logo.png"
GARDEN = ROOT / "assets" / "stickers" / "Kawaii Chibi Friends Garden Portrait.png"
PUBLIC = ROOT / "client" / "public"
ANDROID_RES = ROOT / "client" / "android" / "app" / "src" / "main" / "res"
BG = (242, 245, 254)  # --bg #F2F5FE


def circle(img: Image.Image) -> Image.Image:
    """Round crop with a soft anti-aliased edge."""
    s = img.width
    big = Image.new("L", (s * 4, s * 4), 0)
    ImageDraw.Draw(big).ellipse((0, 0, s * 4 - 1, s * 4 - 1), fill=255)
    out = img.convert("RGBA")
    out.putalpha(big.resize((s, s), Image.LANCZOS))
    return out


def main():
    logo = Image.open(LOGO).convert("RGB")
    W = logo.width
    # The logo's outer pale rings fade into the page; the badge keeps from the second ring inward.
    inner = logo.crop((int(W * 0.08), int(W * 0.08), int(W * 0.92), int(W * 0.92)))
    core = logo.crop((int(W * 0.17), int(W * 0.17), int(W * 0.83), int(W * 0.83)))

    icons = PUBLIC / "icons"
    brand = PUBLIC / "brand"
    icons.mkdir(parents=True, exist_ok=True)
    brand.mkdir(parents=True, exist_ok=True)

    badge = circle(inner.resize((512, 512), Image.LANCZOS))
    badge.save(brand / "badge.png", optimize=True)
    badge.resize((256, 256), Image.LANCZOS).save(brand / "badge-256.png", optimize=True)

    for size, name in [(32, "favicon-32"), (64, "favicon-64")]:
        circle(core.resize((size, size), Image.LANCZOS)).save(icons / f"{name}.png", optimize=True)
    for size, name in [(180, "apple-touch-icon"), (192, "icon-192"), (512, "icon-512")]:
        inner.resize((size, size), Image.LANCZOS).save(icons / f"{name}.png", optimize=True)
    # Maskable: full-bleed background, logo inside the 80% safe zone.
    mask = Image.new("RGB", (512, 512), BG)
    mask.paste(logo.resize((512, 512), Image.LANCZOS))
    mask.save(icons / "maskable-512.png", optimize=True)

    garden = Image.open(GARDEN).convert("RGB")
    garden.thumbnail((1440, 1440), Image.LANCZOS)
    garden.save(brand / "garden.webp", "WEBP", quality=86, method=6)

    if ANDROID_RES.exists():
        densities = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
        for d, k in densities.items():
            folder = ANDROID_RES / f"mipmap-{d}"
            folder.mkdir(exist_ok=True)
            n = round(48 * k)
            inner.resize((n, n), Image.LANCZOS).save(folder / "ic_launcher.png")
            circle(inner.resize((n, n), Image.LANCZOS)).save(folder / "ic_launcher_round.png")
            fg = round(108 * k)
            fore = Image.new("RGBA", (fg, fg), (0, 0, 0, 0))
            art = circle(core.resize((round(fg * 0.62),) * 2, Image.LANCZOS))
            off = (fg - art.width) // 2
            fore.paste(art, (off, off), art)
            fore.save(folder / "ic_launcher_foreground.png")
        for folder in ANDROID_RES.glob("drawable*"):
            splash = folder / "splash.png"
            if splash.exists():
                w, h = Image.open(splash).size
                canvas = Image.new("RGB", (w, h), BG)
                n = round(min(w, h) * 0.28)
                b = badge.resize((n, n), Image.LANCZOS)
                canvas.paste(b, ((w - n) // 2, (h - n) // 2), b)
                canvas.save(splash)
        print("android icons + splash updated")
    print("web icons, badge and garden background written")


if __name__ == "__main__":
    main()
