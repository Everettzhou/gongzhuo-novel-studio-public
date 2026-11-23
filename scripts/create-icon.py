"""Draw the application's original book-and-pen icon; no external image assets."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
out = root / "build"
out.mkdir(exist_ok=True)
im = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
d.rounded_rectangle((36, 36, 988, 988), radius=230, fill="#204f43")
d.polygon([(200, 300), (480, 350), (480, 780), (200, 725)], fill="#f6f0e4")
d.polygon([(544, 350), (824, 300), (824, 725), (544, 780)], fill="#dcd9bb")
d.line([(270, 410), (415, 437)], fill="#a7b2a0", width=18)
d.line([(270, 475), (415, 502)], fill="#a7b2a0", width=18)
d.polygon([(500, 570), (698, 218), (790, 270), (592, 622)], fill="#d5ad65")
d.polygon([(500, 570), (592, 622), (487, 680)], fill="#fff9ed")
d.line([(548, 593), (744, 244)], fill="#7a6036", width=10)
im.save(out / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
im.resize((256, 256), Image.Resampling.LANCZOS).save(out / "icon.png")
