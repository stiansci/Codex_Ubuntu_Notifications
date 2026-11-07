"""Check chat counts using synthetic sessions, never the user's chat contents."""

import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone

SPEC = importlib.util.spec_from_file_location("activity", Path(__file__).resolve().parents[1] / "lib" / "activity.py")
activity = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(activity)


class ActivityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.database = self.home / "state_5.sqlite"
        with sqlite3.connect(self.database) as c:
            c.execute("CREATE TABLE threads(id TEXT, title TEXT, cwd TEXT, rollout_path TEXT, source TEXT, thread_source TEXT, archived INTEGER)")
        self.reader = activity.Activity(self.home, boot=1000)

    def chat(self, thread, source="vscode", thread_source="user", archived=0):
        file = self.home / f"{thread}.jsonl"
        file.write_text("")
        with sqlite3.connect(self.database) as c:
            c.execute("INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?)",
                      (thread, thread, "/tmp/project", str(file), source, thread_source, archived))
        return file

    def event(self, file, kind, timestamp=2000, **extra):
        with file.open("a") as stream:
            stream.write(json.dumps({"timestamp": datetime.fromtimestamp(timestamp, timezone.utc).isoformat(),
                                    "type": "event_msg", "payload": {"type": kind, **extra}}) + "\n")
        os.utime(file, (timestamp, timestamp))

    def test_counts_chats_across_workspaces_and_terminal_events_clear_them(self):
        first, second = self.chat("first"), self.chat("second")
        self.event(first, "task_started")
        self.event(second, "task_started")
        self.assertEqual(self.reader.snapshot(now=2001)["count"], 2)
        self.event(first, "task_complete", 2002)
        self.assertEqual(self.reader.snapshot(now=2003)["count"], 1)
        self.event(second, "turn_aborted", 2004)
        self.assertEqual(self.reader.snapshot(now=2005)["count"], 0)
        self.assertEqual(self.reader.snapshot(now=2005)["uncertain"], 0)
        self.event(first, "task_started", 2006)
        self.assertEqual(self.reader.snapshot(now=2007)["count"], 1)

    def test_subagents_cli_and_archived_chats_are_excluded(self):
        for name, kwargs in (("sub", {"thread_source": "subagent"}), ("cli", {"source": "cli"}), ("old", {"archived": 1})):
            self.event(self.chat(name, **kwargs), "task_started")
        self.assertEqual(self.reader.snapshot(now=2001)["count"], 0)

    def test_snapshots_do_not_expose_conversation_titles(self):
        self.event(self.chat("private"), "task_started")
        with sqlite3.connect(self.database) as connection:
            connection.execute("UPDATE threads SET title = ?", ("Proponi design per box esplicativo",))
        result = self.reader.snapshot(now=2001)
        self.assertEqual(result["chats"], [{"id": "private", "cwd": "/tmp/project"}])
        self.assertNotIn("Proponi", json.dumps(result))

    def test_previous_boot_is_ignored_but_quiet_current_work_is_uncertain(self):
        old, quiet = self.chat("old"), self.chat("quiet")
        self.event(old, "task_started", 500)
        self.event(quiet, "task_started", 2000)
        result = self.reader.snapshot(now=3000)
        self.assertEqual((result["count"], result["uncertain"]), (0, 1))
        self.event(quiet, "agent_message", 3001, phase="commentary")
        self.assertEqual(self.reader.snapshot(now=3002)["count"], 1)
        self.event(quiet, "agent_message", 3003, phase="final_answer")
        self.assertEqual(self.reader.snapshot(now=3004)["count"], 0)

    def test_partial_lines_do_not_clear_work_and_missing_database_is_unavailable(self):
        file = self.chat("one")
        self.event(file, "task_started")
        self.assertEqual(self.reader.snapshot(now=2001)["count"], 1)
        with file.open("a") as stream:
            stream.write('{"type":')
        self.assertEqual(self.reader.snapshot(now=2001)["count"], 1)
        self.database.unlink()
        self.assertEqual(self.reader.snapshot(now=2001)["status"], "unavailable")

    def test_long_tool_records_preserve_cached_running_state(self):
        file = self.chat("long")
        self.event(file, "task_started")
        self.assertEqual(self.reader.snapshot(now=2001)["count"], 1)
        with file.open("a") as stream:
            stream.write(json.dumps({"type": "response_item", "payload": "x" * (activity.MAX_TAIL + 100)}) + "\n")
        os.utime(file, (2002, 2002))
        self.assertEqual(self.reader.snapshot(now=2003)["count"], 1)
        restarted = activity.Activity(self.home, boot=1000).snapshot(now=2003)
        self.assertEqual((restarted["count"], restarted["uncertain"]), (0, 1))


if __name__ == "__main__":
    unittest.main()
