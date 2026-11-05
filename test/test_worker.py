"""Exercise the real reader against synthetic SQLite fixtures only."""
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("worker", Path(__file__).resolve().parents[1] / "lib" / "worker.py")
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


def databases(folder):
    with sqlite3.connect(folder / "thread_history_1.sqlite") as c:
        c.executescript("""
            CREATE TABLE thread_turns(thread_id TEXT, turn_id TEXT, completed_at INTEGER, status TEXT);
            CREATE TABLE thread_items(thread_id TEXT, turn_id TEXT, item_type TEXT, rollout_ordinal INTEGER, item_json TEXT);
        """)
    with sqlite3.connect(folder / "state_5.sqlite") as c:
        c.execute("CREATE TABLE threads(id TEXT, cwd TEXT, title TEXT, source TEXT, thread_source TEXT)")
        c.execute("INSERT INTO threads VALUES ('t', '/tmp/project', 'synthetic', 'vscode', 'user')")


def add_turn(folder, turn="u", completed=100, text="Synthetic answer"):
    with sqlite3.connect(folder / "thread_history_1.sqlite") as c:
        c.execute("INSERT INTO thread_turns VALUES ('t', ?, ?, 'completed')", (turn, completed))
        c.execute("INSERT INTO thread_items VALUES ('t', ?, 'agentMessage', 1, ?)", (turn, json.dumps({"text": text})))


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="notifier-worker-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def reader(self, folder):
        r = worker.Reader(folder)
        self.addCleanup(r.close)
        return r

    def test_special_paths_read_only_and_real_content(self):
        for name in ("normal", "user's Codex", "codex#home", "codex?home", "città 空間"):
            with self.subTest(name=name):
                folder = self.root / name
                folder.mkdir()
                databases(folder)
                add_turn(folder, text="Unicode è <b>plain text</b>")
                r = self.reader(folder)
                result = r.query({"since": 95})
                self.assertEqual(result["status"], "ready")
                self.assertEqual(result["turns"][0]["message"], "Unicode è <b>plain text</b>")
                with self.assertRaises(sqlite3.OperationalError):
                    r.connection.execute("DELETE FROM thread_turns")
                with self.assertRaises(sqlite3.OperationalError):
                    r.connection.execute("DELETE FROM state_db.threads")

    def test_missing_incompatible_and_corrupt_are_distinct(self):
        r = self.reader(self.root)
        self.assertEqual(r.query({"since": 0})["status"], "missing")
        databases(self.root)
        with sqlite3.connect(self.root / "state_5.sqlite") as c:
            c.execute("DROP TABLE threads")
        self.assertEqual(r.query({"since": 0})["status"], "incompatible")
        (self.root / "thread_history_1.sqlite").write_bytes(b"not sqlite")
        self.assertEqual(r.query({"since": 0})["status"], "unreadable")

    def test_busy_recovers_and_database_replacement_reconnects(self):
        databases(self.root)
        add_turn(self.root)
        r = self.reader(self.root)
        self.assertEqual(r.query({"since": 0})["status"], "ready")
        blocker = sqlite3.connect(self.root / "thread_history_1.sqlite")
        try:
            blocker.execute("BEGIN EXCLUSIVE")
            self.assertEqual(r.query({"since": 0})["status"], "busy")
        finally:
            blocker.rollback()
            blocker.close()
        self.assertEqual(r.query({"since": 0})["status"], "ready")
        replacement = self.root / "replacement"
        replacement.mkdir()
        databases(replacement)
        add_turn(replacement, turn="replacement")
        (replacement / "thread_history_1.sqlite").replace(self.root / "thread_history_1.sqlite")
        self.assertEqual(r.query({"since": 0})["turns"][0]["turnId"], "replacement")

    def test_pagination_same_second_and_late_commits(self):
        databases(self.root)
        for i in range(105):
            add_turn(self.root, turn=f"u{i:03}")
        r = self.reader(self.root)
        first = r.query({"since": 100})
        self.assertEqual(len(first["turns"]), 50)
        second = r.query({"since": 100, "after": first["next"]})
        self.assertEqual(len(second["turns"]), 50)
        third = r.query({"since": 100, "after": second["next"]})
        self.assertEqual(len(third["turns"]), 5)
        self.assertIsNone(third["next"])
        add_turn(self.root, turn="late", completed=100)
        self.assertEqual(r.query({"since": 100})["turns"][0]["turnId"], "late")
        self.assertEqual(r.query({"since": 101})["turns"], [])

    def test_filters_and_oversized_message_are_bounded(self):
        databases(self.root)
        add_turn(self.root, text="x" * 5000)
        r = self.reader(self.root)
        self.assertEqual(len(r.query({"since": 0})["turns"][0]["message"]), 4000)
        with sqlite3.connect(self.root / "state_5.sqlite") as c:
            c.execute("UPDATE threads SET thread_source='subagent'")
        self.assertEqual(r.query({"since": 0})["turns"], [])

    def test_rollout_detects_final_answers_when_history_has_no_user_turns(self):
        databases(self.root)
        rollout = self.root / "session.jsonl"
        rollout.write_text(json.dumps({"type": "event_msg", "timestamp": "2026-11-05T10:00:00Z",
            "payload": {"type": "task_complete", "turn_id": "old", "last_agent_message": "old"}}) + "\n")
        with sqlite3.connect(self.root / "state_5.sqlite") as c:
            c.execute("ALTER TABLE threads ADD COLUMN rollout_path TEXT")
            c.execute("UPDATE threads SET rollout_path=?", (str(rollout),))
        reader = self.reader(self.root)
        request = {"since": 0, "folders": ["/tmp/project"]}
        self.assertEqual(reader.query(request)["turns"], [])
        records = [
            {"type": "task_started", "turn_id": "new"},
            {"type": "agent_message", "phase": "commentary", "message": "still working"},
            {"type": "agent_message", "phase": "final_answer", "message": "Risposta finale è pronta"},
            {"type": "task_complete", "turn_id": "new", "last_agent_message": "Risposta finale è pronta"},
        ]
        with rollout.open("a") as f:
            for payload in records:
                f.write(json.dumps({"type": "event_msg", "timestamp": "2026-11-05T11:00:00Z", "payload": payload}) + "\n")
        turns = reader.query(request)["turns"]
        self.assertEqual([t["turnId"] for t in turns], ["new", "new"])
        self.assertTrue(all(t["message"] == "Risposta finale è pronta" for t in turns))
        self.assertEqual(reader.query(request)["turns"], [])
        restarted = self.reader(self.root)
        request["baseline"] = False
        self.assertEqual([t["turnId"] for t in restarted.query(request)["turns"]], ["old", "new", "new"])

    def test_rollout_preserves_partial_lines_filters_workspace_and_excludes_subagents(self):
        databases(self.root)
        rollout = self.root / "session.jsonl"
        rollout.write_bytes(b"")
        with sqlite3.connect(self.root / "state_5.sqlite") as c:
            c.execute("ALTER TABLE threads ADD COLUMN rollout_path TEXT")
            c.execute("UPDATE threads SET rollout_path=?", (str(rollout),))
        reader = self.reader(self.root)
        request = {"since": 0, "folders": ["/tmp/other"]}
        self.assertEqual(reader.query(request)["turns"], [])
        event = json.dumps({"type": "event_msg", "timestamp": "2026-11-05T11:00:00Z",
                            "payload": {"type": "task_complete", "turn_id": "u", "last_agent_message": "done"}})
        rollout.write_text(event[:30])
        request["folders"] = ["/tmp/project"]
        self.assertEqual(reader.query(request)["turns"], [])
        with rollout.open("a") as f:
            f.write(event[30:] + "\n")
        self.assertEqual(reader.query(request)["turns"][0]["turnId"], "u")
        with sqlite3.connect(self.root / "state_5.sqlite") as c:
            c.execute("UPDATE threads SET thread_source='subagent'")
        with rollout.open("a") as f:
            f.write(event + "\n")
        self.assertEqual(reader.query(request)["turns"], [])


if __name__ == "__main__":
    unittest.main()
