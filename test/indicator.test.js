"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Indicator } = require("../lib/indicator");

test("indicator respects disablement, owns its child and passes paths without shell parsing", () => {
  const calls = [], children = [];
  const indicator = new Indicator({ extensionPath: "/tmp/extension path", env: { DISPLAY: ":0" },
    spawn: (...args) => {
      calls.push(args);
      const child = new EventEmitter(); child.kill = signal => { child.signal = signal; };
      children.push(child); return child;
    } });
  try {
    const options = { enabled: false, home: "/tmp/Codex user's home", gjs: "/usr/bin/gjs", python: "/usr/bin/python3" };
    indicator.start(options);
    assert.equal(calls.length, 0);
    indicator.start({ ...options, enabled: true, flash: false });
    assert.equal(calls.length, 1);
    assert.equal(JSON.parse(calls[0][1][1]).home, options.home);
    assert.equal(JSON.parse(calls[0][1][1]).flash, false);
    assert.equal(calls[0][2].shell, undefined);
    indicator.dispose();
    assert.equal(children[0].signal, "SIGTERM");
  } finally { indicator.dispose(); }
});
