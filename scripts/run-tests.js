"use strict";
// Register tests in one process; no desktop processes or global VS Code mocks.
const fs = require("node:fs");
const path = require("node:path");
const directory = path.join(__dirname, "..", "test");
for (const name of fs.readdirSync(directory).filter(n => n.endsWith(".test.js")).sort()) require(path.join(directory, name));
