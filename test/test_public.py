"""Exercise publication checks against disposable Git histories and synthetic credentials."""

import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("public_check", Path(__file__).resolve().parents[1] / "scripts/check-public.py")
public_check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(public_check)


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = {**os.environ, "GIT_AUTHOR_NAME": "KaroTechnica", "GIT_COMMITTER_NAME": "KaroTechnica",
                    "GIT_AUTHOR_EMAIL": "stiansci@users.noreply.github.com",
                    "GIT_COMMITTER_EMAIL": "stiansci@users.noreply.github.com"}
        self.git("init", "-q")
        (self.root / ".gitignore").write_text(".private/\n.env\n")
        (self.root / "source.js").write_text('"use strict";\n')
        self.git("add", ".")
        self.git("commit", "-qm", "Synthetic public source")

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.root), *args], env=self.env)

    def test_private_untracked_files_stay_local_but_forced_tracking_is_rejected(self):
        (self.root / ".env").write_text("synthetic local settings")
        (self.root / ".private").mkdir()
        (self.root / ".private" / "backup").write_text("local backup")
        self.assertEqual(public_check.check(self.root, release=True)[0], [])
        self.git("add", "-f", ".env")
        self.assertTrue(any("tracked private" in item for item in public_check.check(self.root)[0]))

    def test_deleted_secret_and_personal_identity_are_detected_in_history(self):
        (self.root / "leak.txt").write_text("ghp_" + "A" * 36)
        self.env["GIT_AUTHOR_EMAIL"] = "person@example.org"
        self.git("add", "leak.txt")
        self.git("commit", "-qm", "Synthetic historical secret")
        self.git("rm", "-q", "leak.txt")
        self.git("commit", "-qm", "Remove fixture")
        findings = public_check.check(self.root)[0]
        self.assertTrue(any("GitHub token" in item and "history" in item for item in findings))
        self.assertTrue(any("author/committer email" in item for item in findings))
        self.assertFalse(any("A" * 36 in item for item in findings))

    def test_release_rejects_untracked_required_source(self):
        (self.root / "helper.js").write_text("// New required helper\n")
        self.assertTrue(any("untracked public" in item for item in public_check.check(self.root, release=True)[0]))


if __name__ == "__main__":
    unittest.main()
