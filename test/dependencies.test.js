"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const { DependencySetup, ubuntuHost, sessionAudio, packagePlan } = require("../lib/dependencies");
const { DEFAULTS } = require("../lib/core");

const healthy = { ubuntu: true, aptGet: "/usr/bin/apt-get", sudo: "/usr/bin/sudo", python: "/usr/bin/python3",
  "notify-send": "/usr/bin/notify-send", "pw-play": "/usr/bin/pw-play", gjs: "/usr/bin/gjs", gtk: true, appIndicator: true };
function harness({ capabilities = {}, supported = true, trusted = true, folders = [{}], choice, pick,
  settings = {}, executeError = false, recheckError = false } = {}) {
  const tasks = [], notices = [], warnings = [], errors = [], stored = new Map(), updates = [], listeners = { process: new Set(), end: new Set() };
  let rechecks = 0, checks = 0, pickCount = 0;
  const desktop = { capabilities: { ...healthy, ...capabilities }, env: { PATH: "/usr/bin:/bin" }, async check() { checks++; } };
  const listen = kind => callback => { listeners[kind].add(callback); return { dispose: () => listeners[kind].delete(callback) }; };
  const vscode = {
    workspace: { isTrusted: trusted, workspaceFolders: folders },
    window: {
      async showInformationMessage(...args) { notices.push(args); return choice; },
      showWarningMessage: message => warnings.push(message), showErrorMessage: message => errors.push(message),
      async showQuickPick(items) { pickCount++; return items.find(item => item.id === pick); }
    },
    Task: class { constructor(definition, scope, name, source, execution) { Object.assign(this, { definition, scope, name, source, execution }); } },
    ProcessExecution: class { constructor(process, args, options) { Object.assign(this, { process, args, options }); } },
    TaskScope: { Workspace: 2 }, TaskRevealKind: { Always: 1 }, TaskPanelKind: { Dedicated: 2 },
    tasks: { taskExecutions: [], onDidEndTaskProcess: listen("process"), onDidEndTask: listen("end"),
      async executeTask(task) { if (executeError) throw new Error("spawn failed"); tasks.push(task); return { task }; } }
  };
  const context = { globalState: { get: (key, fallback) => stored.get(key) ?? fallback,
    async update(key, value) { stored.set(key, value); updates.push([key, value]); } } };
  const setup = new DependencySetup({ vscode, context, desktop, supported, getSettings: () => ({ ...DEFAULTS, ...settings }),
    recheck: async () => { rechecks++; if (recheckError) throw new Error("check failed"); desktop.capabilities = { ...healthy }; }, onChange() {}, log() {} });
  return { setup, vscode, context, desktop, tasks, notices, warnings, errors, stored, updates, listeners,
    get rechecks() { return rechecks; }, get checks() { return checks; }, get pickCount() { return pickCount; },
    async end(code, task = tasks[0]) {
      const execution = { task };
      for (const callback of [...listeners.process]) callback({ execution, exitCode: code });
      for (const callback of [...listeners.end]) callback({ execution });
      await new Promise(resolve => setImmediate(resolve));
    } };
}

test("Ubuntu identification accepts derivatives and handles unreadable release files", () => {
  for (const release of ['ID=ubuntu\n', 'ID=linuxmint\nID_LIKE="ubuntu debian"\n']) assert.equal(ubuntuHost(() => release), true);
  for (const release of ['ID=debian\n', 'ID=fedora\n', 'NAME="Ubuntu"\nID=other\n']) assert.equal(ubuntuHost(() => release), false);
  assert.equal(ubuntuHost(() => { throw new Error("missing"); }), false);
});

test("audio detection uses the user's selected endpoint or existing session sockets", () => {
  assert.equal(sessionAudio({ PULSE_SERVER: "tcp:host" }, () => false), "pulseaudio");
  assert.equal(sessionAudio({ XDG_RUNTIME_DIR: "/run/user/1000" }, p => p === "/run/user/1000/pipewire-0"), "pipewire");
  assert.equal(sessionAudio({ XDG_RUNTIME_DIR: "/run/user/1000" }, p => p === "/run/user/1000/pulse/native"), "pulseaudio");
  assert.equal(sessionAudio({ XDG_RUNTIME_DIR: "/run/user/1000", PIPEWIRE_REMOTE: "custom" }, p => p === "/run/user/1000/custom"), "pipewire");
  assert.equal(sessionAudio({ XDG_RUNTIME_DIR: "relative" }, () => true), null);
  assert.equal(sessionAudio({ XDG_RUNTIME_DIR: "/run/user/1000" }, () => false), null);
});

test("package plans follow enabled features, existing players and the detected audio server", () => {
  assert.deepEqual(packagePlan(DEFAULTS, healthy), { packages: [], audioChoiceRequired: false });
  const missing = packagePlan(DEFAULTS, { audioServer: "pipewire" });
  assert.deepEqual(missing.packages, ["python3", "gjs", "gir1.2-gtk-3.0", "gir1.2-ayatanaappindicator3-0.1", "pipewire-bin"]);
  assert.equal(missing.audioChoiceRequired, false);
  assert.deepEqual(packagePlan({ sound: true }, { python: "python", audioServer: "pulseaudio" }).packages, ["pulseaudio-utils"]);
  assert.equal(packagePlan({ sound: true }, { python: "python" }).audioChoiceRequired, true);
  assert.deepEqual(packagePlan({ sound: true }, { python: "python", aplay: "aplay" }).packages, []);
  assert.deepEqual(packagePlan({ previewCard: true }, { python: "python", gjs: "gjs", gtk: true, "notify-send": "notify", preview: false }).packages, []);
  assert.deepEqual(packagePlan({ topBarIndicator: true }, { python: "python", gjs: "gjs", gtk: true }).packages, ["gir1.2-ayatanaappindicator3-0.1"]);
});

test("first-use prompt is persistent, optional and absent on healthy or unsupported hosts", async t => {
  const h = harness({ capabilities: { "notify-send": null }, settings: { desktopNotification: true }, choice: "Later" }); t.after(() => h.setup.dispose());
  await h.setup.offer(); await h.setup.offer();
  assert.equal(h.notices.length, 1); assert.equal(h.updates.length, 1); assert.equal(h.tasks.length, 0);
  const secondWindow = harness({ capabilities: { "notify-send": null }, settings: { desktopNotification: true } }); t.after(() => secondWindow.setup.dispose());
  secondWindow.context.globalState = h.context.globalState;
  await secondWindow.setup.offer(); assert.equal(secondWindow.notices.length, 0);
  for (const options of [{}, { supported: false }, { trusted: false }, { folders: [] }, { capabilities: { ubuntu: false } },
    { capabilities: { "notify-send": null }, settings: { desktopNotification: true, enabled: false } }]) {
    const other = harness(options); await other.setup.offer(); assert.equal(other.notices.length, 0); other.setup.dispose();
  }
});

test("installation is a visible argument-based task and restarts monitoring only after its process finishes", async t => {
  const h = harness({ capabilities: { "notify-send": null }, settings: { desktopNotification: true }, choice: "Install Missing Dependencies" }); t.after(() => h.setup.dispose());
  await h.setup.offer();
  assert.equal(h.tasks.length, 1); assert.equal(h.checks, 1); assert.equal(h.rechecks, 0);
  const task = h.tasks[0];
  assert.equal(task.execution.process, "/usr/bin/sudo");
  assert.deepEqual(task.execution.args, ["/usr/bin/apt-get", "install", "--no-install-recommends", "--no-remove", "--", "libnotify-bin"]);
  assert.equal(task.execution.options.cwd, os.homedir());
  assert.equal(task.presentationOptions.focus, true); assert.equal(task.presentationOptions.echo, true);
  assert.equal(task.presentationOptions.reveal, h.vscode.TaskRevealKind.Always);
  await h.setup.install(); assert.equal(h.tasks.length, 1);
  await h.end(0, { definition: { type: "unrelated", runId: task.definition.runId } });
  assert.equal(h.rechecks, 0); assert.equal(h.setup.installing, true);
  await h.end(0);
  assert.equal(h.rechecks, 1); assert.equal(h.setup.installing, false); assert.equal(h.warnings.length, 0);
  assert.equal(h.listeners.process.size + h.listeners.end.size, 0);
});

test("unknown audio requires an explicit choice and cancelling starts no package manager", async t => {
  for (const [pick, expected] of [[undefined, null], ["pulseaudio", "pulseaudio-utils"], ["alsa", "alsa-utils"]]) {
    const h = harness({ capabilities: { "pw-play": null }, pick }); t.after(() => h.setup.dispose());
    await h.setup.install(); assert.equal(h.pickCount, 1);
    if (expected) assert.deepEqual(h.tasks[0].execution.args, ["/usr/bin/apt-get", "install", "--no-install-recommends", "--no-remove", "--", expected]);
    else { assert.equal(h.tasks.length, 0); assert.equal(h.setup.installing, false); }
  }
});

test("setup blocks unsupported or untrusted contexts and running tasks", async t => {
  for (const options of [{ supported: false }, { trusted: false }, { folders: [] },
    { capabilities: { ubuntu: false } }, { capabilities: { sudo: null } }, { capabilities: { aptGet: null } }]) {
    const h = harness(options); t.after(() => h.setup.dispose());
    await h.setup.install(); assert.equal(h.tasks.length, 0); assert.equal(h.warnings.length, 1); assert.equal(h.setup.installing, false);
  }
  const h = harness(); t.after(() => h.setup.dispose());
  h.vscode.tasks.taskExecutions.push({ task: { definition: { type: "codexNotifier.dependencies" } } });
  await h.setup.install(); assert.equal(h.tasks.length, 0); assert.equal(h.checks, 0);
});

test("failed, cancelled and unstartable tasks release setup and recheck without claiming success", async t => {
  for (const code of [1, undefined, 130]) {
    const h = harness({ capabilities: { python: null } }); t.after(() => h.setup.dispose());
    await h.setup.install(); await h.end(code);
    assert.equal(h.rechecks, 1); assert.equal(h.setup.installing, false); assert.equal(h.warnings.length, 1);
    assert.match(h.warnings[0], /failed or was cancelled/);
  }
  const h = harness({ capabilities: { python: null }, executeError: true }); t.after(() => h.setup.dispose());
  await h.setup.install(); assert.equal(h.errors.length, 1); assert.equal(h.setup.installing, false);
  assert.equal(h.listeners.process.size + h.listeners.end.size, 0);
  const cancelled = harness({ capabilities: { python: null } }); t.after(() => cancelled.setup.dispose());
  await cancelled.setup.install();
  for (const callback of [...cancelled.listeners.end]) callback({ execution: { task: cancelled.tasks[0] } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled.setup.installing, false); assert.equal(cancelled.warnings.length, 1);
});

test("recheck failures recover, and disposal removes listeners without terminating apt", async t => {
  const h = harness({ capabilities: { python: null }, recheckError: true }); t.after(() => h.setup.dispose());
  await h.setup.install(); await h.end(0);
  assert.equal(h.setup.installing, false); assert.equal(h.errors.length, 1);
  const disposed = harness({ capabilities: { python: null } });
  await disposed.setup.install(); disposed.setup.dispose(); await disposed.end(0);
  assert.equal(disposed.rechecks, 0); assert.equal(disposed.listeners.process.size + disposed.listeners.end.size, 0);
});
