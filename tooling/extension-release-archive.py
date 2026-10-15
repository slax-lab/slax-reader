"""Inspect a release ZIP without extracting or executing its contents."""
import fnmatch
import json
import posixpath
import stat
import sys
import zipfile
from html.parser import HTMLParser
from urllib.parse import unquote, urlsplit

LIMIT = 100 * 1024 * 1024


def inspect(filename):
    with zipfile.ZipFile(filename) as archive:
        entries = archive.infolist()
        if not entries or len(entries) > 10000 or sum(e.file_size for e in entries) > LIMIT:
            raise ValueError("Archive size or entry limit exceeded")
        names = set()
        for entry in entries:
            name = entry.filename
            parts = name.rstrip("/").split("/")
            if (name in names or name.startswith("/") or "\\" in name or
                    any(p in ("", ".", "..") or ":" in p or any(ord(c) < 32 for c in p) for p in parts) or
                    stat.S_ISLNK(entry.external_attr >> 16)):
                raise ValueError("Unsafe or duplicate archive entry")
            if any(p.startswith((".env", ".dev.vars")) for p in parts) or name.endswith((".ts", ".vue", ".map", ".pem", ".key")):
                raise ValueError("Source or sensitive file in archive")
            names.add(name)
        if archive.testzip() is not None:
            raise ValueError("Archive CRC mismatch")
        manifest = json.loads(archive.read("manifest.json"))

        def resource(value, pattern=False):
            if not isinstance(value, str) or not value or value.startswith("/") or "\\" in value or ".." in value.split("/"):
                raise ValueError("Invalid manifest resource")
            if not any((fnmatch.fnmatchcase(name, value) if pattern else name == value) for name in names if not name.endswith("/")):
                raise ValueError("Missing manifest resource")

        def icons(value):
            for icon in ([value] if isinstance(value, str) else value.values()):
                resource(icon)

        icons(manifest.get("icons", {}))
        background = manifest.get("background", {})
        if "service_worker" in background:
            resource(background["service_worker"])
        for script in manifest.get("content_scripts", []):
            for value in script.get("js", []) + script.get("css", []):
                resource(value)
        action = manifest.get("action", {})
        icons(action.get("default_icon", {}))
        for owner, field in [(action, "default_popup"), (manifest, "options_page"),
                             (manifest.get("options_ui", {}), "page"), (manifest.get("side_panel", {}), "default_path")]:
            if owner.get(field):
                resource(owner[field])
        for group in manifest.get("web_accessible_resources", []):
            for value in group["resources"]:
                resource(value, pattern=True)
        if manifest.get("default_locale"):
            resource("_locales/" + manifest["default_locale"] + "/messages.json")

        class Resources(HTMLParser):
            def handle_starttag(self, tag, attrs):
                for key, value in attrs:
                    if key not in ("src", "href") or not value:
                        continue
                    parsed = urlsplit(value)
                    if parsed.scheme or parsed.netloc or not parsed.path:
                        continue
                    path = unquote(parsed.path)
                    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(self.page), path.lstrip("/"))) if not path.startswith("/") else path.lstrip("/")
                    resource(resolved)

        for name in names:
            if name.endswith(".html"):
                parser = Resources()
                parser.page = name
                parser.feed(archive.read(name).decode("utf-8"))
        return {"manifest": manifest, "files": len(names)}


if __name__ == "__main__":
    try:
        print(json.dumps(inspect(sys.argv[1])))
    except Exception:
        sys.exit("Invalid extension archive (entries, CRC, manifest or referenced resources)")
