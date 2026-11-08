"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const versions = require("../scripts/versions");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "notifier-versions-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = args => versions.git(root, args);
  git(["init", "-q"]);
  git(["config", "user.name", "Release Fixture"]);
  git(["config", "user.email", "fixture@users.noreply.github.com"]);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "1.0.0", license: "SEE LICENSE IN LICENSE" }));
  fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ version: "1.0.0", packages: { "": { version: "1.0.0" } } }));
  fs.writeFileSync(path.join(root, "LICENSE"), "Commons Clause License Condition v1.0\nMIT License\nSynthetic fixture, not a project license.\n");
  fs.writeFileSync(path.join(root, "CHANGELOG.md"), "# Changelog\n\n## 1.0.0\n\n- Initial fixture.\n");
  fs.writeFileSync(path.join(root, "README.md"), "Version 1.0.0 remains a candidate. `v1.0.0` codex-ubuntu-notifications-1.0.0.vsix\nHistorical test evidence: 1.0.0.\n");
  const commit = message => { git(["add", "."]); git(["commit", "-qm", message]); return git(["rev-parse", "HEAD"]); };
  const first = commit("Initial fixture");
  return { root, git, commit, first };
}

test("version history selects the latest real commit per recorded version", t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, "feature.js"), "// Actual committed feature\n");
  const latest = f.commit("Improve fixture");
  assert.deepEqual(versions.snapshots(f.root), [{ version: "1.0.0", commit: latest }]);
  assert.notEqual(latest, f.first);
});

test("version tags are idempotent, require a clean tree and never move an existing release", t => {
  const f = fixture(t);
  assert.equal(versions.tagCurrent(f.root), "v1.0.0");
  assert.equal(versions.tagCurrent(f.root), "v1.0.0");
  assert.equal(versions.checkTag(f.root, "v1.0.0"), "1.0.0");
  fs.writeFileSync(path.join(f.root, "feature.js"), "// pending\n");
  assert.throws(() => versions.tagCurrent(f.root), /Commit your public source/);
  f.commit("Later work without bump");
  assert.throws(() => versions.tagCurrent(f.root), /already marks another commit/);
  assert.equal(versions.tagCommit(f.root, "1.0.0"), f.first);
  assert.throws(() => versions.checkTag(f.root, "v1.0.0"), /do not match/);
});

test("version bump updates both manifests, current links and release notes while preserving historical evidence", t => {
  const f = fixture(t);
  versions.tagCurrent(f.root);
  fs.writeFileSync(path.join(f.root, "feature.js"), "// feature\n");
  f.commit("Add a useful feature");
  assert.equal(versions.bump(f.root, "patch"), "1.0.1");
  const { manifest, lock } = versions.metadata(f.root);
  assert.equal(manifest.version, "1.0.1"); assert.equal(lock.packages[""].version, "1.0.1");
  assert.match(fs.readFileSync(path.join(f.root, "README.md"), "utf8"), /`v1\.0\.1` codex-ubuntu-notifications-1\.0\.1\.vsix/);
  assert.match(fs.readFileSync(path.join(f.root, "README.md"), "utf8"), /Historical test evidence: 1\.0\.0/);
  assert.match(versions.changelog(f.root, "1.0.1"), /Add a useful feature/);
});

test("history tagging validates all licensing first and rejects MIT-only snapshots without creating partial tags", t => {
  const f = fixture(t);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.root, "package.json")));
  manifest.version = "1.0.1"; manifest.license = "MIT";
  fs.writeFileSync(path.join(f.root, "package.json"), JSON.stringify(manifest));
  const second = f.commit("MIT-only fixture must not be tagged");
  assert.throws(() => versions.tagHistory(f.root), /MIT-only snapshot/);
  assert.equal(f.git(["tag", "--list"]), "");
  manifest.license = "SEE LICENSE IN LICENSE";
  fs.writeFileSync(path.join(f.root, "package.json"), JSON.stringify(manifest));
  const latest = f.commit("Apply selected terms");
  const selected = versions.tagHistory(f.root);
  assert.equal(selected.length, 2);
  assert.equal(versions.tagCommit(f.root, "1.0.0"), f.first);
  assert.equal(versions.tagCommit(f.root, "1.0.1"), latest);
  assert.notEqual(latest, second);
});

test("invalid and backward version inputs cannot change release metadata", t => {
  const f = fixture(t);
  const before = fs.readFileSync(path.join(f.root, "package.json"), "utf8");
  for (const value of ["1.0.0", "0.9.0", "v1.0.1", "01.0.1", "1.0.1\n", "1.0.1\n--force", "2147483648.0.0"])
    assert.throws(() => versions.bump(f.root, value));
  assert.equal(fs.readFileSync(path.join(f.root, "package.json"), "utf8"), before);
  assert.equal(f.git(["status", "--porcelain"]), "");
});
