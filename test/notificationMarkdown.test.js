"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({ imports: { gi: { GLib: {
  markup_escape_text: text => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
} } } });
vm.runInContext(fs.readFileSync(path.join(__dirname, "../lib/notificationMarkdown.js"), "utf8"), context);

test("Markdown tables become readable named rows in a narrow preview", () => {
  const input = "| Name | Result |\n| :--- | ---: |\n| Build | Passed |\n| Test | 3/3 |";
  assert.equal(context.previewText(input), "• Name: Build  ·  Result: Passed\n• Name: Test  ·  Result: 3/3");
  assert.equal(context.render(context.previewText(input)).includes("| ---"), false);
});

test("table conversion leaves fenced code alone and escapes cell content", () => {
  const input = "```\n| A | B |\n| --- | --- |\n| 1 | 2 |\n```\n| A | B |\n| --- | --- |\n| <script> | x |";
  const result = context.previewText(input);
  assert.match(result, /```\n\| A \| B \|/);
  assert.match(result, /• A: <script>  ·  B: x/);
  assert.match(context.render(result), /&lt;script&gt;/);
});
