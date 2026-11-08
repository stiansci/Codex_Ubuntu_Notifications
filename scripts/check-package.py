"""Check the actual VSIX allowlist and metadata without installing the extension."""
from pathlib import Path
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parent.parent
package = json.loads((root / "package.json").read_text())
marketplace = "--marketplace" in sys.argv[1:]
suffix = "-marketplace" if marketplace else ""
vsix = root / "dist" / f'{package["name"]}-{package["version"]}{suffix}.vsix'
repository = package["repository"]["url"].removesuffix(".git").rstrip("/")
assert repository.startswith("https://github.com/"), "Marketplace link checks require the declared HTTPS GitHub repository."
release = "v" + package["version"]
content_base = f"{repository}/blob/{release}/"
image_base = repository.replace("https://github.com/", "https://raw.githubusercontent.com/", 1) + f"/{release}/"


def local_documentation(data):
    """Undo only the permitted release-tag URL rewrite, retaining exact source checks."""
    def restore(match):
        image, label, target = match.groups()
        prefix = image_base if image else content_base
        if target.startswith(prefix):
            target = target.removeprefix(prefix)
        return f"{image}[{label}]({target})"
    return re.sub(r"(!?)\[([^\]\n]*)\]\(([^)\n]+)\)", restore, data.decode()).encode()


def customer_readme(text, location):
    """Reject known development/agent-note leaks in the customer-facing description."""
    headings = r"(?im)^#{1,6}\s+(?:release preparation|repository layout|develop(?:er|ment)\b|agent instructions|policy di\b)"
    assert not re.search(headings, text), f"Customer README contains a development/internal heading: {location}"
    forbidden = ("Policy di styling", "La scheda bottom left", "Il font ricevuto", "Riferimento:",
                 "AGENTS.md", "private/backups", "private/notes", "private/design", "extensionDevelopmentPath",
                 "npm ci", "npm run", "thread_turns", "rollout_ordinal", "thread_history_1.sqlite")
    for token in forbidden:
        assert token.casefold() not in text.casefold(), f"Customer README contains internal/development content ({token}): {location}"


customer_readme((root / "README.md").read_text(), "README.md")
expected = {"package.json", "extension.js", "preview-overlay.js", "codex-notifier.png", "icon.svg",
            "README.md", "CHANGELOG.md", "LICENSE", "LICENSING.md", "VERSIONING.md", "ASSETS.md", "TESTING.md", "PUBLICATION.md"}
expected.update({"lib/core.js", "lib/extension.js", "lib/monitor.js", "lib/platform.js", "lib/theme.js", "lib/worker.py",
                 "media/sidebar.js", "media/sidebar.html", "media/sidebar.css"})
expected.update(f"sounds/synth-{n}.wav" for n in range(1, 5))
expected.add("lib/notificationMarkdown.js")
expected.update({"lib/activity.py", "lib/indicator.js", "topbar-indicator.js"})
expected.add("lib/topbarArtwork.js")
expected.add("lib/topbarMenu.js")
expected.add("lib/dependencies.js")
expected.update({"lib/payload.js", "lib/native_notification.py"})
expected.add("lib/hostEnvironment.json")
expected.update(str(p.relative_to(root)) for p in (root / "docs" / "screenshots").glob("*.png"))
expected.update(f"media/codex-{color}.svg" for color in ("blue", "blue-dim", "green", "gray"))
with zipfile.ZipFile(vsix) as archive:
    # VSCE normalizes the standard documentation asset names in the archive.
    aliases = {"readme.md": "README.md", "changelog.md": "CHANGELOG.md", "LICENSE.txt": "LICENSE"}
    entries = {aliases.get(n.removeprefix("extension/"), n.removeprefix("extension/")): n
               for n in archive.namelist() if n.startswith("extension/") and not n.endswith("/")}
    actual = set(entries)
    missing, unexpected = expected - actual, actual - expected
    assert not missing and not unexpected, f"Missing entries: {sorted(missing)}; unexpected entries: {sorted(unexpected)}. Rebuild with npm run package."
    assert package["license"] == "SEE LICENSE IN LICENSE", "Declare the combined license instead of unrestricted MIT."
    assert archive.read(entries["LICENSE"]).startswith(b"Commons Clause License Condition v1.0"), "The Commons Clause notice is missing."
    for name in expected:
        packaged = archive.read(entries[name])
        source = (root / name).read_bytes()
        if name == "README.md":
            customer_readme(packaged.decode(), f"{vsix.name}/README.md")
        if marketplace and name in {"README.md", "CHANGELOG.md"}:
            if name == "README.md":
                images = re.findall(r"!\[[^\]\n]*\]\(([^)\n]+)\)", packaged.decode())
                assert images and all(url.startswith(image_base) and url.endswith(".png") for url in images), \
                    "Marketplace images must use HTTPS PNG URLs pinned to this release tag."
            packaged = local_documentation(packaged)
        assert packaged == source, f"Stale file: {name}"
    manifest = ET.fromstring(archive.read("extension.vsixmanifest"))
    identity = next(e for e in manifest.iter() if e.tag.endswith("}Identity"))
    assert identity.attrib["Version"] == package["version"]
    assert identity.attrib["Publisher"] == package["publisher"]
print(f"Verified {vsix.name}: exact runtime allowlist, current sources, matching metadata" +
      (" and release-tag HTTPS documentation links." if marketplace else "."))
