"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Desktop, Processes, hostEnv, executable } = require("../lib/platform");
const core = require("../lib/core");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const extensionPath = path.resolve(__dirname, "..");
test("Snap launcher is found even when the extension PATH omits /snap/bin", () => {
  const access = fs.accessSync, stat = fs.statSync;
  try {
    fs.accessSync = candidate => { if (candidate !== "/snap/bin/code") throw new Error("missing"); };
    fs.statSync = () => ({ isFile: () => true });
    assert.equal(executable("code", { PATH: "/usr/bin:/bin" }), "/snap/bin/code");
  } finally { fs.accessSync = access; fs.statSync = stat; }
});
test("each preview resolves the latest theme and preserves Markdown payload", async () => {
  const { appearance } = require("../lib/theme");
  let kind = 1;
  const payloads = [];
  const desktop = new Desktop({ extensionPath, soundDir: "/nonexistent", getAppearance: () => appearance(kind),
    processes: { children: new Set(), run: async (_binary, args, _env, _timeout, input) => {
      assert.deepEqual(args, [path.join(extensionPath, "preview-overlay.js"), "--stdin"]);
      payloads.push(JSON.parse(input)); return true;
    }, dispose() {} } });
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
  assert.equal(toasts.length, 1); assert.ok(desktop.details({ ...core.DEFAULTS, desktopNotification: true }).some(t => t.includes("libnotify-bin")));
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
test("native content is escaped and travels through stdin rather than process arguments", async () => {
  let args, payload;
  const desktop = new Desktop({ extensionPath, soundDir: "/nonexistent", processes: { children: new Set(),
    run: async (_b, a, _env, _timeout, input) => { args = a; payload = JSON.parse(input); return true; }, dispose() {} } });
  desktop.capabilities = { "notify-send": "notify", python: "python3" };
  assert.equal(await desktop.native({ label: "Private project" }, "", "<b>secret</b>"), true);
  assert.equal(payload.body, "&lt;b&gt;secret&lt;/b&gt;");
  assert.equal(payload.summary, "Codex (Private project)");
  assert.deepEqual(args, [path.join(extensionPath, "lib", "native_notification.py")]);
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
test("display-independent library checks avoid package setup for a display-session failure", async () => {
  const calls = [];
  const desktop = new Desktop({ extensionPath, soundDir: "/nonexistent", env: {}, find: name => name,
    processes: { children: new Set(), run: async (_binary, args) => { calls.push(args); return true; }, dispose() {} } });
  await desktop.check();
  assert.equal(desktop.capabilities.gtk, true); assert.equal(desktop.capabilities.appIndicator, true);
  assert.equal(desktop.capabilities.preview, false);
  assert.ok(calls.some(args => args[1].includes("AyatanaAppIndicator3")));
  assert.ok(calls.every(args => !args.some(arg => arg.includes("Gtk.init"))));
  desktop.dispose();
});
test("missing playback tools probe the user's active audio service without starting services", async () => {
  const calls = [];
  const desktop = new Desktop({ extensionPath, soundDir: "/nonexistent", env: { XDG_RUNTIME_DIR: "/nonexistent" },
    find: name => name === "systemctl" ? "/usr/bin/systemctl" : null,
    processes: { children: new Set(), run: async (_binary, args) => { calls.push(args); return args.at(-1) === "pulseaudio.service"; }, dispose() {} } });
  await desktop.check();
  assert.equal(desktop.capabilities.audioServer, "pulseaudio");
  assert.deepEqual(calls, [["--user", "is-active", "--quiet", "pipewire.service"], ["--user", "is-active", "--quiet", "pulseaudio.service"]]);
  desktop.dispose();
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
test("preview failure respects disabled Ubuntu notifications and uses the in-editor fallback", async () => {
  const calls = [], toasts = [];
  const desktop = new Desktop({ extensionPath, soundDir: "/nonexistent", processes: { children: new Set(), run: async name => { calls.push(name); return false; }, dispose() {} } });
  desktop.capabilities = { preview: true, gjs: "gjs", "notify-send": "notify" };
  await desktop.notify({ ...core.DEFAULTS, desktopNotification: false, sound: false }, { label: "test", path: "/tmp" }, "", "test", s => toasts.push(s));
  assert.deepEqual(calls, ["gjs"]); assert.equal(toasts.length, 1);
});
test("bottom-left preview is the default and Ubuntu notifications require opting in", async () => {
  assert.equal(core.DEFAULTS.desktopNotification, false);
  assert.equal(core.DEFAULTS.previewCard, true);
  const manifest = require("../package.json").contributes.configuration.properties;
  assert.equal(manifest["codexNotifier.desktopNotification"].default, false);
  for (const available of [true, false]) {
    for (const optedIn of [false, true]) {
      const calls = [], toasts = [];
      const desktop = new Desktop({ extensionPath, soundDir: "/nonexistent", processes: { children: new Set(),
        run: async name => { calls.push(name); return true; }, dispose() {} } });
      desktop.capabilities = { preview: available, gjs: "gjs", "notify-send": "notify", python: "python3" };
      await desktop.notify({ ...core.DEFAULTS, desktopNotification: optedIn, sound: false },
        { label: "test", path: "/tmp" }, "", "test", text => toasts.push(text));
      assert.equal(calls.includes("python3"), optedIn);
      assert.equal(calls.includes("gjs"), available);
      assert.equal(toasts.length, !available && !optedIn ? 1 : 0);
      desktop.dispose();
    }
  }
});


test("PDF actions resolve existing local links, preserve spaces and reject other schemes", t => {
  const { pdfTargets } = require("../lib/platform");
  const { pathToFileURL } = require("node:url");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "notifier-pdf-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "report (final).PDF");
  fs.writeFileSync(file, "%PDF-1.4");
  const uri = pathToFileURL(file).href;
  assert.deepEqual(pdfTargets('[report](<report (final).PDF>)', dir), [{ uri, name: "report (final).PDF" }]);
  assert.deepEqual(pdfTargets('`report (final).PDF`', dir), [{ uri, name: "report (final).PDF" }]);
  assert.equal(pdfTargets(`[one](${uri}) [two](${uri})`, dir).length, 1);
  assert.deepEqual(pdfTargets('[missing](missing.pdf) [bad](javascript:report.pdf) [other](report.txt)', dir), []);
  assert.deepEqual(pdfTargets('```\n[example](https://example.com/example.pdf)\n```', dir), []);
  assert.equal(pdfTargets('[remote](https://example.com/report.pdf?download=1)', dir)[0].uri,
    "https://example.com/report.pdf?download=1");
});

test("PDF actions survive preview truncation and answers without PDFs have no actions", async () => {
  let payload;
  const desktop = new Desktop({ extensionPath, soundDir: "/nonexistent",
    processes: { children: new Set(), run: async (_binary, _args, _env, _timeout, input) => { payload = JSON.parse(input); return true; }, dispose() {} } });
  desktop.capabilities = { preview: true, gjs: "gjs" };
  await desktop.preview({ label: "demo", path: "/tmp" }, "done", "x".repeat(4100) + " [PDF](https://example.com/report.pdf)", 7);
  assert.equal(payload.message.length, 4000);
  assert.equal(payload.pdfs[0].uri, "https://example.com/report.pdf");
  await desktop.preview({ label: "demo", path: "/tmp" }, "done", "No document", 7);
  assert.deepEqual(payload.pdfs, []);
});
