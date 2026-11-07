"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("sidebar hex fields normalize colors, reject invalid input, preserve edits and reset overrides", () => {
  const elements = new Map(), messages = [];
  class Element {
    constructor() { this.children = []; this.style = {}; this.value = ""; this.options = []; }
    set id(value) { this.identifier = value; elements.set(value, this); }
    get id() { return this.identifier; }
    appendChild(child) { this.children.push(child); }
    setAttribute(key, value) { this[key] = value; }
    setCustomValidity(value) { this.error = value; }
    reportValidity() { this.reported = true; }
  }
  const document = { activeElement: null, documentElement: {}, body: {},
    createElement: () => new Element(),
    getElementById: id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); } };
  let receive;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../media/sidebar.js"), "utf8"), {
    document, acquireVsCodeApi: () => ({ postMessage: message => messages.push(message) }),
    MutationObserver: class { observe() {} }, window: { addEventListener: (_event, fn) => { receive = fn; } }
  });
  receive({ data: { type: "state", state: { colors: { working: "#123456" }, resolvedColors: {}, presets: [], customSounds: [] } } });
  const hex = elements.get("hex-badgeBackground");
  hex.value = "AbC"; hex.oninput(); hex.onchange();
  assert.equal(messages.at(-1).value.badgeBackground, "#aabbcc");
  assert.equal(messages.at(-1).value.working, "#123456");
  const saved = messages.length;
  hex.value = "invalid"; hex.oninput(); hex.onchange();
  assert.ok(hex.error); assert.ok(hex.reported); assert.equal(messages.length, saved);
  document.activeElement = hex;
  hex.value = "#12";
  receive({ data: { type: "state", state: { colors: {}, resolvedColors: {}, presets: [], customSounds: [] } } });
  assert.equal(hex.value, "#12");
  hex.value = ""; hex.oninput(); hex.onchange();
  assert.equal(Object.hasOwn(messages.at(-1).value, "badgeBackground"), false);
  document.getElementById("resetColorsBtn").onclick();
  assert.equal(Object.keys(messages.at(-1).value).length, 0);
  receive({ data: { type: "state", state: { dependencySetup: { available: true, packages: ["libnotify-bin"], audioChoiceRequired: false, installing: false } } } });
  assert.equal(elements.get("setupCard").hidden, false);
  assert.match(elements.get("setupDetails").textContent, /libnotify-bin/);
  elements.get("installDependenciesBtn").onclick();
  assert.equal(messages.at(-1).type, "installDependencies");
  receive({ data: { type: "state", state: { dependencySetup: { available: true, packages: [], installing: true } } } });
  assert.equal(elements.get("setupCard").hidden, false); assert.equal(elements.get("installDependenciesBtn").disabled, true);
  receive({ data: { type: "state", state: { dependencySetup: { available: true, packages: [], installing: false } } } });
  assert.equal(elements.get("setupCard").hidden, true);
});
