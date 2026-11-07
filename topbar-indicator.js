#!/usr/bin/env gjs
"use strict";
imports.gi.versions.Gtk = "3.0";
imports.gi.versions.AyatanaAppIndicator3 = "0.1";
const { Gtk, Gio, GLib, AyatanaAppIndicator3: AppIndicator } = imports.gi;
const config = JSON.parse(ARGV[0]);
const root = GLib.path_get_dirname(imports.system.programPath);
const icon = name => GLib.build_filenamev([root, "media", `codex-${name}.svg`]);
imports.searchPath.unshift(GLib.build_filenamev([root, "lib"]));
const Artwork = imports.topbarArtwork;
const Menu = imports.topbarMenu;
const ByteArray = imports.byteArray;
const iconDirectory = GLib.dir_make_tmp("codex-topbar-XXXXXX");
const generatedIcons = new Map();
let lastVisual, lastDescription;
function composedIcon(color, label) {
    const key = `codex-${color}-${label.replace(/\?/g, "unknown")}.svg`;
    if (!generatedIcons.has(key)) {
        const [, bytes] = GLib.file_get_contents(icon(color));
        const filename = GLib.build_filenamev([iconDirectory, key]);
        let logo = ByteArray.toString(bytes);
        let custom = config.colors?.[color === "green" ? "finished" : "working"];
        if (["blue", "blue-dim", "green"].includes(color) && typeof custom === "string" && /^#[\da-f]{6}$/i.test(custom)) {
            if (color === "blue-dim") custom = "#" + [1, 3, 5].map(i => Math.round(parseInt(custom.slice(i, i + 2), 16) * 0.4).toString(16).padStart(2, "0")).join("");
            logo = logo.replace(/fill="#[\da-f]{6}"/gi, `fill="${custom}"`);
        }
        GLib.file_set_contents(filename, Artwork.compose(label, logo));
        generatedIcons.set(key, filename);
    }
    return generatedIcons.get(key);
}
Gtk.init(null);
let indicator, worker, stream, timeout, lastRead = GLib.get_monotonic_time();
let snapshot = { status: "checking", count: 0, uncertain: 0, chats: [] };
let bright = true;
const menu = new Gtk.Menu();
const heading = new Gtk.MenuItem({ label: "Open VS Code (checking activity)", sensitive: !!config.code });
menu.append(heading);
const chatItems = new Map();
menu.append(new Gtk.SeparatorMenuItem());
const flash = new Gtk.CheckMenuItem({ label: "Flash while working", active: config.flash !== false });
menu.append(flash);
flash.get_accessible().set_property("accessible-description", "Use a flashing working icon. Turn off for a steady icon.");

function openCode(cwd) {
    if (!config.code) return;
    try {
        const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
        launcher.unsetenv("ELECTRON_RUN_AS_NODE");
        launcher.spawnv([config.code, "--reuse-window", ...(cwd ? ["--", cwd] : [])]);
    } catch (e) { logError(e); }
}
heading.connect("activate", () => openCode());

function setLabel(item, label) {
    if (item.get_label() !== label) item.set_label(label);
}

function paint() {
    if (!indicator) return;
    const unknown = snapshot.status !== "ready" || snapshot.uncertain > 0;
    const color = snapshot.count > 0 ? (bright || !flash.active ? "blue" : "blue-dim") : unknown ? "gray" : "green";
    const description = Menu.activityDescription(snapshot);
    const label = snapshot.status !== "ready" ? "?" : `${snapshot.count}${snapshot.uncertain ? "?" : ""}`;
    const visual = `${color}:${label}:${description}`;
    if (visual !== lastVisual) {
        indicator.set_icon_full(composedIcon(color, label), description);
        indicator.set_label("", "");
        lastVisual = visual;
    }
    if (description !== lastDescription) {
        indicator.set_title(description);
        lastDescription = description;
    }
    setLabel(heading, config.code ? `Open VS Code (${description})` : `VS Code launcher unavailable (${description})`);
}
flash.connect("toggled", () => { bright = true; paint(); });

function update(data) {
    snapshot = data;
    bright = true;
    const actions = Menu.workspaceActions(data.chats);
    const current = new Set(actions.map(action => action.cwd));
    for (const [cwd, item] of chatItems) {
        if (!current.has(cwd)) { item.destroy(); chatItems.delete(cwd); }
    }
    for (const [index, action] of actions.entries()) {
        let item = chatItems.get(action.cwd);
        if (!item) {
            item = new Gtk.MenuItem({ label: action.label, sensitive: !!config.code });
            item.set_tooltip_text(`Open this workspace in VS Code: ${action.cwd}`);
            item.get_accessible().set_property("accessible-description", `Open this workspace in VS Code: ${action.cwd}`);
            item.connect("activate", () => openCode(action.cwd));
            menu.insert(item, 1 + index);
            chatItems.set(action.cwd, item);
        }
        setLabel(item, action.label);
        if (menu.get_children().indexOf(item) !== 1 + index) menu.reorder_child(item, 1 + index);
    }
    menu.show_all();
    paint();
}

function startReader() {
    try {
        worker = Gio.Subprocess.new([config.python, "-u", GLib.build_filenamev([root, "lib", "activity.py"]), config.home],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        stream = new Gio.DataInputStream({ base_stream: worker.get_stdout_pipe() });
        function read() {
            stream.read_line_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
                try {
                    const [line] = source.read_line_finish_utf8(result);
                    if (line === null) throw new Error("Activity reader stopped");
                    const data = JSON.parse(line);
                    if (!Number.isInteger(data.count) || data.count < 0 || !Number.isInteger(data.uncertain) || !Array.isArray(data.chats))
                        throw new Error("Invalid activity snapshot");
                    lastRead = GLib.get_monotonic_time();
                    update(data);
                    read();
                } catch (e) {
                    update({ status: "unavailable", count: 0, uncertain: 0, chats: [] });
                    Gtk.main_quit();
                }
            });
        }
        read();
    } catch (e) { logError(e); Gtk.main_quit(); }
}

// A session-bus name prevents duplicate icons from multiple VS Code windows.
const owner = Gio.bus_own_name(Gio.BusType.SESSION, "com.karotechnica.CodexActivity",
    config.bootstrap ? Gio.BusNameOwnerFlags.ALLOW_REPLACEMENT : Gio.BusNameOwnerFlags.REPLACE,
    null, () => {
        indicator = AppIndicator.Indicator.new("codex-activity", icon("gray"), AppIndicator.IndicatorCategory.APPLICATION_STATUS);
        indicator.set_title("Codex activity");
        menu.show_all();
        indicator.set_menu(menu);
        indicator.set_status(AppIndicator.IndicatorStatus.ACTIVE);
        paint();
        startReader();
        timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 650, () => {
            if (config.bootstrap && Number.isInteger(config.parentPid) &&
                !GLib.file_test(`/proc/${config.parentPid}`, GLib.FileTest.IS_DIR)) {
                Gtk.main_quit();
                return GLib.SOURCE_REMOVE;
            }
            bright = !bright;
            if (GLib.get_monotonic_time() - lastRead > 10000000) {
                snapshot = { status: "unavailable", count: 0, uncertain: 0, chats: [] };
            }
            paint();
            return GLib.SOURCE_CONTINUE;
        });
    }, () => Gtk.main_quit());
for (const signal of [2, 15]) GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal, () => { Gtk.main_quit(); return GLib.SOURCE_REMOVE; });
Gtk.main();
if (timeout) GLib.source_remove(timeout);
if (worker) worker.force_exit();
if (indicator) indicator.set_status(AppIndicator.IndicatorStatus.PASSIVE);
Gio.bus_unown_name(owner);
for (const filename of generatedIcons.values()) GLib.unlink(filename);
GLib.rmdir(iconDirectory);
