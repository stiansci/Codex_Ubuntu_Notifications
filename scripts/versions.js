"use strict";
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function git(root, args, options = {}) {
  return cp.execFileSync("git", args, { cwd: root, encoding: "utf8", ...options }).trimEnd();
}
function validVersion(value) {
  return typeof value === "string" && value === value.trim() && VERSION.test(value) && value.split(".").every(n => Number(n) <= 2147483647);
}
function clean(root) {
  if (git(root, ["status", "--porcelain", "--untracked-files=all"])) throw new Error("Commit your public source changes before tagging or preparing a release.");
}
function metadata(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  if (!validVersion(manifest.version) || lock.version !== manifest.version || lock.packages?.[""]?.version !== manifest.version)
    throw new Error("package.json and package-lock.json must contain the same valid X.Y.Z version.");
  return { manifest, lock };
}
function snapshots(root) {
  const versions = new Map();
  for (const commit of git(root, ["rev-list", "--reverse", "--first-parent", "HEAD"]).split("\n").filter(Boolean)) {
    let manifest;
    try { manifest = JSON.parse(git(root, ["show", `${commit}:package.json`], { stdio: ["ignore", "pipe", "ignore"] })); }
    catch { continue; }
    if (validVersion(manifest.version)) versions.set(manifest.version, { version: manifest.version, commit });
  }
  return [...versions.values()];
}
function tagCommit(root, version) {
  if (!validVersion(version)) throw new Error("Invalid version.");
  const result = cp.spawnSync("git", ["rev-parse", "--verify", `refs/tags/v${version}^{commit}`], { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}
function checkTag(root, tag) {
  const { manifest } = metadata(root);
  if (tag !== `v${manifest.version}` || tagCommit(root, manifest.version) !== git(root, ["rev-parse", "HEAD"]))
    throw new Error("The tag, checked-out commit and extension version do not match.");
  return manifest.version;
}
function licenseReady(root, commit = "HEAD") {
  const manifest = JSON.parse(git(root, ["show", `${commit}:package.json`]));
  const license = git(root, ["show", `${commit}:LICENSE`]);
  if (manifest.license !== "SEE LICENSE IN LICENSE" || !license.startsWith("Commons Clause License Condition v1.0") || !license.includes("MIT License"))
    throw new Error("Refusing to tag an MIT-only snapshot. Apply the chosen combined license and metadata first.");
}
function changelog(root, version) {
  const text = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const start = text.indexOf(`## ${version}\n`);
  if (start < 0) throw new Error("Add this version's release notes to CHANGELOG.md before tagging.");
  const body = text.slice(start + `## ${version}\n`.length).split(/\n## /)[0].trim();
  if (!body || body.includes("Describe this release before tagging")) throw new Error("Complete the release notes before tagging.");
  return body;
}
function tagCurrent(root) {
  clean(root);
  const { manifest } = metadata(root);
  licenseReady(root);
  changelog(root, manifest.version);
  const commit = git(root, ["rev-parse", "HEAD"]);
  const existing = tagCommit(root, manifest.version);
  if (existing && existing !== commit) throw new Error(`v${manifest.version} already marks another commit. Bump the version; existing tags are never moved.`);
  if (!existing) git(root, ["tag", "-a", `v${manifest.version}`, "-m", `Codex Ubuntu Notifications ${manifest.version}\n\nLocal version marker. Source commit: ${commit}\nLicense: MIT subject to Commons Clause 1.0. No upload performed.`, commit]);
  return `v${manifest.version}`;
}
function tagHistory(root) {
  clean(root);
  const selected = snapshots(root);
  // Validate every candidate before writing any tags.
  for (const entry of selected) {
    licenseReady(root, entry.commit);
    const existing = tagCommit(root, entry.version);
    if (existing && existing !== entry.commit) throw new Error(`Existing v${entry.version} points elsewhere; no history tags were changed.`);
  }
  for (const entry of selected) {
    if (!tagCommit(root, entry.version)) git(root, ["tag", "-a", `v${entry.version}`, "-m",
      `Development snapshot ${entry.version}\n\nLatest recorded commit for this manifest version: ${entry.commit}\nNot evidence of a Marketplace publication. License: MIT subject to Commons Clause 1.0.`, entry.commit]);
  }
  return selected;
}
function bump(root, requested) {
  clean(root);
  const { manifest, lock } = metadata(root);
  const old = manifest.version;
  const parts = old.split(".").map(Number);
  let next = requested;
  if (requested === "patch") next = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  if (requested === "minor") next = `${parts[0]}.${parts[1] + 1}.0`;
  if (requested === "major") next = `${parts[0] + 1}.0.0`;
  if (!validVersion(next)) throw new Error("Use patch, minor, major, or a valid X.Y.Z version.");
  const proposed = next.split(".").map(Number);
  const changed = proposed.findIndex((value, index) => value !== parts[index]);
  if (changed < 0 || proposed[changed] < parts[changed]) throw new Error("The new version must be greater than the current version.");
  const changes = new Map();
  manifest.version = lock.version = lock.packages[""].version = next;
  changes.set("package.json", JSON.stringify(manifest, null, 2) + "\n");
  changes.set("package-lock.json", JSON.stringify(lock, null, 2) + "\n");
  for (const name of ["README.md", "TESTING.md", "PUBLICATION.md"]) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    let text = fs.readFileSync(file, "utf8");
    text = text.replaceAll(`codex-ubuntu-notifications-${old}.vsix`, `codex-ubuntu-notifications-${next}.vsix`)
      .replaceAll(`\`v${old}\``, `\`v${next}\``)
      .replaceAll(`Version ${old} remains`, `Version ${next} remains`)
      .replaceAll(`Version ${old} is`, `Version ${next} is`)
      .replaceAll(`# Release verification for ${old}`, `# Release verification for ${next}`);
    changes.set(name, text);
  }
  const log = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  if (log.includes(`## ${next}\n`)) throw new Error("The requested version already has release notes.");
  let notes = "- Describe this release before tagging.";
  if (tagCommit(root, old)) {
    const subjects = git(root, ["log", `v${old}..HEAD`, "--reverse", "--no-merges", "--format=%s"]);
    if (subjects) notes = subjects.split("\n").map(subject => `- ${subject}`).join("\n");
  }
  changes.set("CHANGELOG.md", log.replace(/^# Changelog\n/, `# Changelog\n\n## ${next}\n\n${notes}\n`));
  for (const [name, content] of changes) fs.writeFileSync(path.join(root, name), content);
  return next;
}
function main() {
  const [command = "list", argument] = process.argv.slice(2);
  if (command === "list") {
    console.log("VERSION       COMMIT        TAG");
    for (const entry of snapshots(ROOT)) console.log(`${entry.version.padEnd(13)} ${entry.commit.slice(0, 12)}  ${tagCommit(ROOT, entry.version) === entry.commit ? "v" + entry.version : "not tagged"}`);
  } else if (command === "bump") {
    console.log(`Prepared ${bump(ROOT, argument || "patch")}. Review CHANGELOG.md and commit the changes, then run npm run release:prepare.`);
  } else if (command === "tag") console.log(`Local tag ready: ${tagCurrent(ROOT)}. Nothing was uploaded.`);
  else if (command === "tag-history") { for (const entry of tagHistory(ROOT)) console.log(`v${entry.version} -> ${entry.commit.slice(0, 12)} (development snapshot)`); }
  else if (command === "check-tag") console.log(`Verified ${checkTag(ROOT, argument)}: tag, commit and manifest agree.`);
  else throw new Error("Use list, bump, tag, tag-history, or check-tag.");
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { git, validVersion, clean, metadata, snapshots, tagCommit, checkTag, licenseReady, changelog, tagCurrent, tagHistory, bump };
