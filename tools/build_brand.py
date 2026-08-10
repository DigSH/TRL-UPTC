"""Genera los recursos de marca listos para web a partir de los originales.

Uso:
    python tools/build_brand.py

Lee los archivos institucionales de assets/brand/ (los másteres, sin tocar) y
escribe en assets/img/ las versiones que consume el sitio:

  uptc-vie-cabezote.png  Membrete institucional reducido para el informe impreso

El original pesa casi 1 MB, tamaño innecesario para imprimir en A4 y penalizante
al cargar la página.
"""

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "assets" / "brand"
OUT = ROOT / "assets" / "img"

# Ancho al que se reduce el membrete: A4 útil (~180 mm) a ~200 ppp.
LETTERHEAD_WIDTH = 1500


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    # El sitio no muestra el logotipo de la OTRI, así que de assets/brand/ solo
    # se publica el membrete institucional que encabeza el informe impreso.
    # log_otri.svg y cab_otri.svg se conservan como másteres por si se retoman.

    source = BRAND / "Cabezote VIE-01.png"
    target = OUT / "uptc-vie-cabezote.png"
    try:
        from PIL import Image
    except ImportError:
        shutil.copyfile(source, target)
        print("Pillow no está instalado: el membrete se copió sin reducir "
              f"({source.stat().st_size // 1024} kB). pip install Pillow para optimizarlo.")
        return

    with Image.open(source) as img:
        ratio = LETTERHEAD_WIDTH / img.width
        resized = img.convert("RGB").resize(
            (LETTERHEAD_WIDTH, round(img.height * ratio)), Image.LANCZOS
        )
        resized.save(target, optimize=True)
    print(f"uptc-vie-cabezote.png: {source.stat().st_size // 1024} kB -> "
          f"{target.stat().st_size // 1024} kB ({resized.width}×{resized.height})")


if __name__ == "__main__":
    sys.exit(main())
