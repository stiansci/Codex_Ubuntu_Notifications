"""Generate the original Signal Bell icons."""
from pathlib import Path
import importlib.util
import json
import sys

ROOT = Path(__file__).resolve().parent.parent


def generate_icons():
    # Reuse the exact geometry of the selected proposal; do not duplicate it.
    spec = importlib.util.spec_from_file_location("notifier_icon_variants", ROOT / "scripts/generate-icon-variants.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    config = json.loads((ROOT / "assets/signal-bell.json").read_text())
    module.build(config).raster(512).save(ROOT / "codex-notifier.png")
    # A simplified monochrome outline stays legible in the 24px Activity Bar.
    # Its badge cuts out the underlying bell, using transparency rather than a
    # fixed background color so VS Code can tint it for every theme.
    (ROOT / "icon.svg").write_text('''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <defs><mask id="badge-space"><rect width="24" height="24" fill="white" stroke="none"/><circle cx="18" cy="6" r="5.2" fill="black" stroke="none"/></mask></defs>
  <g mask="url(#badge-space)"><path d="M6.4 10a5.1 5.1 0 0 1 10.2 0c0 4.1.5 5.5 2 7H4.4c1.5-1.5 2-2.9 2-7Z"/><path d="M9.3 20a2.4 2.4 0 0 0 4.4 0M11.5 3V2"/></g>
  <circle cx="18" cy="6" r="3.8"/><path d="m16.3 6 1.2 1.2L19.7 5"/>
</svg>
''')



if __name__ == "__main__":
    generate_icons()
