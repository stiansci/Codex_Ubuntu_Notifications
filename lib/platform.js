"use strict";
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const { pathToFileURL, fileURLToPath } = require("node:url");
const { linkLabels } = require("./notificationMarkdown");
const { resolveSound, plain, displayWorkspaceLabel, escapeMarkup } = require("./core");
const { gtkCss, appearance } = require("./theme");
const { ubuntuHost, sessionAudio } = require("./dependencies");
const HOST_ENVIRONMENT = require("./hostEnvironment.json");

// Resolve PDF links independently of the shortened preview text.
function pdfTargets(message, workspacePath) {
  const targets = [];
  const add = value => {
    let destination = value.trim();
    const angled = destination.match(/^<([^>]+)>(?:\s+["'].*)?$/);
    if (angled) destination = angled[1];
    else destination = destination.replace(/\s+["'][^\n]*["']$/, '');
    if (!destination || /[\x00-\x1f]/.test(destination)) return;
    try {
      let uri, name;
      if (/^https?:\/\//i.test(destination)) {
        const url = new URL(destination);
        if (!/\.pdf$/i.test(decodeURIComponent(url.pathname))) return;
        uri = url.href; name = decodeURIComponent(url.pathname.split('/').pop());
      } else {
        let file;
        if (/^file:/i.test(destination)) file = fileURLToPath(destination);
        else {
          if (/^[a-z][a-z0-9+.-]*:/i.test(destination)) return;
          file = decodeURIComponent(destination);
          if (!path.isAbsolute(file)) {
            if (!workspacePath || !path.isAbsolute(workspacePath)) return;
            file = path.resolve(workspacePath, file);
          }
        }
        if (!/\.pdf$/i.test(file)) return;
        if (!fs.statSync(file).isFile()) return;
        uri = pathToFileURL(file).href; name = path.basename(file);
      }
      if (!targets.some(target => target.uri === uri)) targets.push({ uri, name });
    } catch { /* Ignore malformed links and missing local documents. */ }
  };
  let fenced = false;
  for (const line of String(message || '').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    linkLabels(line, add);
    // Also recognize explicit file/HTTP URIs and inline-code file paths.
    for (const match of line.matchAll(/`([^`\n]+\.pdf)`|(?:https?:\/\/|file:\/\/\/)[^\s<>`]+/gi)) {
      add(match[1] || match[0].replace(/[.,;]+$/, ''));
    }
  }
  return targets;
}

function hostEnv(source = process.env) {
  const env = { ...source };
  const { prefixes, loaderKeys, xdgDefaults } = HOST_ENVIRONMENT;
  const snapPath = value => typeof value === "string" && value.includes("/snap/");
  // Integrated terminals can retain Snap library/module paths after SNAP and
  // SNAP_NAME have been removed. Inspect the loader variables as well.
  const contaminated = Object.keys(source).some(key =>
    (key.startsWith("SNAP") && source[key]) ||
    ((prefixes.some(prefix => key.startsWith(prefix)) || loaderKeys.includes(key) || Object.hasOwn(xdgDefaults, key)) && snapPath(source[key])));
  if (!contaminated) return env;
  for (const key of Object.keys(env)) {
    if (prefixes.some(prefix => key.startsWith(prefix)) || loaderKeys.includes(key)) delete env[key];
  }
  for (const [key, fallback] of Object.entries(xdgDefaults)) {
    const original = source[`${key}_VSCODE_SNAP_ORIG`];
    env[key] = typeof original === "string" ? original.split(path.delimiter)
      .filter(value => path.isAbsolute(value) && !snapPath(value)).join(path.delimiter) || fallback : fallback;
  }
  return env;
}
function executable(name, env = process.env) {
  for (const dir of [...["/usr/bin", "/bin", "/usr/local/bin", "/snap/bin"], ...(env.PATH || "").split(path.delimiter)]) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, name);
    try { fs.accessSync(candidate, fs.constants.X_OK); if (fs.statSync(candidate).isFile()) return candidate; } catch { /* Try next directory. */ }
  }
  return null;
}
class Processes {
  constructor(execFile = cp.execFile) { this.execFile = execFile; this.children = new Set(); this.disposed = false; }
  run(file, args, env, timeout = 10000, input = "") {
    if (!file || this.disposed) return Promise.resolve(false);
    return new Promise(resolve => {
      let child, finished = false;
      const finish = ok => { if (finished) return; finished = true; if (child) this.children.delete(child); resolve(ok); };
      try {
        child = this.execFile(file, args, { env, timeout, killSignal: "SIGKILL", maxBuffer: 64 * 1024 }, error => finish(!error));
        if (!finished) this.children.add(child);
        child.on("error", () => finish(false));
        child.on("exit", (code, signal) => finish(code === 0 && !signal));
        child.stdin?.on("error", () => {
          finish(false);
          try { child.kill("SIGKILL"); } catch { /* Already stopped. */ }
        });
        child.stdin?.end(input);
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
  constructor({ extensionPath, soundDir, onChange = () => {}, getAppearance = () => null, getColors = () => ({}), processes = new Processes(), env = process.env, find = executable }) {
    Object.assign(this, { extensionPath, soundDir, onChange, getAppearance, getColors, processes, find });
    this.env = hostEnv(env); this.disposed = false; this.issues = new Set(); this.capabilities = {};
  }
  async check() {
    const generation = this.checkGeneration = (this.checkGeneration || 0) + 1;
    const env = this.env;
    const c = Object.fromEntries(["python3", "notify-send", "pw-play", "paplay", "aplay", "gjs"].map(n => [n, this.find(n, env)]));
    c.python = c.python3 && await this.processes.run(c.python3, ["-c", "import sqlite3"], env, 3000) ? c.python3 : null;
    // Probe libraries without initializing a display, so a missing display is
    // never treated as a missing GTK package by dependency setup.
    c.gtk = !!(c.gjs && await this.processes.run(c.gjs,
      ["-c", 'imports.gi.versions.Gtk="3.0"; const Gtk=imports.gi.Gtk;'], env, 3000));
    c.appIndicator = !!(c.gjs && await this.processes.run(c.gjs,
      ["-c", 'imports.gi.versions.AyatanaAppIndicator3="0.1"; const Indicator=imports.gi.AyatanaAppIndicator3;'], env, 3000));
    c.preview = !!(env.DISPLAY && c.gtk && await this.processes.run(c.gjs,
      ["-c", 'imports.gi.versions.Gtk="3.0"; const Gtk=imports.gi.Gtk; Gtk.init(null);'], { ...env, GDK_BACKEND: "x11" }, 3000));
    c.ubuntu = ubuntuHost(); c.aptGet = this.find("apt-get", env); c.sudo = this.find("sudo", env);
    if (!c["pw-play"] && !c.paplay && !c.aplay) {
      c.audioServer = sessionAudio(env);
      const systemctl = !c.audioServer && this.find("systemctl", env);
      if (systemctl) {
        if (await this.processes.run(systemctl, ["--user", "is-active", "--quiet", "pipewire.service"], env, 3000)) c.audioServer = "pipewire";
        else if (await this.processes.run(systemctl, ["--user", "is-active", "--quiet", "pulseaudio.service"], env, 3000)) c.audioServer = "pulseaudio";
      }
    }
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
    const payload = JSON.stringify({ icon, summary: `Codex (${displayWorkspaceLabel(folder.label)})`,
      body: escapeMarkup(plain(message || title || "Turn completed")) });
    const ok = !!this.capabilities["notify-send"] && await this.processes.run(this.capabilities.python,
      [path.join(this.extensionPath, "lib", "native_notification.py")], this.env, 4000, payload);
    this.issue("notification", !ok); return ok;
  }
  async preview(folder, title, message, duration, lateFailure = () => {}) {
    if (!this.capabilities.preview) return false;
    const generation = this.previewGeneration = (this.previewGeneration || 0) + 1;
    // There is at most one overlay for this extension instance.
    if (this.previewChild) { try { this.previewChild.kill("SIGKILL"); } catch { /* Already stopped. */ } }
    const theme = this.getAppearance();
    const colors = this.getColors();
    const payload = JSON.stringify({ themeCss: theme || Object.keys(colors).length ? gtkCss(theme || appearance(2), colors) : "", workspaceLabel: displayWorkspaceLabel(folder.label), workspacePath: folder.path,
      pdfs: pdfTargets(message, folder.path), title: plain(title, 200), message: String(message || "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").slice(0, 4000), durationSec: duration,
      iconPath: path.join(this.extensionPath, "codex-notifier.png"), codeBin: this.find("code", this.env) || "" });
    // Processes.run owns timeout, error handling and disposal for the overlay too.
    const promise = this.processes.run(this.capabilities.gjs, [path.join(this.extensionPath, "preview-overlay.js"), "--stdin"],
      { ...this.env, GDK_BACKEND: "x11" }, (duration + 5) * 1000, payload);
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
    if (settings.desktopNotification) visual.push(this.native(folder, title, message));
    if (settings.previewCard && this.capabilities.preview) visual.push(this.preview(folder, title, message, settings.previewDuration, async () => {
      if (!settings.desktopNotification) toast(`Codex (${displayWorkspaceLabel(folder.label)}): ${plain(message || title || "Turn completed")}`);
    }));
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
    if (settings.previewCard && !c.preview) messages.push("Preview unavailable: requires gjs, gir1.2-gtk-3.0 and a working X11/XWayland DISPLAY. In-editor fallback enabled.");
    if (settings.topBarIndicator && (!c.gtk || !c.appIndicator)) messages.push("Top-bar libraries unavailable: requires gjs, gir1.2-gtk-3.0 and gir1.2-ayatanaappindicator3-0.1. AppIndicators must also be enabled in the desktop session.");
    for (const issue of this.issues) messages.push(`${issue} failed. Check the desktop session or run Check Configuration again.`);
    return messages;
  }
  dispose() { this.disposed = true; this.processes.dispose(); }
}
module.exports = { pdfTargets, hostEnv, executable, Processes, Desktop };
