"use strict";
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const { resolveSound, plain, displayWorkspaceLabel, escapeMarkup } = require("./core");
const { gtkCss } = require("./theme");

function hostEnv(source = process.env) {
  const env = { ...source };
  if (!source.SNAP && !source.SNAP_NAME) return env;
  for (const key of Object.keys(env)) {
    if (/^(SNAP|GTK_|GDK_|GIO_|GSETTINGS_)/.test(key) ||
        ["LD_LIBRARY_PATH", "LD_PRELOAD", "LOCPATH", "FONTCONFIG_PATH", "FONTCONFIG_FILE"].includes(key)) delete env[key];
  }
  env.XDG_DATA_DIRS = source.XDG_DATA_DIRS_VSCODE_SNAP_ORIG || "/usr/local/share:/usr/share:/var/lib/snapd/desktop";
  env.XDG_CONFIG_DIRS = source.XDG_CONFIG_DIRS_VSCODE_SNAP_ORIG || "/etc/xdg";
  return env;
}
function executable(name, env = process.env) {
  for (const dir of [...["/usr/bin", "/bin", "/usr/local/bin"], ...(env.PATH || "").split(path.delimiter)]) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, name);
    try { fs.accessSync(candidate, fs.constants.X_OK); if (fs.statSync(candidate).isFile()) return candidate; } catch { /* Try next directory. */ }
  }
  return null;
}
class Processes {
  constructor(execFile = cp.execFile) { this.execFile = execFile; this.children = new Set(); this.disposed = false; }
  run(file, args, env, timeout = 10000) {
    if (!file || this.disposed) return Promise.resolve(false);
    return new Promise(resolve => {
      let child, finished = false;
      const finish = ok => { if (finished) return; finished = true; if (child) this.children.delete(child); resolve(ok); };
      try {
        child = this.execFile(file, args, { env, timeout, killSignal: "SIGKILL", maxBuffer: 64 * 1024 }, error => finish(!error));
        if (!finished) this.children.add(child);
        child.on("error", () => finish(false));
        child.on("exit", (code, signal) => finish(code === 0 && !signal));
      } catch { finish(false); }
    });
  }
  dispose() {
    this.disposed = true;
    for (const child of this.children) { try { child.kill("SIGKILL"); } catch { /* Already stopped. */ } }
    this.children.clear();
  }
}
class Desktop {
  constructor({ extensionPath, soundDir, onChange = () => {}, getAppearance = () => null, processes = new Processes(), env = process.env, find = executable }) {
    Object.assign(this, { extensionPath, soundDir, onChange, getAppearance, processes, find });
    this.env = hostEnv(env); this.disposed = false; this.issues = new Set(); this.capabilities = {};
  }
  async check() {
    const generation = this.checkGeneration = (this.checkGeneration || 0) + 1;
    const env = this.env;
    const c = Object.fromEntries(["python3", "notify-send", "pw-play", "paplay", "aplay", "gjs"].map(n => [n, this.find(n, env)]));
    c.python = c.python3 && await this.processes.run(c.python3, ["-c", "import sqlite3"], env, 3000) ? c.python3 : null;
    c.preview = !!(env.DISPLAY && c.gjs && await this.processes.run(c.gjs,
      ["-c", 'imports.gi.versions.Gtk="3.0"; const Gtk=imports.gi.Gtk; Gtk.init(null);'], { ...env, GDK_BACKEND: "x11" }, 3000));
    if (this.disposed || generation !== this.checkGeneration) return c;
    this.capabilities = c; this.issues.clear(); this.onChange(); return c;
  }
  issue(channel, failed) {
    if (this.disposed) return;
    if (failed) this.issues.add(channel); else this.issues.delete(channel);
    this.onChange();
  }
  async sound(choice, volume) {
    const file = resolveSound(this.extensionPath, this.soundDir, choice);
    if (!file || !fs.existsSync(file)) { this.issue("audio", true); return false; }
    const pct = Math.max(5, Math.min(100, Number.isFinite(volume) ? volume : 55));
    const c = this.capabilities;
    const backends = [[c["pw-play"], [`--volume=${(pct / 100).toFixed(2)}`, file]],
      [c.paplay, [`--volume=${Math.round(pct / 100 * 65536)}`, file]],
      [/\.wav$/i.test(file) && c.aplay, ["-q", file]]];
    for (const [binary, args] of backends) {
      if (binary && await this.processes.run(binary, args, this.env)) { this.issue("audio", false); return true; }
    }
    this.issue("audio", true); return false;
  }
  async native(folder, title, message) {
    const icon = path.join(this.extensionPath, "codex-notifier.png");
    const ok = await this.processes.run(this.capabilities["notify-send"], ["--app-name=Codex Ubuntu Notifications",
      `--icon=${icon}`, "--", `Codex (${displayWorkspaceLabel(folder.label)})`, escapeMarkup(plain(message || title || "Turn completed"))], this.env, 4000);
    this.issue("notification", !ok); return ok;
  }
  async preview(folder, title, message, duration, lateFailure = () => {}) {
    if (!this.capabilities.preview) return false;
    const generation = this.previewGeneration = (this.previewGeneration || 0) + 1;
    // There is at most one overlay for this extension instance.
    if (this.previewChild) { try { this.previewChild.kill("SIGKILL"); } catch { /* Already stopped. */ } }
    const theme = this.getAppearance();
    const payload = JSON.stringify({ themeCss: theme ? gtkCss(theme) : "", workspaceLabel: displayWorkspaceLabel(folder.label), workspacePath: folder.path,
      title: plain(title, 200), message: String(message || "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").slice(0, 4000), durationSec: duration,
      iconPath: path.join(this.extensionPath, "codex-notifier.png"), codeBin: this.find("code", this.env) || "" });
    // Processes.run owns timeout, error handling and disposal for the overlay too.
    const promise = this.processes.run(this.capabilities.gjs, [path.join(this.extensionPath, "preview-overlay.js"), payload],
      { ...this.env, GDK_BACKEND: "x11" }, (duration + 5) * 1000);
    this.previewChild = [...this.processes.children].at(-1);
    // Do not postpone the fallback toast until the card has expired. A short
    // grace period catches startup failures; later failures are reported as well.
    let timer;
    const result = await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(true), 500); })]);
    clearTimeout(timer);
    if (generation === this.previewGeneration) this.issue("preview", !result);
    promise.then(ok => {
      if (generation !== this.previewGeneration || this.disposed) return;
      this.issue("preview", !ok);
      if (!ok && result) void lateFailure();
    });
    return result;
  }
  async notify(settings, folder, title, message, toast) {
    const visual = [];
    if (settings.desktopNotification || (settings.previewCard && !this.capabilities.preview)) visual.push(this.native(folder, title, message));
    if (settings.previewCard && this.capabilities.preview) visual.push(this.preview(folder, title, message, settings.previewDuration, async () => {
      if (!settings.desktopNotification && !await this.native(folder, title, message)) toast(`Codex (${displayWorkspaceLabel(folder.label)}): ${plain(message || title || "Turn completed")}`);
    }).then(ok => ok || (settings.desktopNotification ? false : this.native(folder, title, message))));
    if (settings.sound) void this.sound(settings.soundChoice, settings.volume);
    const results = await Promise.all(visual);
    if (settings.vscodeToast || ((settings.desktopNotification || settings.previewCard) && !results.some(Boolean))) {
      toast(`Codex (${displayWorkspaceLabel(folder.label)}): ${plain(message || title || "Turn completed")}`);
    }
  }
  details(settings) {
    const c = this.capabilities, messages = [];
    if (!c.python) messages.push("Python/sqlite3 unavailable. Install python3 with sqlite3 support.");
    if (settings.desktopNotification && !c["notify-send"]) messages.push("Desktop notifications unavailable: install libnotify-bin.");
    if (settings.sound && !c["pw-play"] && !c.paplay && !c.aplay) messages.push("Audio unavailable: install pipewire-bin, pulseaudio-utils or alsa-utils for your audio server.");
    if (settings.sound && !c["pw-play"] && !c.paplay && c.aplay) messages.push("ALSA fallback: WAV only; configured volume is unavailable.");
    if (settings.previewCard && !c.preview) messages.push("Preview unavailable: requires gjs, gir1.2-gtk-3.0 and a working X11/XWayland DISPLAY. Native notification fallback enabled.");
    for (const issue of this.issues) messages.push(`${issue} failed. Check the desktop session or run Check Configuration again.`);
    return messages;
  }
  dispose() { this.disposed = true; this.processes.dispose(); }
}
module.exports = { hostEnv, executable, Processes, Desktop };
