"""Reproduce contaminated terminal environments without opening the real desktop."""

import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("indicator_check", ROOT / "test/check_indicator_desktop.py")
indicator_check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(indicator_check)


class DesktopEnvironmentTests(unittest.TestCase):
    def test_python_and_runtime_use_the_same_environment_fixtures(self):
        fixtures = json.loads((ROOT / "test/fixtures/host-environment.json").read_text())
        for fixture in fixtures:
            with self.subTest(fixture["name"]):
                original = dict(fixture["source"])
                self.assertEqual(indicator_check.host_environment(fixture["source"]), fixture["expected"])
                self.assertEqual(fixture["source"], original)

    def test_desktop_tools_use_system_paths_instead_of_the_terminal_path(self):
        with patch.object(indicator_check.shutil, "which", return_value="/usr/bin/gjs") as which:
            self.assertEqual(indicator_check.system_tool("gjs"), "/usr/bin/gjs")
            which.assert_called_once_with("gjs", path="/usr/bin:/bin:/usr/local/bin")

    def test_missing_system_tools_fail_with_an_actionable_message(self):
        with patch.object(indicator_check.shutil, "which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "Required system desktop tool is unavailable: gjs"):
                indicator_check.system_tool("gjs")


if __name__ == "__main__":
    unittest.main()
