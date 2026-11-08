"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const { name, version, repository } = require(path.join(root, "package.json"));
const marketplace = process.argv.includes("--marketplace");
const destination = path.join(root, "dist", `${name}-${version}${marketplace ? "-marketplace" : ""}.vsix`);
fs.mkdirSync(path.dirname(destination), { recursive: true });
// Local packages use bundled images; Marketplace packages use HTTPS URLs pinned
// to the release tag, which must be public before the Marketplace upload.
const repo = repository.url.replace(/\.git$/, "").replace(/\/$/, "");
if (marketplace && !repo.startsWith("https://github.com/")) throw new Error("Declare the public HTTPS GitHub repository before building the Marketplace package.");
const documentation = marketplace ? ["--githubBranch", `v${version}`,
  "--baseContentUrl", `${repo}/blob/v${version}/`,
  "--baseImagesUrl", `${repo.replace("https://github.com/", "https://raw.githubusercontent.com/")}/v${version}/`]
  : ["--no-rewrite-relative-links"];
const result = spawnSync("vsce", ["package", "--no-dependencies", ...documentation, "--out", destination], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32"
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
