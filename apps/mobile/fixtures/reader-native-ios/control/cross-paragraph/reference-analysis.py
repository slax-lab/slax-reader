"""Readonly analysis of the already archived native Alpha PNG; no device input."""
from collections import deque
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[6]
REFERENCE = ROOT / "retired-evidence"
FILES = {
    "png": ("raw/attachments/83EE1EF4-C49A-4510-85A4-03B1E1EE7D46.png", "0bee483fd7932174a320dbd4e89243ca66d03946fb63bd7144e9a0308f83e4c7"),
    "ax": ("raw/attachments/4B845D93-7494-4C80-8621-7B64D073D88D.txt", "8075576e58e336f096c7fba80fbf58a045e839c66b7edf918220ffe1bf3e4782"),
    "selection": ("raw/selection-readonly-snapshot.json", "b4492630236abf155de35a0d80272b8c0480d5c529e71281492bb5c72981c513"),
}
inputs = {}
for name, (relative, expected) in FILES.items():
    path = REFERENCE / relative
    if path.is_symlink() or not path.is_file():
        raise ValueError("Reference is not a regular public evidence file")
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != expected:
        raise ValueError("Archived reference hash changed")
    inputs[name] = {"path": str(path), "sha256": digest, "bytes": len(data)}

tree = (REFERENCE / FILES["ax"][0]).read_text()
for frame, label in [("{{20.0, 326.0}, {46.0, 20.0}}", "Alpha"), ("{{75.0, 378.0}, {164.0, 20.0}}", "paragraph with quote.")]:
    if not any(frame in line and f"label: '{label}'" in line for line in tree.splitlines()):
        raise ValueError("The native AX text reference changed")
if tree.count("identifier: 'selection_action_bar'") != 1:
    raise ValueError("The original selection bar reference is ambiguous")
selection = json.loads((REFERENCE / FILES["selection"][0]).read_text())
if selection["captured"] != {"textLength": 5, "paths": 1} or selection["position"]["observed"]["positionPixels"] != 240:
    raise ValueError("The actual native Alpha/source position reference changed")

image = Image.open(REFERENCE / FILES["png"][0]).convert("RGBA")
if image.size != (1206, 2622):
    raise ValueError("Unsupported native screenshot size")
# Same bounded word-relative pixel region and blue-paint band as the prepared
# Swift input guard. This host analysis does not validate Swift bitmap orientation.
blue = set()
for y in range((326 - 24) * 3, (346 + 24) * 3):
    for x in range(0, (66 + 20) * 3):
        red, green, blue_value, alpha = image.getpixel((x, y))
        if red < 55 and 75 < green < 155 and blue_value > 180 and alpha == 255:
            blue.add((x, y))
components = []
while blue:
    first = blue.pop()
    queue, points = deque([first]), [first]
    while queue:
        x, y = queue.popleft()
        for neighbour in [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)]:
            if neighbour in blue:
                blue.remove(neighbour)
                queue.append(neighbour)
                points.append(neighbour)
    rows = {}
    for x, y in points:
        rows.setdefault(y, []).append(x)
    widest = max(max(xs) - min(xs) + 1 for xs in rows.values())
    ball_rows = [(y, xs) for y, xs in rows.items() if max(xs) - min(xs) + 1 == widest]
    center_x = sum((min(xs) + max(xs) + 1) / 2 for _, xs in ball_rows) / len(ball_rows)
    center_y = sum(y + 0.5 for y, _ in ball_rows) / len(ball_rows)
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    if not (len(points) >= 180 * 9 and 42 <= widest <= 54 and 95 <= len(rows) <= 115):
        raise ValueError("Unexpected blue component in the bounded handle region")
    components.append({"pixels": len(points), "boundsPixels": [min(xs), min(ys), max(xs) + 1, max(ys) + 1],
                       "widestRowPixels": widest, "rowCount": len(rows), "ballCenterPixels": [center_x, center_y],
                       "ballCenterNativePoints": [center_x / 3, center_y / 3]})
components.sort(key=lambda component: component["ballCenterPixels"][0])
if len(components) != 2:
    raise ValueError("No unique native handle pair")
print(json.dumps({"status": "readonly-archived-native-reference-inspected", "inputs": inputs,
                  "viewportPoints": [402, 874], "screenshotPixels": [1206, 2622],
                  "alphaAX": [20, 326, 46, 20], "secondParagraphAX": [75, 378, 164, 20],
                  "components": components, "nativeCrossParagraphExecuted": False,
                  "newSwiftCompiled": False, "swiftBitmapOrientationVerified": False}, indent=2))
