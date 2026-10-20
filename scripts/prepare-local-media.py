"""Generate local-only web derivatives. Never publishes user originals.

Run: python scripts/prepare-local-media.py
The API serves these only in a loopback development/test environment.
"""
from pathlib import Path
from PIL import Image, ImageOps
import hashlib
import json

root = Path(__file__).resolve().parent.parent
target = root / ".local" / "media"
target.mkdir(parents=True, exist_ok=True)
sources = {"hero": "GP017062.JPG", "diving": "GP011375.JPG", "reef": "GP011387.JPG"}
manifest = []
for key, source in sources.items():
    path = root / "media" / source
    if not path.exists():
        continue
    with Image.open(path) as original:
        image = ImageOps.exif_transpose(original).convert("RGB")
        image.thumbnail((1800, 1400))
        output = target / f"{key}.webp"
        image.save(output, "WEBP", quality=82, method=6)
        manifest.append({"key": key, "source": source, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                         "width": image.width, "height": image.height, "bytes": output.stat().st_size,
                         "publicationApproved": False, "exifRemoved": True})
(target / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(json.dumps([{"key": x["key"], "bytes": x["bytes"], "dimensions": [x["width"], x["height"]]} for x in manifest]))
