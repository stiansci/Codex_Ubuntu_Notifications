"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Menu = require("../lib/topbarMenu");

test("top-bar actions use workspace names, group chats and never read conversation titles", () => {
  const chats = [
    { cwd: "/tmp/project", get title() { throw new Error("Conversation titles are private"); } },
    { cwd: "/tmp/project", title: "Proponi design per box esplicativo" },
    { cwd: "/tmp/other", title: "Private conversation" }
  ];
  assert.deepEqual(Menu.workspaceActions(chats), [
    { cwd: "/tmp/other", count: 1, label: "Open workspace: other (1 chat working)" },
    { cwd: "/tmp/project", count: 2, label: "Open workspace: project (2 chats working)" }
  ]);
});

test("top-bar labels disambiguate workspaces, treat underscores literally and remove control characters", () => {
  const actions = Menu.workspaceActions([
    { cwd: "/one/project" }, { cwd: "/two/project" }, { cwd: "/tmp/my_project/" },
    { cwd: "/tmp/line\nbreak\u202e" }, { cwd: "relative" }, { cwd: "/tmp/invalid\0" }, { cwd: null }
  ]);
  assert.equal(actions.length, 4);
  assert.ok(actions.some(action => action.label === "Open workspace: /one/project (1 chat working)"));
  assert.ok(actions.some(action => action.label === "Open workspace: /two/project (1 chat working)"));
  assert.ok(actions.some(action => action.label === "Open workspace: my_project (1 chat working)"));
  assert.ok(actions.every(action => !/[\n\u202e]/.test(action.label)));
});

test("activity descriptions distinguish singular, plural, idle, uncertain and unavailable states", () => {
  assert.equal(Menu.activityDescription({ status: "ready", count: 1, uncertain: 0 }), "1 chat working");
  assert.equal(Menu.activityDescription({ status: "ready", count: 2, uncertain: 0 }), "2 chats working");
  assert.equal(Menu.activityDescription({ status: "ready", count: 0, uncertain: 0 }), "No chats working");
  assert.match(Menu.activityDescription({ status: "ready", count: 0, uncertain: 2 }), /uncertain activity/);
  assert.equal(Menu.activityDescription({ status: "unavailable", count: 0 }), "Codex activity unavailable");
});

function indicatorMenu() {
  class Item {
    constructor(options = {}) { Object.assign(this, options); this.signals = {}; this.accessible = {}; }
    connect(signal, callback) { this.signals[signal] = callback; }
    get_label() { return this.label; }
    set_label(label) { this.label = label; }
    set_tooltip_text(text) { this.tooltip = text; }
    get_accessible() { return { set_property: (name, text) => { this.accessible[name] = text; } }; }
    destroy() { this.destroyed = true; this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  }
  class MenuWidget {
    constructor() { this.children = []; }
    append(item) { this.insert(item, this.children.length); }
    insert(item, index) { this.children.splice(index, 0, item); item.parent = this; }
    get_children() { return this.children.slice(); }
    reorder_child(item, index) { this.children.splice(this.children.indexOf(item), 1); this.children.splice(index, 0, item); }
    show_all() {}
  }
  const launches = [];
  const context = {
    ARGV: [JSON.stringify({ code: "/tmp/VS Code/code", flash: false })],
    imports: {
      gi: { versions: {},
        Gtk: { init() {}, main() {}, Menu: MenuWidget, MenuItem: Item, CheckMenuItem: Item, SeparatorMenuItem: Item },
        GLib: { path_get_dirname: () => "/extension", build_filenamev: parts => parts.join("/"),
          dir_make_tmp: () => "/tmp/icons", get_monotonic_time: () => 0, unix_signal_add() {}, rmdir() {} },
        Gio: { BusType: {}, BusNameOwnerFlags: {}, bus_own_name() {}, bus_unown_name() {}, SubprocessFlags: {},
          SubprocessLauncher: class { unsetenv() {} spawnv(args) { launches.push(args); } } } },
      searchPath: [], system: {}, topbarMenu: Menu, topbarArtwork: {}, byteArray: {}
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "topbar-indicator.js"), "utf8") +
    "\nglobalThis.deliver = update; globalThis.children = () => menu.get_children();", context);
  return { ...context, launches };
}

test("activity polling preserves keyboard targets and removes only completed workspaces", () => {
  const ui = indicatorMenu();
  const snapshot = { status: "ready", count: 1, uncertain: 0, chats: [{ cwd: "/tmp/a", title: "Private title" }] };
  ui.deliver(snapshot);
  const workspace = ui.children()[1];
  assert.equal(workspace.label, "Open workspace: a (1 chat working)");
  assert.equal(workspace.sensitive, true);
  assert.equal(ui.children()[0].sensitive, true);
  ui.deliver(snapshot);
  assert.equal(ui.children()[1], workspace);
  assert.equal(workspace.destroyed, undefined);
  ui.deliver({ ...snapshot, count: 3, chats: [{ cwd: "/tmp/0" }, ...snapshot.chats, { cwd: "/tmp/a" }] });
  assert.equal(ui.children()[2], workspace);
  assert.equal(workspace.label, "Open workspace: a (2 chats working)");
  workspace.signals.activate();
  assert.deepEqual(Array.from(ui.launches[0]), ["/tmp/VS Code/code", "--reuse-window", "--", "/tmp/a"]);
  ui.deliver({ status: "ready", count: 0, uncertain: 0, chats: [] });
  assert.equal(workspace.destroyed, true);
  assert.equal(ui.children().length, 3);
});
