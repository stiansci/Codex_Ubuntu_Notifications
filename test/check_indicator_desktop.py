"""Bounded desktop smoke check on a private D-Bus session and synthetic chat."""

from datetime import datetime, timezone
import json
import os
import re
import shutil
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
NAME = "com.karotechnica.CodexActivity"
OBJECT = "/org/ayatana/NotificationItem/codex_activity"
HOST_ENVIRONMENT = json.loads((ROOT / "lib" / "hostEnvironment.json").read_text())


def host_environment(source):
    """Match the runtime policy, including Snap module paths without SNAP markers."""
    env = dict(source)
    prefixes = tuple(HOST_ENVIRONMENT["prefixes"])
    keys = HOST_ENVIRONMENT["loaderKeys"]
    defaults = HOST_ENVIRONMENT["xdgDefaults"]
    contaminated = any(
        (key.startswith("SNAP") and value) or
        ((key.startswith(prefixes) or key in keys or key in defaults) and "/snap/" in value)
        for key, value in source.items())
    if not contaminated:
        return env
    for key in list(env):
        if key.startswith(prefixes) or key in keys:
            env.pop(key, None)
    for key, fallback in defaults.items():
        original = source.get(key + "_VSCODE_SNAP_ORIG", "")
        env[key] = os.pathsep.join(part for part in original.split(os.pathsep)
                                   if os.path.isabs(part) and "/snap/" not in part) or fallback
    return env


def system_tool(name):
    """Use Ubuntu desktop tools rather than a Conda or Snap shadow on PATH."""
    binary = shutil.which(name, path=os.pathsep.join(("/usr/bin", "/bin", "/usr/local/bin")))
    if not binary:
        raise RuntimeError(f"Required system desktop tool is unavailable: {name}")
    return binary


def main():
    env = host_environment(os.environ)
    env["GDK_BACKEND"] = "x11"
    if "--inside" not in sys.argv:
        return subprocess.run([system_tool("dbus-run-session"), "--", sys.executable, __file__, "--inside"],
                              env=env, timeout=25).returncode
    gjs, gdbus = system_tool("gjs"), system_tool("gdbus")
    with tempfile.TemporaryDirectory(prefix="codex-indicator-smoke-") as folder:
        home = Path(folder)
        rollout = home / "session.jsonl"
        def event(kind):
            with rollout.open("a") as stream:
                stream.write(json.dumps({"timestamp": datetime.now(timezone.utc).isoformat(),
                                         "type": "event_msg", "payload": {"type": kind}}) + "\n")
        event("task_complete")
        with sqlite3.connect(home / "state_5.sqlite") as c:
            c.execute("CREATE TABLE threads(id TEXT, title TEXT, cwd TEXT, rollout_path TEXT, source TEXT, thread_source TEXT, archived INTEGER)")
            c.execute("INSERT INTO threads VALUES ('synthetic', 'Proponi design per box esplicativo', '/tmp/my_project', ?, 'vscode', 'user', 0)", (str(rollout),))
        config = {"home": str(home), "python": sys.executable, "flash": True,
                  "code": "/usr/bin/true",
                  "colors": {"working": "#8844ee", "finished": "#00aa88"}}
        args = [gjs, str(ROOT / "topbar-indicator.js"), json.dumps({**config, "bootstrap": True})]
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
        def property_value(name):
            result = subprocess.run([gdbus, "call", "--session", "--dest", NAME, "--object-path", OBJECT,
                "--method", "org.freedesktop.DBus.Properties.Get", "org.kde.StatusNotifierItem", name],
                capture_output=True, text=True, timeout=2, env=env)
            return result.stdout if result.returncode == 0 else ""
        def menu_layout():
            result = subprocess.run([gdbus, "call", "--session", "--dest", NAME,
                "--object-path", OBJECT + "/Menu", "--method", "com.canonical.dbusmenu.GetLayout",
                "--", "0", "-1", "[]"], capture_output=True, text=True, timeout=2, env=env)
            assert result.returncode == 0, result.stderr
            return result.stdout
        def wait_for(predicate):
            deadline = time.monotonic() + 6
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise AssertionError("Indicator exited: " + process.communicate()[1])
                if predicate():
                    return
                time.sleep(0.15)
            raise AssertionError("Timed out waiting for indicator state")
        def assert_artwork(label):
            filename = re.search(r"'([^']+)'", property_value("IconName")).group(1)
            svg = ET.parse(filename).getroot()
            namespace = {"s": "http://www.w3.org/2000/svg"}
            assert float(svg.attrib["width"]) >= 1.5 * float(svg.attrib["height"])
            assert svg.find("s:text", namespace).text == label
            assert svg.find("s:path", namespace) is not None  # Separator before logo.
            assert svg.find("s:g/s:path", namespace) is not None
            color = svg.find("s:g/s:path", namespace).attrib["fill"]
            assert color in ({"#00aa88"} if label == "0" else {"#8844ee", "#361b5f"})
            assert "''" in property_value("XAyatanaLabel")  # No second count after logo.
        try:
            wait_for(lambda: "codex-green-0.svg" in property_value("IconName"))
            assert_artwork("0")
            duplicate = subprocess.run(args, capture_output=True, text=True, timeout=3, env=env)
            assert duplicate.returncode == 0, duplicate.stderr
            replacement = subprocess.Popen(args[:2] + [json.dumps(config)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
            process.communicate(timeout=3)
            assert process.returncode == 0
            process = replacement
            wait_for(lambda: "codex-green-0.svg" in property_value("IconName"))
            event("task_started")
            wait_for(lambda: "codex-blue-1.svg" in property_value("IconName"))
            assert_artwork("1")
            # dbusmenu escapes literal underscores for native mnemonic parsing.
            layout = menu_layout().replace("__", "_")
            assert "Open VS Code (1 chat working)" in layout, layout
            assert "Open workspace: my_project (1 chat working)" in layout, layout
            assert "Proponi" not in layout, layout
            assert "Counts local VS Code chats" not in layout, layout
            assert "Flash while working" in layout and "checkmark" in layout, layout
            time.sleep(2.2)
            assert menu_layout().replace("__", "_") == layout, "Polling rebuilt the native menu"
            wait_for(lambda: "codex-blue-dim-1.svg" in property_value("IconName"))
            event("task_complete")
            wait_for(lambda: "codex-green-0.svg" in property_value("IconName"))
            assert_artwork("0")
            print("Desktop smoke check passed: green/0, blue/1, flashing, completion, singleton ownership, bootstrap handoff and native workspace menu without conversation titles.")
        finally:
            process.terminate()
            stdout, stderr = process.communicate(timeout=3)
            if process.returncode != 0:
                print(stdout, stderr, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
