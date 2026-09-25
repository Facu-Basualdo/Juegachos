"""Comprime las portadas de public/covers/ para la landing.

Las portadas llegan del generador de imagenes como PNG de ~1254px y 2-3 MB
(muchas renombradas a .jpg sin convertir). La card las muestra a ~270-400px,
asi que 800px cubre pantallas 2x. Este script las re-codifica como JPEG real,
conservando el nombre (coverUrl() pide /covers/<id>.jpg).

Es idempotente: saltea las que ya son JPEG, estan dentro del tamano y pesan
menos de SKIP_BYTES, para no re-comprimir (y degradar) las ya procesadas.
Solo reemplaza el archivo si el resultado pesa menos que el original.

Uso (requiere Pillow: pip install pillow):
    python scripts/compress-covers.py
"""

import io
from pathlib import Path

from PIL import Image

COVERS = Path(__file__).resolve().parent.parent / "public" / "covers"
MAX_SIDE = 800
# El banner de salas es apaisado y ocupa el ancho del contenido.
MAX_SIDE_OVERRIDES = {"rooms-banner.jpg": 1600}
QUALITY = 80
SKIP_BYTES = 250_000


def compress(path: Path) -> tuple[int, int] | None:
    before = path.stat().st_size
    max_side = MAX_SIDE_OVERRIDES.get(path.name, MAX_SIDE)
    with Image.open(path) as im:
        fmt = im.format
        if fmt == "JPEG" and max(im.size) <= max_side and before <= SKIP_BYTES:
            return None
        im = im.convert("RGB")
        if max(im.size) > max_side:
            im.thumbnail((max_side, max_side), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=QUALITY, optimize=True, progressive=True)
    data = buf.getvalue()
    if len(data) >= before:
        return None
    path.write_bytes(data)
    return before, len(data)


def main() -> None:
    total_before = total_after = 0
    for path in sorted(COVERS.glob("*.jpg")):
        result = compress(path)
        size = path.stat().st_size
        if result is None:
            total_before += size
            total_after += size
            continue
        before, after = result
        total_before += before
        total_after += after
        print(f"{path.name:28} {before / 1024:8.0f} KB -> {after / 1024:6.0f} KB")
    print(f"\nTotal: {total_before / 1e6:.1f} MB -> {total_after / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
