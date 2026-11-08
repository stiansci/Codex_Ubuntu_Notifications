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
        (self.root / ".gitignore").write_text("/private/\n.env\n")
        (self.root / "source.js").write_text('"use strict";\n')
        self.git("add", ".")
        self.git("commit", "-qm", "Synthetic public source")

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.root), *args], env=self.env)

    def test_private_untracked_files_stay_local_but_forced_tracking_is_rejected(self):
        (self.root / ".env").write_text("synthetic local settings")
        (self.root / "private").mkdir()
        (self.root / "private" / "backup").write_text("local backup")
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

    def test_old_tag_is_rejected_even_after_current_readme_is_cleaned(self):
        # Use a synthetic development heading rather than copying private policy text.
        (self.root / "README.md").write_text("# Example\n\n## Agent instructions\nLocal implementation notes.\n")
        self.git("add", "README.md")
        self.git("commit", "-qm", "Synthetic documentation fixture")
        self.git("tag", "old-draft")
        self.git("checkout", "--orphan", "clean-public")
        (self.root / "README.md").write_text("# Example\n\nChoose your notification settings.\n")
        self.git("add", "README.md")
        self.git("commit", "-qm", "Clean public source")
        self.assertEqual(public_check.readme_history(["HEAD"], root=self.root), [])
        self.assertTrue(public_check.readme_history(["old-draft"], root=self.root))

    def test_removing_notes_in_latest_commit_does_not_clean_ancestor(self):
        (self.root / "README.md").write_text("# Example\n\n## Development\nBuild details.\n")
        self.git("add", "README.md")
        self.git("commit", "-qm", "Synthetic development fixture")
        (self.root / "README.md").write_text("# Example\n\nChoose your alerts.\n")
        self.git("add", "README.md")
        self.git("commit", "-qm", "Clean description")
        self.assertTrue(public_check.readme_history(["HEAD"], root=self.root))


if __name__ == "__main__":
    unittest.main()
