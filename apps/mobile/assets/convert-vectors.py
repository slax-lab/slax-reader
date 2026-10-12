#!/usr/bin/env python3
"""Regenerate four source vector assets using explicitly supplied bundled sharp tooling.

This is build-time asset tooling; it is not a mobile dependency or config plugin.
Only copied vector XMLs in this directory are read. No source-repository discovery
or external XML references are permitted.
"""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
NAMES = ("ic_rss", "ic_rss_save", "ic_rss_refresh", "ic_bottom_panel_transcript")
ANDROID = "{http://schemas.android.com/apk/res/android}"


def paint(value):
    if len(value) == 9 and value.startswith("#"):
        return "#" + value[3:], str(int(value[1:3], 16) / 255)
    if len(value) == 7 and value.startswith("#"):
        return value, "1"
    raise ValueError(f"Unsupported source vector paint: {value}")


def svg_for(xml_bytes):
    if b"<!" in xml_bytes:
        raise ValueError("Source vectors must not contain XML declarations with entities")
    vector = ET.fromstring(xml_bytes)
    if vector.tag != "vector":
        raise ValueError("Expected an Android vector")
    allowed_root = {ANDROID + key for key in ("width", "height", "viewportWidth", "viewportHeight")}
    if set(vector.attrib) - allowed_root:
        raise ValueError("Unexpected root attributes require a reviewed converter update")
    width = vector.attrib[ANDROID + "width"].removesuffix("dp")
    height = vector.attrib[ANDROID + "height"].removesuffix("dp")
    viewport_width = vector.attrib[ANDROID + "viewportWidth"]
    viewport_height = vector.attrib[ANDROID + "viewportHeight"]
    svg = ET.Element("svg", {
        "xmlns": "http://www.w3.org/2000/svg", "width": width, "height": height,
        "viewBox": f"0 0 {viewport_width} {viewport_height}",
    })
    attributes = {
        "pathData": "d", "strokeWidth": "stroke-width",
        "strokeLineCap": "stroke-linecap", "strokeLineJoin": "stroke-linejoin",
    }
    allowed_path = {ANDROID + key for key in (*attributes, "fillColor", "strokeColor")}
    for path in vector:
        if path.tag != "path" or set(path.attrib) - allowed_path:
            raise ValueError("Only the audited path attributes are supported")
        if len(path):
            raise ValueError("Nested source vector content is not supported")
        result = {target: path.attrib[ANDROID + source]
                  for source, target in attributes.items() if ANDROID + source in path.attrib}
        for source, target in (("fillColor", "fill"), ("strokeColor", "stroke")):
            if ANDROID + source in path.attrib:
                color, alpha = paint(path.attrib[ANDROID + source])
                result[target] = color
                if alpha != "1":
                    result[target + "-opacity"] = alpha
        # VectorDrawable's absent fillColor is transparent, unlike SVG's black.
        result.setdefault("fill", "none")
        ET.SubElement(svg, "path", result)
    return (ET.tostring(svg, encoding="unicode") + "\n").encode("utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", required=True, help="Path to an existing Node runtime")
    parser.add_argument("--sharp", required=True, help="Path to an existing sharp entry module")
    args = parser.parse_args()
    renderer = """
const fs = require('fs');
const sharp = require(process.argv[1]);
(async () => {
  await sharp(fs.readFileSync(process.argv[2]), {density: 288})
    .png({compressionLevel: 9, adaptiveFiltering: false, palette: false})
    .toFile(process.argv[3]);
  process.stdout.write(JSON.stringify(sharp.versions));
})().catch(error => { process.stderr.write(String(error)); process.exit(1); });
"""
    records = []
    for name in NAMES:
        xml = ROOT / "vectors" / (name + ".xml")
        svg = ROOT / "vectors" / (name + ".svg")
        png = ROOT / "drawable" / (name + ".png")
        svg.write_bytes(svg_for(xml.read_bytes()))
        versions = json.loads(subprocess.check_output(
            [args.node, "-e", renderer, args.sharp, str(svg), str(png)], text=True))
        records.append({
            "name": name, "scale": 4, "logicalWidth": 24, "logicalHeight": 24,
            "sourceSha256": hashlib.sha256(xml.read_bytes()).hexdigest(),
            "svgSha256": hashlib.sha256(svg.read_bytes()).hexdigest(),
            "pngSha256": hashlib.sha256(png.read_bytes()).hexdigest(),
            "renderer": "sharp (SVG through librsvg)", "rendererVersions": versions,
        })
    (ROOT / "vector-conversions.json").write_text(
        json.dumps({"schemaVersion": 1, "conversions": records}, indent=2) + "\n")
    print(json.dumps({"converted": len(records), "names": list(NAMES)}))


if __name__ == "__main__":
    main()
