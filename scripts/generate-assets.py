"""Render an original reply notification preview and small reply-panel companion icons."""
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
    source = ROOT / "assets/reply-preview.svg"
    with tempfile.TemporaryDirectory(prefix="codex-reply-") as temp:
        target = Path(temp) / "icon.png"
        subprocess.run(["gjs", "-c", '''imports.gi.versions.GdkPixbuf="2.0";
const p=imports.gi.GdkPixbuf.Pixbuf.new_from_file_at_scale(ARGV[0],1024,1024,true);
p.savev(ARGV[1],"png",[],[]);''', str(source), str(target)], check=True)
        with Image.open(target) as image:
            image.resize((512, 512), Image.Resampling.LANCZOS).save(ROOT / "codex-notifier.png")
    # Small icons use a reply bubble and two answer lines instead of tiny text.
    activity = ET.parse(ROOT / "assets/reply-glyph.svg").getroot()
    ET.register_namespace("", "http://www.w3.org/2000/svg")
    ET.ElementTree(activity).write(ROOT / "icon.svg", encoding="unicode")
    for name, color in (("blue", "#3b82f6"), ("blue-dim", "#183462"),
                        ("green", "#22c55e"), ("gray", "#9ca3af")):
        tray = deepcopy(activity)
        tray.set("width", "24")
        tray.set("height", "24")
        for element in tray.findall(SVG + "path"):
            element.set("fill", color)
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
