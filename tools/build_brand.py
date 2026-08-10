"""Genera los recursos de marca listos para web a partir de los originales.

Uso:
    python tools/build_brand.py

Lee los archivos institucionales de assets/brand/ (los másteres, sin tocar) y
escribe en assets/img/ las versiones que consume el sitio:

  otri-logo.svg        Logotipo OTRI para tema claro (texto en azul petróleo)
  otri-logo-dark.svg   El mismo con el texto en claro, para tema oscuro
  uptc-vie-cabezote.*  Membrete institucional reducido para el informe impreso

El logotipo original define los colores del isotipo con clases CSS (.cls-N) y
deja el texto "TRI" y el descriptor sin clase, por lo que heredan el fill del
elemento raíz. Basta con fijar ese fill para obtener cada variante sin alterar
los colores del isotipo.
"""

import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "assets" / "brand"
OUT = ROOT / "assets" / "img"

TEXT_LIGHT_THEME = "#0e2a32"   # azul petróleo de la marca, para fondos claros
TEXT_DARK_THEME = "#e9eff1"    # gris muy claro, para fondos oscuros

# Ancho al que se reduce el membrete: A4 útil (~180 mm) a ~200 ppp.
LETTERHEAD_WIDTH = 1500

# Alto del viewBox recortado que deja solo el logotipo, sin el descriptor.
COMPACT_HEIGHT = 185


def crop_viewbox(svg_text, height):
    """Recorta el alto del viewBox conservando el origen y el ancho."""
    def replace(match):
        x, y, width, _ = match.group(1).split()
        return f'viewBox="{x} {y} {width} {height}"'

    result, count = re.subn(r'viewBox="([^"]+)"', replace, svg_text, count=1)
    if not count:
        raise SystemExit("El archivo no declara viewBox")
    return result


def set_root_fill(svg_text, color):
    """Fija el atributo fill del <svg> raíz; lo heredan los trazos sin clase."""
    match = re.search(r"<svg\b[^>]*>", svg_text)
    if not match:
        raise SystemExit("El archivo no tiene un elemento <svg> raíz")
    tag = match.group(0)
    cleaned = re.sub(r'\sfill="[^"]*"', "", tag)
    replacement = cleaned[:-1] + f' fill="{color}">'
    return svg_text[: match.start()] + replacement + svg_text[match.end() :]


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    logo = (BRAND / "log_otri.svg").read_text(encoding="utf-8")
    (OUT / "otri-logo.svg").write_text(set_root_fill(logo, TEXT_LIGHT_THEME), encoding="utf-8")
    (OUT / "otri-logo-dark.svg").write_text(set_root_fill(logo, TEXT_DARK_THEME), encoding="utf-8")

    # Variante para la cabecera: a 40 px de alto el descriptor de dos líneas
    # resulta ilegible, así que se recorta el viewBox al logotipo principal.
    compact = crop_viewbox(logo, COMPACT_HEIGHT)
    (OUT / "otri-logo-compact.svg").write_text(set_root_fill(compact, TEXT_LIGHT_THEME), encoding="utf-8")
    (OUT / "otri-logo-compact-dark.svg").write_text(set_root_fill(compact, TEXT_DARK_THEME), encoding="utf-8")
    print("logotipos generados: completo y compacto, en variante clara y oscura")

    # cab_otri.svg no se publica: son 270 kB de trazos decorativos. La portada
    # reproduce su degradado con CSS (ver --hero-* en styles.css) y superpone
    # el logotipo, con el mismo resultado visual y sin peso extra.

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
