"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { validColors } = require("./theme");

const MAX_SOUND_BYTES = 20 * 1024 * 1024;
const AUDIO_EXT = /\.(wav|ogg|oga|mp3|flac)$/i;
const DEFAULTS = Object.freeze({
  enabled: true, mode: "always", desktopNotification: false, previewCard: true,
  previewDuration: 7, sound: true, soundChoice: "synth-2", volume: 55,
  vscodeToast: false, codexHome: "", topBarIndicator: true, topBarFlash: true, colors: Object.freeze({})
});
const PRESETS = [
  ...["Dawn", "Drift", "Halo", "Horizon"].map((label, index) =>
    ({ id: `synth-${index + 1}`, label, builtinFile: `synth-${index + 1}.wav` })),
  { id: "yaru-message", label: "Ubuntu Yaru Message", systemPath: "/usr/share/sounds/Yaru/stereo/message.oga" },
  { id: "yaru-instant", label: "Ubuntu Yaru Instant", systemPath: "/usr/share/sounds/Yaru/stereo/message-new-instant.oga" }
];
const LEGACY = Object.fromEntries(["emerald-pulse", "luminous-instant", "harmonic-arp", "analog-glow"].map((s, i) => [`synth-${s}`, `synth-${i + 1}`]));
function normalizeChoice(s) { return LEGACY[s] || s; }
function safeName(name) {
  return typeof name === "string" && name !== "." && name !== ".." &&
    !/[\\/\x00-\x1f]/.test(name) && name.length > 0 && name.length <= 255;
}
function validSetting(key, value) {
  if (!Object.hasOwn(DEFAULTS, key)) return false;
  if (key === "colors") return validColors(value);
  if (typeof DEFAULTS[key] === "boolean") return typeof value === "boolean";
  if (key === "mode") return ["always", "unfocused"].includes(value);
  if (key === "volume" || key === "previewDuration") {
    return Number.isFinite(value) && value >= (key === "volume" ? 5 : 3) && value <= (key === "volume" ? 100 : 20);
  }
  if (key === "soundChoice") {
    return typeof value === "string" && (PRESETS.some(p => p.id === normalizeChoice(value)) ||
      (value.startsWith("custom:") && safeName(value.slice(7)) && AUDIO_EXT.test(value.slice(7))));
  }
  return key === "codexHome" && typeof value === "string" && value.length <= 4096 &&
    !/[\x00-\x1f]/.test(value) && (!value || path.isAbsolute(value));
}
function readSettings(cfg) {
  return Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) => {
    const value = cfg.get(key, fallback);
    return [key, validSetting(key, value) ? (key === "soundChoice" ? normalizeChoice(value) : value) : fallback];
  }));
}
function canonical(p) {
  const resolved = path.resolve(p);
  try { return fs.realpathSync(resolved); } catch { return resolved; }
}
function codexHome(settings, env = process.env) {
  return canonical(settings.codexHome || env.CODEX_HOME || path.join(os.homedir(), ".codex"));
}
function matchingFolder(cwd, folders = []) {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) return null;
  const turn = canonical(cwd);
  return folders.filter(f => !f.uri.scheme || f.uri.scheme === "file").map(f => ({
    path: canonical(f.uri.fsPath), label: f.name || path.basename(f.uri.fsPath)
  })).filter(f => turn === f.path || turn.startsWith(f.path.endsWith(path.sep) ? f.path : f.path + path.sep))
    .sort((a, b) => b.path.length - a.path.length)[0] || null;
}
function eligible(settings, focused) {
  return settings.enabled && (settings.mode !== "unfocused" || !focused);
}
function soundDirectory() { return path.join(os.homedir(), ".config", "codex-notifier", "sounds"); }
function ensureSoundDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(dir).isSymbolicLink() || !fs.statSync(dir).isDirectory()) throw new Error("Unsafe sound directory");
}
function soundFile(dir, name) {
  if (!safeName(name) || !AUDIO_EXT.test(name)) return null;
  const target = path.join(dir, name);
  try {
    const st = fs.lstatSync(target);
    if (!st.isFile() || st.isSymbolicLink() || st.size > MAX_SOUND_BYTES) return null;
    if (canonical(path.dirname(target)) !== canonical(dir)) return null;
    return target;
  } catch { return null; }
}
function listSounds(dir) {
  try {
    ensureSoundDirectory(dir);
    return fs.readdirSync(dir).filter(n => soundFile(dir, n)).sort().map(fileName => ({
      id: `custom:${fileName}`, fileName, label: `Custom: ${fileName}`
    }));
  } catch { return []; }
}
function importSound(src, dir) {
  ensureSoundDirectory(dir);
  if (!AUDIO_EXT.test(src)) throw new Error("Unsupported audio extension");
  const fd = fs.openSync(src, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > MAX_SOUND_BYTES || st.size === 0) throw new Error("Select a regular audio file between 1 byte and 20 MiB");
    const ext = path.extname(src).toLowerCase();
    const stem = path.basename(src, path.extname(src)).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "sound";
    const name = `${stem}-${crypto.randomUUID()}${ext}`;
    const target = path.join(dir, name);
    const out = fs.openSync(target, "wx", 0o600);
    try {
      // Bound the read even if the source grows after fstat.
      const data = Buffer.alloc(st.size + 1);
      let size = 0, n;
      while (size < data.length && (n = fs.readSync(fd, data, size, data.length - size, null))) size += n;
      if (size !== st.size) throw new Error("Audio file changed during import");
      fs.writeFileSync(out, data.subarray(0, size));
    } catch (error) { fs.unlinkSync(target); throw error; }
    finally { fs.closeSync(out); }
    return name;
  } finally { fs.closeSync(fd); }
}
function deleteSound(dir, name) {
  const target = soundFile(dir, name);
  if (!target) throw new Error("Invalid custom sound");
  fs.unlinkSync(target);
}
function resolveSound(extensionPath, dir, choice) {
  const normalized = normalizeChoice(choice);
  if (normalized?.startsWith("custom:")) return soundFile(dir, normalized.slice(7));
  const preset = PRESETS.find(p => p.id === normalized) || PRESETS[0];
  const target = preset.systemPath || path.join(extensionPath, "sounds", preset.builtinFile);
  return fs.existsSync(target) ? target : path.join(extensionPath, "sounds", "synth-2.wav");
}
function escapeMarkup(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function plain(text, limit = 160) {
  return String(text || "").replace(/```[\s\S]*?```/g, " [code] ").replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*`_~]/g, "").replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, limit);
}
function displayWorkspaceLabel(label) {
  const text = String(label || "").trim();
  return /^codex[ _-]*ubuntu[ _-]*notifications$/i.test(text) ? "Codex Ubuntu Notifications" : plain(text, 100);
}
function digest(s) { return crypto.createHash("sha256").update(s).digest("hex"); }
class Claims {
  constructor(home, root = path.join(os.tmpdir(), `codex-notifier-${process.getuid?.() ?? "user"}`)) {
    this.root = root; this.home = digest(canonical(home));
  }
  claim(threadId, turnId) {
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const st = fs.lstatSync(this.root);
    if (!st.isDirectory() || st.isSymbolicLink() || (process.getuid && st.uid !== process.getuid()) || (st.mode & 0o077)) throw new Error("Unsafe claim directory");
    const key = digest(JSON.stringify([this.home, threadId, turnId]));
    try { const fd = fs.openSync(path.join(this.root, key), "wx", 0o600); fs.closeSync(fd); return true; }
    catch (error) { if (error.code === "EEXIST") return false; throw error; }
  }
  cleanup(now = Date.now()) {
    try {
      const rootStat = fs.lstatSync(this.root);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o077) ||
          (process.getuid && rootStat.uid !== process.getuid())) return;
      for (const n of fs.readdirSync(this.root)) {
        if (!/^[a-f0-9]{64}$/.test(n)) continue;
        const p = path.join(this.root, n), st = fs.lstatSync(p);
        if (st.isFile() && !st.isSymbolicLink() && now - st.mtimeMs > 7 * 86400000) fs.unlinkSync(p);
      }
    } catch { /* Cleanup must not interrupt monitoring. */ }
  }
}
module.exports = { DEFAULTS, PRESETS, MAX_SOUND_BYTES, validSetting, readSettings, canonical, codexHome,
  matchingFolder, eligible, soundDirectory, soundFile, listSounds, importSound, deleteSound,
  resolveSound, normalizeChoice, plain, displayWorkspaceLabel, escapeMarkup, Claims };
