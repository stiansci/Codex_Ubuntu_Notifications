"""Check chat counts using synthetic sessions, never the user's chat contents."""

import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

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
        self.record(file, "event_msg", {"type": kind, **extra}, timestamp)

    def record(self, file, record_type, payload, timestamp=2000):
        with file.open("a") as stream:
            stream.write(json.dumps({"timestamp": datetime.fromtimestamp(timestamp, timezone.utc).isoformat(),
                                    "type": record_type, "payload": payload}) + "\n")
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
        self.assertEqual((restarted["count"], restarted["uncertain"]), (1, 0))

    def test_continued_work_after_final_answer_is_counted_without_another_start(self):
        for record_type, payload in (
            ("event_msg", {"type": "agent_message", "phase": "commentary"}),
            ("response_item", {"type": "reasoning"}),
            ("response_item", {"type": "function_call"}),
            ("response_item", {"type": "custom_tool_call"}),
        ):
            with self.subTest(payload=payload):
                file = self.chat(f"resumed-{len(list(self.home.glob('*.jsonl')))}")
                self.event(file, "task_started")
                self.event(file, "agent_message", 2001, phase="final_answer")
                self.assertEqual(self.reader.snapshot(now=2002)["count"], 0)
                self.record(file, record_type, payload, 2003)
                for reader in (self.reader, activity.Activity(self.home, boot=1000)):
                    result = reader.snapshot(now=2004)
                    self.assertEqual((result["count"], result["uncertain"]), (1, 0))
                self.event(file, "task_complete", 2005)
                self.assertEqual(self.reader.snapshot(now=2006)["count"], 0)

    def test_trailing_usage_and_outputs_do_not_reopen_finished_or_cancelled_work(self):
        for kind in activity.TERMINAL:
            with self.subTest(kind=kind):
                file = self.chat(kind)
                self.event(file, "task_started")
                self.event(file, kind, 2001)
                self.event(file, "token_count", 2002)
                self.event(file, "item_completed", 2002)
                self.record(file, "response_item", {"type": "function_call_output"}, 2002)
                self.record(file, "response_item", {"type": "custom_tool_call_output"}, 2002)
                self.assertEqual(self.reader.snapshot(now=2003)["count"], 0)

    def test_large_output_cannot_hide_a_completion_from_cached_or_restarted_reader(self):
        file = self.chat("completed")
        self.event(file, "task_started")
        self.assertEqual(self.reader.snapshot(now=2001)["count"], 1)
        self.event(file, "task_complete", 2002)
        self.record(file, "response_item", {"type": "custom_tool_call_output", "output": "x" * (activity.MAX_TAIL * 2 + 100)}, 2003)
        for reader in (self.reader, activity.Activity(self.home, boot=1000)):
            result = reader.snapshot(now=2004)
            self.assertEqual((result["count"], result["uncertain"]), (0, 0))

    def test_work_evidence_can_recover_a_resumed_chat_with_no_start_event(self):
        file = self.chat("resumed")
        self.record(file, "response_item", {"type": "custom_tool_call"})
        self.assertEqual(self.reader.snapshot(now=2001)["count"], 1)
        self.event(file, "turn_aborted", 2002)
        self.assertEqual(self.reader.snapshot(now=2003)["count"], 0)

    def test_records_crossing_chunk_edges_and_partial_final_records(self):
        file = self.chat("boundary")
        self.event(file, "task_started")
        self.record(file, "response_item", {"type": "function_call_output", "output": "x" * 512})
        with patch.object(activity, "MAX_TAIL", 256):
            self.assertEqual(self.reader.snapshot(now=2001)["count"], 1)
            terminal = json.dumps({"timestamp": datetime.fromtimestamp(2002, timezone.utc).isoformat(),
                                   "type": "event_msg", "payload": {"type": "task_complete"}})
            with file.open("a") as stream:
                stream.write(terminal[:60])
            self.assertEqual(self.reader.snapshot(now=2002)["count"], 1)
            with file.open("a") as stream:
                stream.write(terminal[60:] + "\n")
            self.assertEqual(self.reader.snapshot(now=2003)["count"], 0)

    def test_truncated_or_replaced_files_cannot_inherit_cached_work(self):
        file = self.chat("rotated")
        self.event(file, "task_started")
        self.assertEqual(self.reader.snapshot(now=2001)["count"], 1)
        file.write_text("")
        self.event(file, "token_count", 2002)
        result = self.reader.snapshot(now=2003)
        self.assertEqual((result["count"], result["uncertain"]), (0, 1))
        self.event(file, "task_started", 2004)
        self.assertEqual(self.reader.snapshot(now=2005)["count"], 1)
        replacement = self.home / "replacement.jsonl"
        replacement.write_text("")
        self.event(replacement, "token_count", 2006)
        replacement.replace(file)
        result = self.reader.snapshot(now=2007)
        self.assertEqual((result["count"], result["uncertain"]), (0, 1))

    def test_work_evidence_before_boot_remains_excluded_even_if_file_was_touched(self):
        file = self.chat("previous-boot")
        self.record(file, "response_item", {"type": "reasoning"}, 500)
        os.utime(file, (2000, 2000))
        result = self.reader.snapshot(now=2001)
        self.assertEqual((result["count"], result["uncertain"]), (0, 0))


if __name__ == "__main__":
    unittest.main()
