"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const { name, version } = require(path.join(root, "package.json"));
const destination = path.join(root, "dist", `${name}-${version}.vsix`);
fs.mkdirSync(path.dirname(destination), { recursive: true });
// Local VSIX documentation uses its bundled screenshots, including before the
// updated files have been pushed to the repository.
const result = spawnSync("vsce", ["package", "--no-dependencies", "--no-rewrite-relative-links", "--out", destination], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32"
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
