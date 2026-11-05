"use strict";
const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const core = require("./core");
const { Desktop } = require("./platform");
const { Monitor } = require("./monitor");
const { appearance } = require("./theme");

const DATABASE_LABELS = {
  checking: "Checking database", ready: "Database ready", missing: "Waiting for Codex databases",
  incompatible: "Incompatible Codex database schema", unreadable: "Database unreadable or corrupt",
  busy: "Database busy; retrying", "reader-unavailable": "Python reader unavailable; retrying",
  "reader-stopped": "Python reader stopped; retrying", "reader-pipe-error": "Python communication failed; retrying",
  "reader-timeout": "Python reader timed out; retrying", "reader-protocol-error": "Python response invalid; retrying",
  "protocol-error": "Reader request invalid", "dispatch-error": "Notification dispatch failed"
};
class Extension {
  constructor(context) {
    this.context = context;
    this.output = vscode.window.createOutputChannel("Codex Ubuntu Notifications");
    this.logged = new Set(); this.disposed = false; this.generation = 0;
    this.database = "checking"; this.watcherWarning = false;
    this.soundDir = core.soundDirectory();
    this.themeGeneration = 0;
    this.desktop = new Desktop({ extensionPath: context.extensionPath, soundDir: this.soundDir,
      getAppearance: () => appearance(vscode.window.activeColorTheme?.kind, this.themeTokens), onChange: () => {
      for (const issue of this.desktop?.issues || []) this.log(`${issue}-failed`);
      this.sendState();
    } });
    this.supported = process.platform === "linux" && !vscode.env.remoteName;
    this.ready = this.refresh();
  }
  config() { return vscode.workspace.getConfiguration("codexNotifier"); }
  settings() { return core.readSettings(this.config()); }
  log(code) {
    if (this.disposed || this.logged.has(code)) return;
    this.logged.add(code); this.output.appendLine(`[${new Date().toISOString()}] ${code}`);
  }
  folders() { return vscode.workspace.workspaceFolders || []; }
  async refresh() {
    const generation = ++this.generation;
    this.monitor?.dispose(); this.monitor = null;
    this.database = "checking"; this.watcherWarning = false; this.dispatchIssue = null; this.sendState();
    if (!this.supported || this.disposed) return;
    await this.desktop.check();
    if (this.disposed || generation !== this.generation) return;
    const settings = this.settings();
    if (!settings.enabled || !this.folders().length || !this.desktop.capabilities.python) { this.sendState(); return; }
    this.home = core.codexHome(settings);
    this.claims = new core.Claims(this.home); this.claims.cleanup();
    this.monitor = new Monitor({ python: this.desktop.capabilities.python,
      script: path.join(this.context.extensionPath, "lib", "worker.py"), home: this.home, env: this.desktop.env,
      folders: this.folders().map(folder => folder.uri.fsPath),
      onStatus: (status, info) => {
        if (generation !== this.generation || this.disposed) return;
        if (status === "watcher-unavailable") this.watcherWarning = info?.code || "UNKNOWN";
        else if (status === "watcher-available") this.watcherWarning = false;
        else this.database = status;
        if (status !== "ready" && status !== "watcher-available") this.log(status + (info?.code ? ` (${info.code})` : ""));
        this.sendState();
      }, onTurns: turns => this.onTurns(turns, generation) });
    this.monitor.start(); this.sendState();
    await this.monitor.ready;
  }
  onTurns(turns, generation) {
    if (this.disposed || generation !== this.generation) return;
    const settings = this.settings();
    if (!core.eligible(settings, vscode.window.state.focused)) return;
    this.claims.cleanup();
    for (const turn of turns) {
      const folder = core.matchingFolder(turn.cwd, this.folders());
      if (!folder) continue;
      try {
        if (this.claims.claim(turn.threadId, turn.turnId)) {
          this.dispatchIssue = null;
          void this.desktop.notify(settings, folder, turn.title, turn.message, text => vscode.window.showInformationMessage(text))
            .catch(() => { this.log("dispatch-error"); this.dispatchIssue = "Notification dispatch failed"; this.sendState(); });
        }
      } catch { this.dispatchIssue = "Cross-window claim storage unavailable"; this.log("claim-storage-unavailable"); this.sendState(); }
    }
  }
  diagnostics() {
    const settings = this.settings();
    if (!this.supported) return { status: "Unsupported", details: ["Only local Linux desktop windows are supported. SSH, containers, WSL and Codespaces are excluded."] };
    if (!settings.enabled) return { status: "Disabled", details: ["Enable notifications to start monitoring."] };
    if (!this.folders().length) return { status: "Paused", details: ["Monitoring suspended: open a local folder."] };
    const details = [DATABASE_LABELS[this.database] || "Database unavailable", ...this.desktop.details(settings)];
    if (this.watcherWarning) details.push(`Filesystem watcher unavailable (${this.watcherWarning}); checks continue every 1.2 seconds. EMFILE/ENOSPC can indicate exhausted inotify resources.`);
    details.push("Completion detection: SQLite history plus incremental local Codex session events for this workspace.");
    if (this.dispatchIssue) details.push(this.dispatchIssue);
    if (this.database === "incompatible") details.push("Only thread_history_1.sqlite and state_5.sqlite with the documented schema are supported. No database is modified.");
    const c = this.desktop.capabilities;
    details.push(`Notifications: ${c["notify-send"] ? "available" : "unavailable"}; audio: ${c["pw-play"] ? "PipeWire" : c.paplay ? "PulseAudio" : c.aplay ? "ALSA" : "unavailable"}; preview: ${c.preview ? "available" : "unavailable"}.`);
    const extra = this.desktop.details(settings).length > 0 || this.watcherWarning || !!this.dispatchIssue;
    const status = this.database === "incompatible" ? "Incompatible" : this.database === "missing" ? "Waiting for Codex" :
      !c.python ? "Partially available" : this.database === "checking" ? "Checking" : this.database !== "ready" || extra ? "Partially available" : "Ready";
    return { status, details };
  }
  state() {
    return { ...this.settings(), diagnostics: this.diagnostics(),
      presets: core.PRESETS.filter(p => !p.systemPath || fs.existsSync(p.systemPath)).map(({ id, label }) => ({ id, label })),
      customSounds: core.listSounds(this.soundDir) };
  }
  sendState() { if (!this.disposed && this.view) void this.view.webview.postMessage({ type: "state", state: this.state() }); }
  refreshTheme() {
    this.themeTokens = null;
    ++this.themeGeneration;
    if (this.view) void this.view.webview.postMessage({ type: "requestTheme", generation: this.themeGeneration });
  }
  html(webview) {
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    const values = { cspSource: webview.cspSource,
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(media, "sidebar.js")).toString(),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(media, "sidebar.css")).toString() };
    return fs.readFileSync(path.join(this.context.extensionPath, "media", "sidebar.html"), "utf8")
      .replace(/\$\{(cspSource|scriptUri|styleUri)\}/g, (_, key) => values[key]);
  }
  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")] };
    view.webview.html = this.html(view.webview);
    this.context.subscriptions.push(view.webview.onDidReceiveMessage(msg => {
      void this.message(msg).catch(() => { this.log("sidebar-action-failed"); vscode.window.showErrorMessage("Codex notification action failed. Run Check Configuration for details."); });
    }));
    this.context.subscriptions.push(view.onDidDispose(() => { if (this.view === view) this.view = null; }));
  }
  async message(msg) {
    if (!msg || typeof msg !== "object" || Array.isArray(msg) || typeof msg.type !== "string") return;
    switch (msg.type) {
      case "requestState": this.sendState(); this.refreshTheme(); break;
      case "theme":
        if (msg.generation === this.themeGeneration) this.themeTokens = appearance(vscode.window.activeColorTheme?.kind, msg.tokens);
        break;
      case "updateSetting":
        if (msg.key === "codexHome" || !core.validSetting(msg.key, msg.value)) return;
        await this.config().update(msg.key, msg.value, vscode.ConfigurationTarget.Global); this.sendState(); break;
      case "previewSound":
        if (!core.validSetting("soundChoice", msg.soundChoice) || !core.validSetting("volume", msg.volume) || !this.supported) return;
        await this.ready; await this.desktop.sound(msg.soundChoice, msg.volume); break;
      case "deleteCustomSound":
        core.deleteSound(this.soundDir, msg.fileName);
        if (this.settings().soundChoice === `custom:${msg.fileName}`) await this.config().update("soundChoice", "synth-1", vscode.ConfigurationTarget.Global);
        this.sendState(); break;
      case "importSound": await this.importSound(); break;
      case "testNotification": await this.testNotification(); break;
      case "checkConfiguration": await this.checkConfiguration(); break;
    }
  }
  async testNotification() {
    if (!this.supported) { vscode.window.showWarningMessage("Notifications require a local Linux desktop window."); return; }
    await this.ready;
    const f = this.folders()[0];
    const folder = f ? { path: f.uri.fsPath, label: f.name || path.basename(f.uri.fsPath) } : { path: "", label: "VS Code" };
    await this.desktop.notify(this.settings(), folder, "Test notification", "Codex Ubuntu Notifications is ready for a desktop test.", text => vscode.window.showInformationMessage(text));
  }
  async importSound() {
    if (!this.supported) return;
    const uris = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFiles: true, canSelectFolders: false,
      openLabel: "Import Sound", filters: { "Audio files": ["wav", "ogg", "oga", "mp3", "flac"] } });
    if (!uris?.length) return;
    if (uris[0].scheme !== "file") { vscode.window.showErrorMessage("Choose a local audio file."); return; }
    try {
      const name = core.importSound(uris[0].fsPath, this.soundDir);
      await this.config().update("soundChoice", `custom:${name}`, vscode.ConfigurationTarget.Global);
      this.sendState(); vscode.window.showInformationMessage("Custom sound imported and selected.");
    } catch { vscode.window.showErrorMessage("Cannot import sound. Select a regular local audio file up to 20 MiB; symbolic links are not accepted."); }
  }
  async checkConfiguration() {
    this.ready = this.refresh(); await this.ready;
    const report = this.diagnostics();
    this.output.appendLine(`Configuration: ${report.status}\n${report.details.join("\n")}`); this.output.show(true); this.sendState();
  }
  dispose() { this.disposed = true; ++this.generation; this.monitor?.dispose(); this.desktop.dispose(); this.output.dispose(); }
}
let active;
function activate(context) {
  active = new Extension(context); context.subscriptions.push(active);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("codexNotifier.sidebarView", active));
  for (const method of ["testNotification", "importSound", "checkConfiguration"]) {
    context.subscriptions.push(vscode.commands.registerCommand(`codexNotifier.${method}`, () => active[method]()));
  }
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (["workbench.colorTheme", "workbench.colorCustomizations", "editor.fontFamily", "editor.fontSize", "window.zoomLevel"].some(key => e.affectsConfiguration(key))) active.refreshTheme();
    if (e.affectsConfiguration("codexNotifier")) {
      if (e.affectsConfiguration("codexNotifier.codexHome") || e.affectsConfiguration("codexNotifier.enabled")) active.ready = active.refresh();
      active.sendState();
    }
  }));
  if (vscode.window.onDidChangeActiveColorTheme) context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(() => active.refreshTheme()));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => { active.ready = active.refresh(); }));
}
function deactivate() { active?.dispose(); active = null; }
module.exports = { activate, deactivate, Extension };
