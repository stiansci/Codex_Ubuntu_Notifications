"""Read the explicitly supported Codex schema without modifying its databases."""

import json
from datetime import datetime
from pathlib import Path
import sqlite3
import sys


class Rollouts:
    """Tail explicit task/final-answer events in workspace-scoped Codex JSONL files."""

    def __init__(self, directory):
        self.directory = Path(directory).resolve()
        self.files = {}
        self.initialized = False

    def poll(self, connection, folders, since, limit=50, baseline=True):
        roots = [Path(p).resolve() for p in folders if isinstance(p, str) and Path(p).is_absolute()]
        if not roots:
            return []
        columns = {r[1] for r in connection.execute("PRAGMA state_db.table_info(threads)")}
        if "rollout_path" not in columns:
            return []
        rows = connection.execute("""SELECT id, cwd, title, rollout_path FROM state_db.threads
            WHERE source='vscode' AND (thread_source IS NULL OR thread_source='user')""")
        turns, active, budget = [], set(), 8 * 1024 * 1024
        for thread, cwd, title, filename in rows:
            if not cwd or not filename or not Path(cwd).is_absolute():
                continue
            workspace = Path(cwd).resolve()
            if not any(workspace == root or workspace.is_relative_to(root) for root in roots):
                continue
            file = Path(filename).resolve()
            if not file.is_relative_to(self.directory):
                continue
            active.add(thread)
            try:
                stat = file.stat()
                identity = (stat.st_dev, stat.st_ino)
                state = self.files.get(thread)
                if state is None or state["identity"] != identity or stat.st_size < state["offset"]:
                    state = {"identity": identity, "offset": stat.st_size if not self.initialized and baseline else 0,
                             "turn": None, "skipping": False}
                    self.files[thread] = state
                if len(turns) >= limit or budget <= 0:
                    continue
                with file.open("rb") as stream:
                    stream.seek(state["offset"])
                    while len(turns) < limit and budget > 0:
                        line = stream.readline(min(1024 * 1024 + 1, budget))
                        if not line:
                            break
                        budget -= len(line)
                        complete = line.endswith(b"\n")
                        if not complete and not state["skipping"] and len(line) <= 1024 * 1024:
                            # Preserve incomplete JSON until the producer appends its newline.
                            break
                        state["offset"] = stream.tell()
                        if state["skipping"] or len(line) > 1024 * 1024:
                            state["skipping"] = not complete
                            continue
                        try:
                            record = json.loads(line)
                            if record.get("type") != "event_msg":
                                continue
                            payload = record.get("payload", {})
                            kind = payload.get("type")
                            if kind == "task_started":
                                state["turn"] = payload.get("turn_id")
                                continue
                            if kind in ("turn_aborted", "task_aborted", "task_failed"):
                                state["turn"] = None
                                continue
                            if kind == "task_complete":
                                turn = payload.get("turn_id")
                                message = payload.get("last_agent_message", "")
                            elif kind == "agent_message" and payload.get("phase") in ("final", "final_answer"):
                                turn, message = state["turn"], payload.get("message", "")
                            else:
                                continue
                            timestamp = datetime.fromisoformat(record["timestamp"].replace("Z", "+00:00")).timestamp()
                            if not isinstance(turn, str) or timestamp < since:
                                continue
                            turns.append({"threadId": thread, "turnId": turn, "completedAt": timestamp,
                                          "cwd": cwd[:4096], "title": str(title or "")[:200],
                                          "message": message[:4000] if isinstance(message, str) else ""})
                        except (ValueError, TypeError, KeyError, AttributeError):
                            continue
            except OSError:
                # SQLite monitoring stays available if a rollout is rotated or unreadable.
                continue
        self.files = {thread: state for thread, state in self.files.items() if thread in active}
        self.initialized = True
        return turns


class Reader:
    def __init__(self, directory):
        self.paths = [Path(directory) / n for n in ("thread_history_1.sqlite", "state_5.sqlite")]
        self.connection = None
        self.identities = None
        self.rollouts = Rollouts(directory)

    def close(self):
        if self.connection is not None:
            self.connection.close()
        self.connection = None
        self.identities = None

    def connect(self):
        identities = [(p.stat().st_dev, p.stat().st_ino) for p in self.paths]
        if self.connection is not None and identities == self.identities:
            return self.connection
        self.close()
        c = sqlite3.connect(self.paths[0].resolve().as_uri() + "?mode=ro", uri=True, timeout=0.4)
        try:
            c.execute("ATTACH DATABASE ? AS state_db", (self.paths[1].resolve().as_uri() + "?mode=ro",))
            c.execute("PRAGMA query_only = ON")
            expected = {
                ("main", "thread_turns"): {"thread_id", "turn_id", "completed_at", "status"},
                ("main", "thread_items"): {"thread_id", "turn_id", "item_type", "rollout_ordinal", "item_json"},
                ("state_db", "threads"): {"id", "cwd", "title", "source", "thread_source"},
            }
            for (schema, table), required in expected.items():
                columns = {row[1] for row in c.execute(f"PRAGMA {schema}.table_info({table})")}
                if not required <= columns:
                    raise ValueError("incompatible")
            self.connection, self.identities = c, identities
            return c
        except Exception:
            c.close()
            raise

    def query(self, request):
        try:
            c = self.connect()
            # Each poll scans completions since activation, with pagination. This
            # deliberately avoids a timestamp watermark that can lose late commits.
            after = request.get("after", [request["since"], "", ""])
            rows = c.execute("""
                SELECT t.thread_id, t.turn_id, t.completed_at, s.cwd, s.title,
                  (SELECT substr(ti.item_json, 1, 65536) FROM thread_items ti
                   WHERE ti.thread_id=t.thread_id AND ti.turn_id=t.turn_id
                     AND ti.item_type='agentMessage'
                   ORDER BY ti.rollout_ordinal DESC LIMIT 1)
                FROM thread_turns t JOIN state_db.threads s ON s.id=t.thread_id
                WHERE t.status='completed' AND t.completed_at IS NOT NULL
                  AND t.completed_at >= ? AND s.source='vscode'
                  AND (s.thread_source IS NULL OR s.thread_source='user')
                  AND (t.completed_at, t.thread_id, t.turn_id) > (?, ?, ?)
                ORDER BY t.completed_at, t.thread_id, t.turn_id LIMIT 51
            """, (request["since"], *after)).fetchall()
            turns = []
            for thread_id, turn_id, completed, cwd, title, item in rows[:50]:
                message = ""
                try:
                    obj = json.loads(item or "{}")
                    if isinstance(obj, dict) and isinstance(obj.get("text"), str):
                        message = obj["text"][:4000]
                except (ValueError, TypeError):
                    pass
                turns.append({"threadId": thread_id, "turnId": turn_id, "completedAt": completed,
                              "cwd": str(cwd or "")[:4096], "title": str(title or "")[:200], "message": message})
            next_page = None
            if len(rows) > 50:
                row = rows[49]
                next_page = [row[2], row[0], row[1]]
            turns.extend(self.rollouts.poll(c, request.get("folders", []), request["since"], baseline=request.get("baseline", True)))
            return {"status": "ready", "turns": turns, "next": next_page}
        except FileNotFoundError:
            status = "missing"
        except PermissionError:
            status = "unreadable"
        except ValueError:
            status = "incompatible"
        except sqlite3.Error as error:
            code = getattr(error, "sqlite_errorcode", 0) & 255
            # Python 3.10 (Ubuntu 22.04) does not expose SQLite error constants
            # or sqlite_errorcode; use SQLite's fixed lock messages there.
            busy = code in (5, 6) or str(error).lower() in ("database is locked", "database table is locked", "database schema is locked")
            status = "busy" if busy else "unreadable"
        self.close()
        return {"status": status, "turns": [], "next": None}


def main():
    reader = Reader(sys.argv[1])
    try:
        for line in sys.stdin:
            try:
                if len(line) > 8192:
                    raise ValueError("request too large")
                result = reader.query(json.loads(line))
            except (ValueError, TypeError, KeyError):
                result = {"status": "protocol-error", "turns": [], "next": None}
            print(json.dumps(result, ensure_ascii=True), flush=True)
    finally:
        reader.close()


if __name__ == "__main__":
    main()
