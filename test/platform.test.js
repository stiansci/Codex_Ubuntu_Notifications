"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Desktop, Processes, hostEnv } = require("../lib/platform");
const core = require("../lib/core");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const extensionPath = path.resolve(__dirname, "..");
test("each preview resolves the latest theme and preserves Markdown payload", async () => {
  const { appearance } = require("../lib/theme");
  let kind = 1;
  const payloads = [];
  const desktop = new Desktop({ extensionPath, soundDir: "/nonexistent", getAppearance: () => appearance(kind),
    processes: { children: new Set(), run: async (_binary, args) => { payloads.push(JSON.parse(args[1])); return true; }, dispose() {} } });
  desktop.capabilities = { preview: true, gjs: "gjs" };
  await desktop.preview({ label: "demo", path: "/tmp" }, "done", '**Done**\n- `code`', 7);
  kind = 2;
  await desktop.preview({ label: "demo", path: "/tmp" }, "done", "test", 7);
  assert.equal(payloads[0].message, '**Done**\n- `code`');
  assert.match(payloads[0].themeCss, /#ffffff/);
  assert.match(payloads[1].themeCss, /#252526/);
});
test("host environment is unchanged outside Snap and selectively cleaned inside Snap", () => {
  const env = { PATH: "/usr/bin", DISPLAY: ":0", DBUS_SESSION_BUS_ADDRESS: "unix:test", LD_LIBRARY_PATH: "/custom", GTK_THEME: "custom", XDG_DATA_DIRS: "/custom/share" };
  assert.deepEqual(hostEnv(env), env);
  const cleaned = hostEnv({ ...env, SNAP: "/snap/code", XDG_DATA_DIRS_VSCODE_SNAP_ORIG: "/original" });
  assert.equal(cleaned.DISPLAY, ":0"); assert.equal(cleaned.DBUS_SESSION_BUS_ADDRESS, "unix:test");
  assert.equal(cleaned.LD_LIBRARY_PATH, undefined); assert.equal(cleaned.XDG_DATA_DIRS, "/original");
});
test("missing binaries and failed probes degrade without launching desktop tools", async () => {
  const desktop = new Desktop({ extensionPath, soundDir: "/nonexistent", env: {}, find: () => null });
  await desktop.check(); assert.equal(desktop.capabilities.python, null);
  const toasts = [];
  await desktop.notify({ ...core.DEFAULTS }, { label: "Project", path: "/tmp" }, "", "<b>reply</b>", t => toasts.push(t));
  assert.equal(toasts.length, 1); assert.ok(desktop.details(core.DEFAULTS).some(t => t.includes("libnotify-bin")));
  desktop.dispose();
});
test("audio falls back in order, clamps volume and limits ALSA to WAV", async () => {
  const calls = [];
  const processes = { children: new Set(), run: async (binary, args) => { calls.push([binary, args]); return binary === "alsa"; }, dispose() {} };
  const desktop = new Desktop({ extensionPath, soundDir: "/nonexistent", processes });
  desktop.capabilities = { "pw-play": "pw", paplay: "pa", aplay: "alsa" };
  assert.equal(await desktop.sound("synth-1", 999), true);
  assert.deepEqual(calls.map(c => c[0]), ["pw", "pa", "alsa"]);
  assert.equal(calls[0][1][0], "--volume=1.00"); assert.equal(calls[1][1][0], "--volume=65536");
});
test("native content is escaped and command arguments terminate options", async () => {
  let args;
  const desktop = new Desktop({ extensionPath, soundDir: "/nonexistent", processes: { children: new Set(), run: async (_b, a) => { args = a; return true; }, dispose() {} } });
  desktop.capabilities = { "notify-send": "notify" };
  assert.equal(await desktop.native({ label: "test" }, "", "<b>secret</b>"), true);
  assert.equal(args.at(-1), "&lt;b&gt;secret&lt;/b&gt;"); assert.ok(args.includes("--"));
});
test("process error events resolve false and disposal kills tracked children", async () => {
  let child;
  const runner = new Processes(() => { child = new EventEmitter(); child.kill = () => { child.killed = true; child.emit("exit", null, "SIGKILL"); }; return child; });
  const p = runner.run("missing", [], {}); child.emit("error", Object.assign(new Error(), { code: "ENOENT" }));
  assert.equal(await p, false);
  const q = runner.run("long", [], {}); runner.dispose(); assert.equal(child.killed, true); assert.equal(await q, false);
  assert.equal(await runner.run("anything", [], {}), false);
});
test("failed service probes do not report available Python or preview", async () => {
  const desktop = new Desktop({ extensionPath, soundDir: "/nonexistent", env: { DISPLAY: ":0" }, find: name => name,
    processes: { children: new Set(), run: async () => false, dispose() {} } });
  await desktop.check(); assert.equal(desktop.capabilities.python, null); assert.equal(desktop.capabilities.preview, false);
});
test("unsupported compressed audio never reaches the WAV-only ALSA fallback", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "notifier-codec-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true })); fs.writeFileSync(path.join(dir, "custom.ogg"), "synthetic");
  const calls = [];
  const desktop = new Desktop({ extensionPath, soundDir: dir, processes: { children: new Set(),
    run: async name => { calls.push(name); return false; }, dispose() {} } });
  desktop.capabilities = { "pw-play": "pw", paplay: "pa", aplay: "alsa" };
  assert.equal(await desktop.sound("custom:custom.ogg", 55), false);
  assert.deepEqual(calls, ["pw", "pa"]); assert.equal(desktop.issues.has("audio"), true);
});
test("early preview failure tries native notification before the in-editor fallback", async () => {
  const calls = [], toasts = [];
  const desktop = new Desktop({ extensionPath, soundDir: "/nonexistent", processes: { children: new Set(), run: async name => { calls.push(name); return false; }, dispose() {} } });
  desktop.capabilities = { preview: true, gjs: "gjs", "notify-send": "notify" };
  await desktop.notify({ ...core.DEFAULTS, desktopNotification: false, sound: false }, { label: "test", path: "/tmp" }, "", "test", s => toasts.push(s));
  assert.deepEqual(calls, ["gjs", "notify"]); assert.equal(toasts.length, 1);
});
