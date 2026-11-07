"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Processes } = require("../lib/platform");
const { parsePayload } = require("../lib/payload");

test("private Unicode payload reaches a real child only through stdin", async () => {
  const runner = new Processes();
  const input = JSON.stringify({ message: "Private answer: città 日本語", workspace: "/private/project" });
  const script = 'import json,sys; from pathlib import Path; p=json.load(sys.stdin); args=Path("/proc/self/cmdline").read_bytes(); sys.exit(0 if p["message"].endswith("日本語") and p["workspace"].encode() not in args and p["message"].encode() not in args else 1)';
  try { assert.equal(await runner.run("python3", ["-c", script], process.env, 3000, input), true); }
  finally { runner.dispose(); }
});

test("broken stdin resolves as failure and kills the child without an unhandled error", async () => {
  let child;
  const runner = new Processes(() => {
    child = new EventEmitter(); child.stdin = new EventEmitter(); child.stdin.end = () => {};
    child.kill = () => { child.killed = true; child.emit("exit", null, "SIGKILL"); };
    return child;
  });
  const result = runner.run("helper", [], {}, 3000, "private input");
  child.stdin.emit("error", Object.assign(new Error("closed"), { code: "EPIPE" }));
  assert.equal(await result, false); assert.equal(child.killed, true);
  assert.equal(runner.children.size, 0); runner.dispose();
});

test("stdin payload parser rejects invalid JSON and non-object payloads", () => {
  for (const text of ["", "{", "null", "[]", "1", '"answer"']) assert.throws(() => parsePayload(text));
  assert.deepEqual(parsePayload('{"message":"città"}'), { message: "città" });
});
