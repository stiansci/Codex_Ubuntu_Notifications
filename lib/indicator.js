"use strict";
const cp = require("node:child_process");
const path = require("node:path");

class Indicator {
  constructor({ extensionPath, env, onIssue = () => {}, spawn = cp.spawn }) {
    Object.assign(this, { extensionPath, env, onIssue, spawn });
  }
  start({ home, gjs, python, enabled, flash = true, code = "", colors = {} }) {
    this.dispose();
    if (!enabled || !gjs || !python || (!this.env.DISPLAY && !this.env.WAYLAND_DISPLAY)) return;
    const launch = () => {
      if (this.child) return;
      try {
        const child = this.spawn(gjs, [path.join(this.extensionPath, "topbar-indicator.js"),
          JSON.stringify({ home, python, flash, code, colors })], { env: this.env, stdio: "ignore" });
        this.child = child;
        child.on("error", () => { if (this.child === child) this.child = null; this.onIssue(true); });
        child.on("exit", code => { if (this.child === child) this.child = null; this.onIssue(code !== 0); });
      } catch { this.onIssue(true); }
    };
    launch();
    // Other windows retry ownership if the owning extension host closes.
    this.timer = setInterval(launch, 10000);
    this.timer.unref?.();
  }
  dispose() {
    clearInterval(this.timer);
    if (this.child) { try { this.child.kill("SIGTERM"); } catch { /* Already exited. */ } }
    this.child = null;
  }
}
module.exports = { Indicator };
