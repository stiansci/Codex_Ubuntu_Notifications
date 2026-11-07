"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const TASK_TYPE = "codexNotifier.dependencies";
const PROMPT_KEY = "dependencySetupPromptShown";
const AUDIO_PACKAGES = { pipewire: "pipewire-bin", pulseaudio: "pulseaudio-utils", alsa: "alsa-utils" };

function ubuntuHost(read = fs.readFileSync) {
  try {
    const release = read("/etc/os-release", "utf8");
    return /^(?:ID|ID_LIKE)=["']?[^\n"']*\bubuntu\b[^\n"']*["']?$/m.test(release);
  } catch { return false; }
}

function sessionAudio(env, exists = fs.existsSync) {
  // An explicit PulseAudio endpoint also works with pipewire-pulse.
  if (env.PULSE_SERVER) return "pulseaudio";
  const runtime = env.XDG_RUNTIME_DIR || (process.getuid ? `/run/user/${process.getuid()}` : "");
  if (!runtime || !path.isAbsolute(runtime)) return null;
  const remote = env.PIPEWIRE_REMOTE || "pipewire-0";
  if (exists(path.resolve(runtime, remote))) return "pipewire";
  if (exists(path.join(runtime, "pulse", "native"))) return "pulseaudio";
  return null;
}

function packagePlan(settings, capabilities, audioChoice) {
  const c = capabilities, packages = new Set();
  if (!c.python) packages.add("python3");
  if (settings.desktopNotification && !c["notify-send"]) packages.add("libnotify-bin");
  if (settings.previewCard || settings.topBarIndicator) {
    if (!c.gjs) packages.add("gjs");
    if (!c.gtk) packages.add("gir1.2-gtk-3.0");
  }
  if (settings.topBarIndicator && !c.appIndicator) packages.add("gir1.2-ayatanaappindicator3-0.1");
  const needsAudio = !!(settings.sound && !c["pw-play"] && !c.paplay && !c.aplay);
  const audioSystem = audioChoice || c.audioServer;
  const audioPackage = Object.hasOwn(AUDIO_PACKAGES, audioSystem) ? AUDIO_PACKAGES[audioSystem] : null;
  if (needsAudio && audioPackage) packages.add(audioPackage);
  return { packages: [...packages], audioChoiceRequired: needsAudio && !audioPackage };
}

class DependencySetup {
  constructor({ vscode, context, desktop, supported, getSettings, recheck, onChange, log }) {
    Object.assign(this, { vscode, context, desktop, supported, getSettings, recheck, onChange, log });
    this.installing = false; this.disposed = false; this.listeners = [];
  }
  state(audioChoice) {
    const { vscode, desktop } = this;
    let reason = "";
    if (!this.supported) reason = "Dependency setup requires a local Linux desktop window.";
    else if (!vscode.workspace.isTrusted) reason = "Trust this workspace before installing dependencies.";
    else if (!vscode.workspace.workspaceFolders?.length) reason = "Open a local folder before installing dependencies.";
    else if (!desktop.capabilities.ubuntu || !desktop.capabilities.aptGet || !desktop.capabilities.sudo) {
      reason = "Automatic dependency setup requires Ubuntu (or an Ubuntu derivative), apt-get and sudo. See the README for manual setup.";
    }
    return { ...packagePlan(this.getSettings(), desktop.capabilities, audioChoice),
      available: !reason, reason, installing: this.installing };
  }
  async offer() {
    const plan = this.state();
    if (this.disposed || this.installing || !this.getSettings().enabled || !plan.available ||
        (!plan.packages.length && !plan.audioChoiceRequired) || this.context.globalState.get(PROMPT_KEY, false)) return;
    await this.context.globalState.update(PROMPT_KEY, true);
    if (this.disposed) return;
    const choice = await this.vscode.window.showInformationMessage(
      "Codex Ubuntu Notifications needs additional Ubuntu packages for your enabled features. Install them in a terminal? You may be asked for your administrator password.",
      "Install Missing Dependencies", "Later");
    if (!this.disposed && choice === "Install Missing Dependencies") await this.install();
  }
  async install() {
    if (this.disposed) return;
    const { vscode } = this;
    if (this.installing || vscode.tasks.taskExecutions.some(e => e.task.definition.type === TASK_TYPE)) {
      void vscode.window.showInformationMessage("Dependency installation is already running. Check its terminal."); return;
    }
    if (!this.supported || !vscode.workspace.isTrusted || !vscode.workspace.workspaceFolders?.length) {
      void vscode.window.showWarningMessage(this.state().reason); return;
    }
    this.installing = true; this.onChange();
    let launched = false;
    try {
      await this.desktop.check();
      if (this.disposed) return;
      let plan = this.state();
      if (!plan.available) { void vscode.window.showWarningMessage(plan.reason); return; }
      if (plan.audioChoiceRequired) {
        const choice = await vscode.window.showQuickPick([
          { label: "PipeWire", id: "pipewire", description: "Install playback tools for an existing PipeWire server" },
          { label: "PulseAudio", id: "pulseaudio", description: "Install playback tools for an existing PulseAudio server" },
          { label: "ALSA", id: "alsa", description: "WAV playback only; the volume setting is unavailable" }
        ], { title: "Choose your existing audio system", placeHolder: "The audio server could not be detected. No audio server will be installed or replaced." });
        if (!choice || !Object.hasOwn(AUDIO_PACKAGES, choice.id) || this.disposed) return;
        plan = this.state(choice.id);
      }
      if (!plan.available) { void vscode.window.showWarningMessage(plan.reason); return; }
      if (!plan.packages.length) {
        void vscode.window.showInformationMessage("The packages for your enabled features are already available. Run Check Configuration for desktop-session issues."); return;
      }
      const runId = randomUUID();
      // ProcessExecution passes fixed package names as arguments, never through
      // a workspace shell. apt asks the user to review changes and confirm.
      const task = new vscode.Task({ type: TASK_TYPE, runId }, vscode.TaskScope.Workspace,
        "Install Missing Dependencies", "Codex Ubuntu Notifications",
        new vscode.ProcessExecution(this.desktop.capabilities.sudo,
          [this.desktop.capabilities.aptGet, "install", "--no-install-recommends", "--no-remove", "--", ...plan.packages],
          { cwd: os.homedir(), env: this.desktop.env }), []);
      task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, focus: true,
        panel: vscode.TaskPanelKind.Dedicated, clear: true, echo: true, showReuseMessage: true };
      const matches = event => event.execution.task.definition.runId === runId && event.execution.task.definition.type === TASK_TYPE;
      const finish = code => { void this.finished(code).catch(() => {
        this.log("dependency-recheck-failed"); this.reset();
        if (!this.disposed) void vscode.window.showErrorMessage("Could not recheck dependencies. Run Check Configuration.");
      }); };
      this.listeners.push(vscode.tasks.onDidEndTaskProcess(event => { if (matches(event)) finish(event.exitCode); }));
      // Also release setup state when a task is cancelled before its process starts.
      this.listeners.push(vscode.tasks.onDidEndTask(event => { if (matches(event)) finish(undefined); }));
      launched = true;
      await vscode.tasks.executeTask(task);
    } catch {
      launched = false; this.log("dependency-install-start-failed");
      if (!this.disposed) void vscode.window.showErrorMessage("Could not start dependency installation. Check the terminal or install the packages listed in the README.");
    } finally { if (!launched) this.reset(); }
  }
  async finished(code) {
    if (this.disposed || !this.installing || this.finishing) return;
    this.finishing = true; this.clearListeners();
    try {
      await this.recheck();
      if (this.disposed) return;
      const plan = this.state();
      if (code !== 0) {
        void this.vscode.window.showWarningMessage("Dependency installation failed or was cancelled. Review the setup terminal, then retry Install Missing Dependencies.");
      } else if (plan.packages.length || plan.audioChoiceRequired) {
        void this.vscode.window.showWarningMessage("Installation finished, but some dependencies are still unavailable. Run Check Configuration for details.");
      } else {
        void this.vscode.window.showInformationMessage("Dependencies checked and notification monitoring restarted. Use Send Test Notification to verify your desktop. The top-bar icon also needs AppIndicators enabled in your desktop session.");
      }
    } finally { this.reset(); }
  }
  clearListeners() { for (const listener of this.listeners) listener.dispose(); this.listeners = []; }
  reset() { this.clearListeners(); this.installing = false; this.finishing = false; if (!this.disposed) this.onChange(); }
  // Leave an apt transaction in its visible task terminal when deactivating.
  dispose() { this.disposed = true; this.clearListeners(); }
}

module.exports = { ubuntuHost, sessionAudio, packagePlan, DependencySetup };
