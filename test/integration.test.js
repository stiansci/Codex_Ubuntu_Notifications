"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");
const { Monitor } = require("../lib/monitor");
const create = `
import sqlite3,sys
from pathlib import Path
p=Path(sys.argv[1])
with sqlite3.connect(p/'thread_history_1.sqlite') as c:
 c.executescript("CREATE TABLE thread_turns(thread_id,turn_id,completed_at,status); CREATE TABLE thread_items(thread_id,turn_id,item_type,rollout_ordinal,item_json); INSERT INTO thread_turns VALUES('t','old',100,'completed');")
with sqlite3.connect(p/'state_5.sqlite') as c:
 c.executescript("CREATE TABLE threads(id,cwd,title,source,thread_source); INSERT INTO threads VALUES('t','/tmp/project','synthetic','vscode','user');")
`;
const insert = `
import sqlite3,sys,json
from pathlib import Path
with sqlite3.connect(Path(sys.argv[1])/'thread_history_1.sqlite') as c:
 for turn in sys.argv[2:]:
  c.execute("INSERT INTO thread_turns VALUES('t',?,100,'completed')", (turn,))
  c.execute("INSERT INTO thread_items VALUES('t',?,'agentMessage',1,?)", (turn,json.dumps({'text':'Synthetic Unicode risposta è'})))
`;
function python(script, ...args) {
  const r = cp.spawnSync("python3", ["-c", script, ...args], { encoding: "utf8", timeout: 5000 });
  assert.equal(r.status, 0, r.stderr);
}
function until(condition, timeout = 5000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      if (condition()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error("Synthetic reader timed out"));
      setTimeout(check, 10);
    }
    check();
  });
}
test("real Python reader connects through the monitor, handles Unicode and survives restart", async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "notifier-real-'#?è-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  python(create, home);
  const received = [], statuses = [];
  const monitor = new Monitor({ python: "python3", script: path.resolve(__dirname, "../lib/worker.py"), home,
    env: process.env, since: 100, onTurns: turns => received.push(...turns), onStatus: status => statuses.push(status) });
  t.after(() => monitor.dispose());
  monitor.poll(); await until(() => !monitor.pending && !monitor.baseline);
  assert.equal(received.length, 0);
  python(insert, home, "new-a", "new-b"); monitor.poll(); await until(() => received.length === 2);
  assert.equal(received[0].message, "Synthetic Unicode risposta è");
  const old = monitor.child; old.kill("SIGKILL"); await until(() => !monitor.child);
  monitor.nextStart = 0; monitor.poll(); await until(() => !monitor.pending && monitor.child);
  assert.equal(received.length, 2);
  python(insert, home, "new-c"); monitor.poll(); await until(() => received.length === 3);
  const child = monitor.child; monitor.dispose();
  await until(() => child.exitCode !== null || child.signalCode !== null);
  assert.equal(statuses.includes("ready"), true);
});
test("actual ENOENT spawn is handled without an uncaught child-process error", async t => {
  const statuses = [];
  const monitor = new Monitor({ python: "/nonexistent/notifier-python", script: "unused", home: "/nonexistent",
    env: process.env, onTurns() {}, onStatus: s => statuses.push(s) });
  t.after(() => monitor.dispose()); monitor.poll();
  await until(() => statuses.includes("reader-unavailable"));
  assert.equal(monitor.child, null); assert.equal(monitor.pending, false);
});
test("real polling detects rollout-only user completions with EMFILE and no history rows", async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "notifier-rollout-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  python(create, home);
  const rollout = path.join(home, "session.jsonl"); fs.writeFileSync(rollout, "");
  python("import sqlite3,sys\nfrom pathlib import Path\nwith sqlite3.connect(Path(sys.argv[1])/'state_5.sqlite') as c:\n c.execute('ALTER TABLE threads ADD COLUMN rollout_path TEXT')\n c.execute('UPDATE threads SET rollout_path=?',(str(Path(sys.argv[1])/'session.jsonl'),))", home);
  const received = [], statuses = [];
  const monitor = new Monitor({ python: "python3", script: path.resolve(__dirname, "../lib/worker.py"), home,
    env: process.env, folders: ["/tmp/project"], since: 100,
    watch: () => { throw Object.assign(new Error(), { code: "EMFILE" }); },
    onTurns: turns => received.push(...turns), onStatus: s => statuses.push(s) });
  t.after(() => monitor.dispose()); monitor.start(); await monitor.ready;
  assert.ok(statuses.includes("watcher-unavailable")); assert.equal(statuses.at(-1), "ready");
  const event = payload => JSON.stringify({ type: "event_msg", timestamp: new Date().toISOString(), payload }) + "\n";
  fs.appendFileSync(rollout, event({ type: "task_started", turn_id: "live" }) + event({ type: "agent_message", phase: "final_answer", message: "Live answer" }));
  // Wait for the actual interval, without manually polling or filesystem events.
  await until(() => received.length === 1);
  fs.appendFileSync(rollout, event({ type: "task_complete", turn_id: "live", last_agent_message: "Live answer" }));
  monitor.poll(); await until(() => !monitor.pending);
  assert.equal(received.length, 1); assert.equal(received[0].turnId, "live");
});
