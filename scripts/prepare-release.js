"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const cp = require("node:child_process");
const versions = require("./versions");

const root = path.resolve(__dirname, "..");
function run(command, args) {
  const result = cp.spawnSync(command, args, { cwd: root, stdio: "inherit",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, shell: process.platform === "win32" });
  if (result.error || result.status !== 0) throw new Error(`Release preparation stopped: ${command} ${args.join(" ")}`);
}
function main() {
  versions.clean(root);
  const { manifest } = versions.metadata(root);
  versions.licenseReady(root);
  const notes = versions.changelog(root, manifest.version);
  const commit = versions.git(root, ["rev-parse", "HEAD"]);
  const existing = versions.tagCommit(root, manifest.version);
  if (existing && existing !== commit) throw new Error("This version already marks another commit. Run npm run version:bump first.");
  for (const script of ["public:check", "test", "package", "package:check", "package:marketplace", "package:check:marketplace"])
    run("npm", ["run", script, ...(script === "public:check" ? ["--", "--release"] : [])]);
  versions.clean(root);
  if (versions.git(root, ["rev-parse", "HEAD"]) !== commit) throw new Error("The source commit changed during verification; prepare again.");
  const version = manifest.version;
  const artifacts = ["", "-marketplace"].map(suffix => {
    const file = `${manifest.name}-${version}${suffix}.vsix`;
    return { file, sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "dist", file))).digest("hex") };
  });
  const record = { version, tag: `v${version}`, commit, license: "MIT subject to Commons Clause License Condition v1.0", artifacts };
  fs.writeFileSync(path.join(root, "dist", `release-${version}.json`), JSON.stringify(record, null, 2) + "\n");
  fs.writeFileSync(path.join(root, "dist", `SHA256SUMS-${version}.txt`), artifacts.map(a => `${a.sha256}  ${a.file}`).join("\n") + "\n");
  fs.writeFileSync(path.join(root, "dist", `RELEASE-NOTES-${version}.md`), `# ${version}\n\n${notes}\n\nSource commit: ${commit}\n\nLicense: MIT subject to Commons Clause License Condition v1.0. Ordinary work use is allowed; the license's sale restriction applies.\n\nRelease candidate. Complete TESTING.md before production publication.\n`);
  console.log(`Prepared ${versions.tagCurrent(root)} at ${commit}. VSIX files, checksums, release record and notes are in dist/. Nothing was uploaded.`);
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
