"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const core = require("../lib/core");
const file = path.resolve(__dirname, "../lib/extension.js");
function load({ remote = undefined, folders = [], settings = {}, platform = "linux" } = {}) {
  const writes = [], logs = [], monitors = [], commands = {}, toasts = [];
  const vscode = {
    env: { remoteName: remote }, ConfigurationTarget: { Global: 1 },
    Uri: { joinPath: (_uri, ...parts) => ({ toString: () => parts.join("/") }) },
    workspace: { workspaceFolders: folders, getConfiguration: () => ({ get: (k, fallback) => settings[k] ?? fallback,
      update: async (k, v) => { writes.push([k, v]); settings[k] = v; } }),
      onDidChangeConfiguration: () => ({ dispose() {} }), onDidChangeWorkspaceFolders: () => ({ dispose() {} }) },
    window: { state: { focused: false }, createOutputChannel: () => ({ appendLine: s => logs.push(s), show() {}, dispose() {} }),
      registerWebviewViewProvider: () => ({ dispose() {} }), showInformationMessage: s => toasts.push(s), showErrorMessage() {}, showWarningMessage() {} },
    commands: { registerCommand: (k, v) => { commands[k] = v; return { dispose() {} }; } }
  };
  class Desktop {
    constructor() { this.capabilities = { python: "/fake/python", "notify-send": "fake", preview: true }; this.env = {}; this.sent = []; }
    async check() {} details() { return []; } async notify(...args) { this.sent.push(args); } dispose() { this.disposed = true; }
  }
  class Monitor {
    constructor(options) { this.options = options; monitors.push(this); } start() {} dispose() { this.disposed = true; }
  }
  const nativeRequire = createRequire(file);
  const sandbox = { module: { exports: {} }, process: { platform },
    require: n => n === "vscode" ? vscode : n === "./platform" ? { Desktop } : n === "./monitor" ? { Monitor } :
      n === "./core" ? { ...core, Claims: class { cleanup() {} claim() { return true; } } } : nativeRequire(n) };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
  const context = { extensionPath: path.dirname(path.dirname(file)), extensionUri: {}, subscriptions: [] };
  return { ...sandbox.module.exports, vscode, context, writes, logs, monitors, commands, toasts };
}
test("unsupported remote and non-Linux windows never start a reader", async () => {
  for (const options of [{ remote: "ssh-remote" }, { platform: "darwin" }]) {
    const m = load(options), extension = new m.Extension(m.context); await extension.ready;
    assert.equal(extension.diagnostics().status, "Unsupported"); assert.equal(m.monitors.length, 0); extension.dispose();
  }
});
test("theme changes discard stale webview replies and request fresh resolved tokens", async () => {
  const m = load();
  const e = new m.Extension(m.context); await e.ready;
  const requests = [];
  e.view = { webview: { postMessage: message => requests.push(message) } };
  e.refreshTheme();
  const oldGeneration = e.themeGeneration;
  await e.message({ type: "theme", generation: oldGeneration, tokens: { background: "#123456" } });
  assert.equal(e.themeTokens.background, "#123456");
  e.refreshTheme();
  await e.message({ type: "theme", generation: oldGeneration, tokens: { background: "#abcdef" } });
  assert.equal(e.themeTokens, null);
  await e.message({ type: "theme", generation: e.themeGeneration, tokens: { background: "#abcdef" } });
  assert.equal(e.themeTokens.background, "#abcdef");
  assert.equal(requests.at(-1).type, "requestTheme");
  e.dispose();
});
test("no-folder and disabled windows report real status", async () => {
  for (const [options, status] of [[{}, "Paused"], [{ settings: { enabled: false } }, "Disabled"]]) {
    const m = load(options), e = new m.Extension(m.context); await e.ready;
    assert.equal(e.diagnostics().status, status); assert.equal(m.monitors.length, 0); e.dispose();
  }
});
test("HTML contains only external assets and state messages reject untrusted values", async () => {
  const m = load({ settings: { soundChoice: "</script><script>alert(1)</script>" } });
  const e = new m.Extension(m.context); await e.ready;
  const html = e.html({ cspSource: "https://safe.example", asWebviewUri: uri => uri });
  assert.ok(html.includes("default-src 'none'")); assert.ok(!html.includes("unsafe-inline"));
  assert.ok(!html.includes("alert(1)")); assert.ok(!/<script(?![^>]*src=)/.test(html));
  await e.message(null); await e.message({ type: "updateSetting", key: "__proto__", value: true });
  await e.message({ type: "updateSetting", key: "volume", value: Infinity });
  await e.message({ type: "updateSetting", key: "soundChoice", value: "</script>" });
  await e.message({ type: "updateSetting", key: "codexHome", value: "/tmp/untrusted" });
  assert.equal(m.writes.length, 0);
  await e.message({ type: "updateSetting", key: "volume", value: 65 }); assert.equal(m.writes.length, 1);
  e.dispose();
});
test("workspace association, eligibility and shared claim decide notification dispatch", async () => {
  const folders = [{ name: "first", uri: { scheme: "file", fsPath: "/tmp/first" } }, { name: "second", uri: { scheme: "file", fsPath: "/tmp/second" } }];
  const m = load({ folders, settings: { mode: "unfocused" } }); const e = new m.Extension(m.context); await e.ready;
  let claims = 0; e.claims = { cleanup() {}, claim: () => ++claims === 1 };
  const turns = [{ threadId: "t", turnId: "u", cwd: "/tmp/second/subdir", title: "Sensitive title", message: "Sensitive reply" }];
  m.vscode.window.state.focused = true; e.onTurns(turns, e.generation); assert.equal(claims, 0);
  m.vscode.window.state.focused = false; e.onTurns(turns, e.generation); e.onTurns(turns, e.generation);
  assert.equal(e.desktop.sent.length, 1); assert.equal(e.desktop.sent[0][1].label, "second");
  assert.equal(e.desktop.sent[0][1].path, "/tmp/second");
  assert.ok(!m.logs.join(" ").includes("Sensitive"));
  e.dispose(); assert.equal(m.monitors[0].disposed, true); assert.equal(e.desktop.disposed, true);
});
test("configuration restart disposes the old reader and commands retain identifiers", async () => {
  const m = load({ folders: [{ uri: { fsPath: "/tmp/project" } }] });
  const e = new m.Extension(m.context); await e.ready; await e.refresh();
  assert.equal(m.monitors.length, 2); assert.equal(m.monitors[0].disposed, true); e.dispose();
  m.activate(m.context); await Promise.resolve();
  for (const name of ["testNotification", "importSound", "checkConfiguration"]) assert.equal(typeof m.commands[`codexNotifier.${name}`], "function");
  m.deactivate();
});
