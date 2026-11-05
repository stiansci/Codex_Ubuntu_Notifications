"""Check the actual VSIX allowlist and metadata without installing the extension."""
from pathlib import Path
import json
import re
import zipfile
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parent.parent
package = json.loads((root / "package.json").read_text())
vsix = root / "dist" / f'{package["name"]}-{package["version"]}.vsix'
expected = {"package.json", "extension.js", "preview-overlay.js", "codex-notifier.png", "icon.svg",
            "README.md", "CHANGELOG.md", "LICENSE", "ASSETS.md", "TESTING.md"}
expected.update({"lib/core.js", "lib/extension.js", "lib/monitor.js", "lib/platform.js", "lib/theme.js", "lib/worker.py",
                 "media/sidebar.js", "media/sidebar.html", "media/sidebar.css"})
expected.update(f"sounds/synth-{n}.wav" for n in range(1, 5))
expected.add("lib/notificationMarkdown.js")
with zipfile.ZipFile(vsix) as archive:
    # VSCE normalizes the standard documentation asset names in the archive.
    aliases = {"readme.md": "README.md", "changelog.md": "CHANGELOG.md", "LICENSE.txt": "LICENSE"}
    entries = {aliases.get(n.removeprefix("extension/"), n.removeprefix("extension/")): n
               for n in archive.namelist() if n.startswith("extension/") and not n.endswith("/")}
    actual = set(entries)
    missing, unexpected = expected - actual, actual - expected
    assert not missing and not unexpected, f"Missing entries: {sorted(missing)}; unexpected entries: {sorted(unexpected)}. Rebuild with npm run package."
    for name in expected:
        packaged = archive.read(entries[name])
        source = (root / name).read_bytes()
        if name in ("README.md", "CHANGELOG.md"):
            # VSCE makes relative Markdown links usable on the Marketplace.
            base = package["repository"]["url"].removesuffix(".git") + "/blob/HEAD/"
            text = source.decode()
            text = re.sub(r"\]\((?![a-z]+:|#|/)([^)]+)\)", lambda m: "](" + base + m[1] + ")", text)
            source = text.encode()
        assert packaged == source, f"Stale file: {name}"
    manifest = ET.fromstring(archive.read("extension.vsixmanifest"))
    identity = next(e for e in manifest.iter() if e.tag.endswith("}Identity"))
    assert identity.attrib["Version"] == package["version"]
    assert identity.attrib["Publisher"] == package["publisher"]
print(f"Verified {vsix.name}: exact runtime allowlist, current sources and matching metadata.")
