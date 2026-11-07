"""Render original bell-and-check artwork and theme-aware companion icons."""
from copy import deepcopy
from pathlib import Path
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SVG = "{http://www.w3.org/2000/svg}"


def generate_icons():
    source = ROOT / "assets/notification-bell.svg"
    with tempfile.TemporaryDirectory(prefix="codex-ember-") as temp:
        target = Path(temp) / "icon.png"
        subprocess.run(["gjs", "-c", '''imports.gi.versions.GdkPixbuf="2.0";
const p=imports.gi.GdkPixbuf.Pixbuf.new_from_file_at_scale(ARGV[0],1024,1024,true);
p.savev(ARGV[1],"png",[],[]);''', str(source), str(target)], check=True)
        with Image.open(target) as image:
            image.resize((512, 512), Image.Resampling.LANCZOS).save(ROOT / "codex-notifier.png")
    # Preserve the original bell and completion check for theme-aware icons.
    paths = ET.parse(source).getroot().findall(SVG + "path")
    for element in paths:
        for attribute in ("fill", "stroke"):
            if element.get(attribute) not in (None, "none"):
                element.set(attribute, "currentColor")
    ET.register_namespace("", "http://www.w3.org/2000/svg")
    activity = ET.Element(SVG + "svg", {"viewBox": "28 30 200 200"})
    activity.extend(paths)
    ET.ElementTree(activity).write(ROOT / "icon.svg", encoding="unicode")
    # Elementary bell and check geometry, created for this project. No vendor marks.
    tray_path = ("M12 2c-3.9 0-6.5 2.9-6.5 6.8V13L3 17v2h18v-2L18.5 13V8.8"
                 "C18.5 4.9 15.9 2 12 2Zm0 2c2.8 0 4.5 2.1 4.5 4.8v4.8L18.4 17H5.6"
                 "l1.9-3.4V8.8C7.5 6.1 9.2 4 12 4ZM9 20a3 3 0 0 0 6 0H9Z"
                 "M8.8 10.5l1.4-1.4 1.4 1.4 2.8-2.8 1.4 1.4-4.2 4.2Z")
    for name, color in (("blue", "#3b82f6"), ("blue-dim", "#183462"),
                        ("green", "#22c55e"), ("gray", "#9ca3af")):
        tray = ET.Element(SVG + "svg", {"viewBox": "0 0 24 24", "width": "24", "height": "24"})
        ET.SubElement(tray, SVG + "path", {"d": tray_path, "fill": color, "fill-rule": "evenodd"})
        ET.ElementTree(tray).write(ROOT / "media" / f"codex-{name}.svg", encoding="unicode")
    # Keep both sidebar marks synchronized with the production silhouette.
    sidebar = ROOT / "media/sidebar.html"
    html = sidebar.read_text()
    for kind, css in (("brand", "sidebar-brand"), ("glyph", "svg-icon notifier-glyph")):
        logo = ET.parse(source).getroot() if kind == "brand" else deepcopy(activity)
        logo.attrib.pop("role", None)
        logo.attrib.pop("aria-label", None)
        logo.set("class", css)
        logo.set("data-notifier-logo", kind)
        logo.set("aria-hidden", "true")
        markup = ET.tostring(logo, encoding="unicode")
        html = re.sub(r'<svg[^>]*data-notifier-logo="' + kind + r'"[^>]*>.*?</svg>',
                      lambda match: markup, html, flags=re.DOTALL)
    sidebar.write_text(html)



if __name__ == "__main__":
    generate_icons()
