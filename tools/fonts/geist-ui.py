import sys
from pathlib import Path

from fontTools.ttLib import TTFont

ASCENT, DESCENT = 940, 360
SRC = Path("node_modules/@fontsource-variable/geist/files")
OUT = Path("src/design-system/fonts")

for subset in ("latin", "latin-ext"):
    font = TTFont(SRC / f"geist-{subset}-wght-normal.woff2")
    font["hhea"].ascent = font["OS/2"].sTypoAscender = ASCENT
    font["hhea"].descent = font["OS/2"].sTypoDescender = -DESCENT
    font["hhea"].lineGap = font["OS/2"].sTypoLineGap = 0
    font.flavor = "woff2"
    font.save(OUT / f"geist-ui-{subset}.woff2")
    print(OUT / f"geist-ui-{subset}.woff2", file=sys.stderr)
