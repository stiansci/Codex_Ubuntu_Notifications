"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Monitor } = require("../lib/monitor");
const os = require("node:os");
function setup(t) {
  const children = [], received = [], statuses = [], writes = [];
  const spawn = () => {
    const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.stdin = new EventEmitter();
    p.stdin.writable = true; p.stdin.write = text => writes.push(JSON.parse(text)); p.stdin.destroy = () => { p.stdin.writable = false; };
    p.kill = () => { p.killed = true; p.emit("exit", null); }; children.push(p); return p;
  };
  const monitor = new Monitor({ python: "fake", script: "fake", home: "/not-a-real-codex-home", env: {}, spawn, since: 100,
    onTurns: turns => received.push(...turns), onStatus: s => statuses.push(s) });
  t.after(() => monitor.dispose()); monitor.poll();
  const reply = (turns, status = "ready") => children.at(-1).stdout.emit("data", Buffer.from(JSON.stringify({ status, turns, next: null }) + "\n"));
  return { monitor, children, received, statuses, writes, reply };
}
const turn = (thread, id, completed = 100) => ({ threadId: thread, turnId: id, completedAt: completed, cwd: "/tmp", message: "test" });
test("no replay at startup; same-second completions and thread/turn pairs are distinct", t => {
  const s = setup(t); s.reply([turn("t", "historical")]); assert.equal(s.received.length, 0);
  s.monitor.poll(); s.reply([turn("t", "historical"), turn("t", "new"), turn("other", "new")]);
  assert.equal(s.received.length, 2);
  s.monitor.poll(); s.reply([turn("t", "new")]); assert.equal(s.received.length, 2);
  assert.deepEqual(s.writes[0], { since: 100, folders: [], baseline: true });
});
test("only one query in flight; reader restart retains deduplication", t => {
  const s = setup(t); s.monitor.poll(); assert.equal(s.writes.length, 1);
  s.reply([]); s.monitor.poll(); s.reply([turn("t", "a")]);
  s.children[0].emit("error", new Error("synthetic failure"));
  assert.ok(s.statuses.includes("reader-unavailable"));
  s.monitor.nextStart = 0; s.monitor.poll(); assert.equal(s.children.length, 2);
  s.reply([turn("t", "a"), turn("t", "b")]); assert.equal(s.received.length, 2);
  s.monitor.dispose(); assert.equal(s.children[1].killed, true); assert.equal(s.monitor.timers.size, 0);
});
test("oversized responses, pipe errors and asynchronous spawn errors recover", t => {
  const s = setup(t); s.children[0].stdout.emit("data", Buffer.alloc(4 * 1024 * 1024 + 1, 65));
  assert.ok(s.statuses.includes("reader-protocol-error")); assert.equal(s.children[0].killed, true);
  s.monitor.nextStart = 0; s.monitor.poll(); s.children[1].stdin.emit("error", new Error());
  assert.ok(s.statuses.includes("reader-pipe-error"));
  s.monitor.nextStart = 0; s.monitor.poll(); s.children[2].emit("error", new Error());
  assert.ok(s.statuses.includes("reader-unavailable"));
});
test("watcher failure closes the watcher and retains periodic-query behavior", t => {
  const s = setup(t); s.reply([]);
  const watcher = new EventEmitter(); watcher.close = () => { watcher.closed = true; };
  s.monitor.home = os.tmpdir(); s.monitor.watch = () => watcher; s.monitor.attachWatcher();
  watcher.emit("error", new Error("synthetic watch failure"));
  assert.equal(watcher.closed, true); assert.equal(s.monitor.watcher, null);
  assert.ok(s.statuses.includes("watcher-unavailable"));
  s.monitor.poll(); assert.equal(s.writes.length, 2);
});
test("initial reader readiness waits for a reply and EMFILE watcher retries back off", async t => {
  const s = setup(t);
  let ready = false; s.monitor.ready.then(() => { ready = true; }); await Promise.resolve();
  assert.equal(ready, false);
  let attempts = 0;
  s.monitor.home = os.tmpdir(); s.monitor.watch = () => { attempts++; throw Object.assign(new Error("private path"), { code: "EMFILE" }); };
  s.monitor.attachWatcher(); s.monitor.attachWatcher(); assert.equal(attempts, 1);
  assert.ok(s.statuses.includes("watcher-unavailable"));
  s.reply([]); await s.monitor.ready; assert.equal(ready, true);
  s.monitor.poll(); assert.equal(s.writes.length, 2);
});
