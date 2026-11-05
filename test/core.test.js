"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const core = require("../lib/core");

function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "notifier-test-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
test("settings reject script payloads, invalid keys, non-finite values and prototype keys", () => {
  for (const key of ["__proto__", "constructor", "unknown"]) assert.equal(core.validSetting(key, true), false);
  for (const value of [NaN, Infinity, -1, 101, "55"]) assert.equal(core.validSetting("volume", value), false);
  assert.equal(core.validSetting("soundChoice", "</script><script>alert(1)</script>"), false);
  assert.equal(core.validSetting("soundChoice", "custom:../bad.wav"), false);
  assert.equal(core.validSetting("soundChoice", "custom:good.wav"), true);
  assert.equal(core.validSetting("codexHome", "relative/path"), false);
  assert.equal(core.validSetting("codexHome", "/tmp/codex #? user's home"), true);
  assert.equal(core.readSettings({ get: () => "<bad>" }).volume, 55);
});
test("most specific canonical workspace wins; ancestors and empty cwd do not match", t => {
  const dir = temp(t), child = path.join(dir, "child"); fs.mkdirSync(child);
  const link = path.join(dir, "link"); fs.symlinkSync(child, link);
  const folders = [{ name: "root", uri: { scheme: "file", fsPath: dir } }, { name: "nested", uri: { scheme: "file", fsPath: child } }];
  assert.equal(core.matchingFolder(link, folders).label, "nested");
  assert.equal(core.matchingFolder(dir + "-other", folders), null);
  assert.equal(core.matchingFolder(path.dirname(dir), folders), null);
  assert.equal(core.matchingFolder("", folders), null);
  assert.equal(core.matchingFolder(dir, []), null);
});
test("custom sounds enforce limits, regular files and unique destinations", t => {
  const dir = temp(t), sounds = path.join(dir, "sounds"), src = path.join(dir, "a.wav");
  fs.writeFileSync(src, "sound");
  const a = core.importSound(src, sounds), b = core.importSound(src, sounds);
  assert.notEqual(a, b); assert.equal(core.listSounds(sounds).length, 2);
  assert.equal(fs.readFileSync(core.soundFile(sounds, a), "utf8"), "sound");
  const link = path.join(sounds, "evil.wav"); fs.symlinkSync(src, link);
  assert.equal(core.soundFile(sounds, "evil.wav"), null);
  assert.throws(() => core.deleteSound(sounds, "evil.wav"));
  assert.throws(() => core.importSound(link, sounds));
  assert.throws(() => core.deleteSound(sounds, "../a.wav"));
  const fd = fs.openSync(src, "w"); fs.ftruncateSync(fd, core.MAX_SOUND_BYTES + 1); fs.closeSync(fd);
  assert.throws(() => core.importSound(src, sounds));
  core.deleteSound(sounds, a); assert.equal(core.soundFile(sounds, a), null);
});
test("claims are shared across windows, keyed by home/thread/turn and expire safely", t => {
  const dir = temp(t), root = path.join(dir, "claims");
  const a = new core.Claims(dir, root), b = new core.Claims(dir, root);
  assert.equal(a.claim("thread", "turn"), true); assert.equal(b.claim("thread", "turn"), false);
  assert.equal(b.claim("another-thread", "turn"), true);
  assert.equal(new core.Claims(path.join(dir, "other-home"), root).claim("thread", "turn"), true);
  assert.equal(core.eligible({ enabled: false, mode: "always" }, false), false);
  assert.equal(core.eligible({ enabled: true, mode: "unfocused" }, true), false);
  assert.equal(core.eligible({ enabled: true, mode: "unfocused" }, false), true);
  a.cleanup(Date.now() + 8 * 86400000); assert.equal(fs.readdirSync(root).length, 0);
  const target = path.join(dir, "target"); fs.mkdirSync(target); fs.symlinkSync(target, path.join(dir, "bad-root"));
  assert.throws(() => new core.Claims(dir, path.join(dir, "bad-root")).claim("t", "u"));
});
test("Codex home precedence and markup escaping", () => {
  assert.equal(core.codexHome({ codexHome: "/tmp/explicit" }, { CODEX_HOME: "/tmp/env" }), "/tmp/explicit");
  assert.equal(core.codexHome({ codexHome: "" }, { CODEX_HOME: "/tmp/env" }), "/tmp/env");
  assert.equal(core.escapeMarkup('<b>&test</b>'), '&lt;b&gt;&amp;test&lt;/b&gt;');
  assert.equal(core.plain("hello\u0000\nworld"), "hello world");
});
