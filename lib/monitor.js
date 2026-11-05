"use strict";
const fs = require("node:fs");
const cp = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");

class Monitor {
  constructor({ python, script, home, env, onTurns, onStatus, folders = [], spawn = cp.spawn, watch = fs.watch, since = Math.floor(Date.now() / 1000) }) {
    Object.assign(this, { python, script, home, env, onTurns, onStatus, folders, spawn, watch, since });
    this.disposed = false;
    this.child = null;
    this.pending = false;
    this.next = null;
    this.seen = new Set();
    this.baseline = true;
    this.delay = 1000;
    this.nextStart = 0;
    this.nextWatch = 0;
    this.watchDelay = 1000;
    this.ready = new Promise(resolve => { this.resolveReady = resolve; });
    this.timers = new Set();
    this.schedule = (fn, ms) => {
      const t = setTimeout(() => { this.timers.delete(t); if (!this.disposed) fn(); }, ms);
      this.timers.add(t); return t;
    };
  }
  cancel(timer) { clearTimeout(timer); this.timers.delete(timer); }
  settleReady() { this.resolveReady?.(); this.resolveReady = null; }
  start() {
    this.attachWatcher(); this.poll();
    this.interval = setInterval(() => { this.attachWatcher(); this.poll(); }, 1200);
  }
  attachWatcher() {
    if (this.disposed || this.watcher || Date.now() < this.nextWatch || !fs.existsSync(this.home)) return;
    try {
      this.watcher = this.watch(this.home, (_event, filename) => {
        if (!filename || /^(thread_history_1|state_5)\.sqlite/.test(String(filename))) {
          if (this.debounce) this.cancel(this.debounce);
          this.debounce = this.schedule(() => this.poll(), 60);
        }
      });
      this.watcher.on("error", error => this.watchFailed(error));
      this.watchDelay = 1000;
      this.onStatus("watcher-available");
    } catch (error) { this.watchFailed(error); }
  }
  watchFailed(error) {
    this.watcher?.close(); this.watcher = null;
    this.nextWatch = Date.now() + this.watchDelay;
    this.watchDelay = Math.min(60000, this.watchDelay * 2);
    const code = typeof error?.code === "string" && /^[A-Z0-9_]{1,30}$/.test(error.code) ? error.code : "UNKNOWN";
    this.onStatus("watcher-unavailable", { code });
  }
  launch() {
    if (this.disposed || Date.now() < this.nextStart) return null;
    let child;
    try {
      child = this.spawn(this.python, ["-u", this.script, this.home], { env: this.env, stdio: ["pipe", "pipe", "pipe"] });
    } catch { this.failed(null, "reader-unavailable"); return null; }
    this.child = child;
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    child.on("error", () => this.failed(child, "reader-unavailable"));
    child.on("exit", () => this.failed(child, "reader-stopped"));
    child.stdin.on("error", () => this.failed(child, "reader-pipe-error"));
    child.stdout.on("error", () => this.failed(child, "reader-pipe-error"));
    // Drain stderr without exposing paths or database content in logs.
    child.stderr.on("data", () => {});
    child.stderr.on("error", () => {});
    child.stdout.on("data", chunk => {
      if (this.child !== child || this.disposed) return;
      buffer += decoder.write(chunk);
      if (Buffer.byteLength(buffer) > 4 * 1024 * 1024) return this.failed(child, "reader-protocol-error");
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        let result;
        try {
          result = JSON.parse(line);
          if (!Array.isArray(result.turns) || typeof result.status !== "string" || result.turns.length > 100) throw new Error();
        } catch { return this.failed(child, "reader-protocol-error"); }
        this.cancel(this.deadline); this.pending = false;
        this.delay = 1000; this.onStatus(result.status);
        this.settleReady();
        const fresh = result.turns.filter(t => typeof t.threadId === "string" && typeof t.turnId === "string" && Number.isFinite(t.completedAt))
          .filter(t => {
            const key = JSON.stringify([t.threadId, t.turnId]);
            if (this.seen.has(key)) return false;
            this.seen.add(key); return true;
          });
        if (fresh.length && !this.baseline) Promise.resolve(this.onTurns(fresh)).catch(() => this.onStatus("dispatch-error"));
        this.next = result.next;
        if (result.status === "ready" && !this.next) this.baseline = false;
        if (this.next) this.schedule(() => this.poll(), 0);
      }
    });
    return child;
  }
  failed(child, status) {
    if (this.disposed || (child && this.child !== child)) return;
    const active = this.child;
    this.child = null; this.pending = false; this.next = null;
    this.cancel(this.deadline);
    this.nextStart = Date.now() + this.delay;
    this.delay = Math.min(30000, this.delay * 2);
    if (active) { active.stdin.destroy(); active.kill("SIGKILL"); }
    this.onStatus(status);
    this.settleReady();
  }
  poll() {
    if (this.disposed || this.pending) return;
    const child = this.child || this.launch();
    if (!child || !child.stdin.writable) return;
    this.pending = true;
    this.deadline = this.schedule(() => this.failed(child, "reader-timeout"), 10000);
    try { child.stdin.write(JSON.stringify({ since: this.since, folders: this.folders, baseline: this.baseline, ...(this.next ? { after: this.next } : {}) }) + "\n"); }
    catch { this.failed(child, "reader-pipe-error"); }
  }
  dispose() {
    this.disposed = true;
    this.settleReady();
    clearInterval(this.interval);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.watcher?.close(); this.watcher = null;
    if (this.child) { this.child.stdin.destroy(); this.child.kill("SIGKILL"); this.child = null; }
  }
}
module.exports = { Monitor };
