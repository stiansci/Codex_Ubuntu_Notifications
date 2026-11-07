"""Read local VS Code chat lifecycle events for the shared desktop indicator."""

from datetime import datetime
import json
from pathlib import Path
import sqlite3
import sys
import time

MAX_TAIL = 2 * 1024 * 1024
QUIET_SECONDS = 15 * 60
TERMINAL = {"task_complete", "turn_aborted", "task_aborted", "task_failed"}


class Activity:
    """Count user chats, excluding old boot sessions and flagging quiet work as uncertain."""

    def __init__(self, home, boot=None):
        self.home = Path(home).resolve()
        self.cache = {}
        if boot is None:
            try:
                boot = time.time() - float(Path("/proc/uptime").read_text().split()[0])
            except (OSError, ValueError):
                boot = 0
        self.boot = boot

    def lifecycle(self, file):
        stat = file.stat()
        key = (stat.st_ino, stat.st_size, stat.st_mtime_ns)
        cached = self.cache.get(file)
        if cached and cached[0] == key:
            return cached[1], stat.st_mtime
        state = None
        with file.open("rb") as stream:
            offset = max(0, stat.st_size - MAX_TAIL)
            stream.seek(offset)
            if offset:
                stream.readline()
            for line in stream:
                if not line.endswith(b"\n"):
                    break
                try:
                    record = json.loads(line)
                    payload = record.get("payload", {})
                    if record.get("type") != "event_msg":
                        continue
                    kind = payload.get("type")
                    if kind == "task_started" or kind in TERMINAL:
                        timestamp = datetime.fromisoformat(record["timestamp"].replace("Z", "+00:00")).timestamp()
                        state = (kind, timestamp)
                    elif kind == "agent_message" and payload.get("phase") in ("final", "final_answer"):
                        state = ("task_complete", 0)
                except (ValueError, TypeError, KeyError, AttributeError):
                    continue
        # A long tool response may push the start outside the bounded tail.
        if state is None and cached:
            state = cached[1]
        self.cache[file] = (key, state)
        return state, stat.st_mtime

    def snapshot(self, now=None):
        now = time.time() if now is None else now
        working, uncertain, seen = [], 0, set()
        try:
            database = self.home / "state_5.sqlite"
            connection = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=0.3)
            try:
                rows = connection.execute("""SELECT id, cwd, rollout_path FROM threads
                    WHERE source='vscode' AND (thread_source IS NULL OR thread_source='user')
                    AND archived=0""").fetchall()
            finally:
                connection.close()
            for thread, cwd, filename in rows:
                if not filename:
                    continue
                file = Path(filename).resolve()
                if not file.is_relative_to(self.home):
                    continue
                seen.add(file)
                try:
                    # Files untouched since boot cannot represent current work.
                    if file.stat().st_mtime < self.boot:
                        continue
                    state, modified = self.lifecycle(file)
                except OSError:
                    uncertain += 1
                    continue
                if state is None:
                    uncertain += 1
                elif state[0] == "task_started" and state[1] >= self.boot:
                    if now - modified > QUIET_SECONDS:
                        uncertain += 1
                    else:
                        working.append({"id": thread, "cwd": str(cwd or "")[:4096]})
            self.cache = {file: value for file, value in self.cache.items() if file in seen}
            return {"status": "ready", "count": len(working), "uncertain": uncertain, "chats": working[:100]}
        except (OSError, sqlite3.Error, ValueError):
            return {"status": "unavailable", "count": 0, "uncertain": 0, "chats": []}


def main():
    activity = Activity(sys.argv[1])
    while True:
        print(json.dumps(activity.snapshot(), ensure_ascii=True), flush=True)
        if "--once" in sys.argv[2:]:
            return
        time.sleep(2)


if __name__ == "__main__":
    main()
