#!/usr/bin/env gjs
"use strict";
// Capture actual GTK widgets using synthetic content, without capturing the
// desktop or exposing the user's conversations. The top-bar images are previews.
imports.gi.versions.Gtk = "3.0";
imports.gi.versions.Gdk = "3.0";
const { Gtk, Gdk, GdkPixbuf, Gio, GLib } = imports.gi;
const ByteArray = imports.byteArray;
const root = GLib.path_get_dirname(GLib.path_get_dirname(imports.system.programPath));
imports.searchPath.unshift(GLib.build_filenamev([root, "lib"]));
const Artwork = imports.topbarArtwork;
const output = GLib.build_filenamev([root, "docs", "screenshots"]);
GLib.mkdir_with_parents(output, 0o755);
Gtk.init(null);
const temp = GLib.dir_make_tmp("codex-readme-XXXXXX");
let popup, panel;
let succeeded = false;

function saveWindow(window, filename) {
    const pixbuf = Gdk.pixbuf_get_from_window(window, 0, 0, window.get_width(), window.get_height());
    if (!pixbuf) throw new Error("Cannot capture widget");
    pixbuf.savev(GLib.build_filenamev([output, filename]), "png", [], []);
}

function panelPreview(color, label, next) {
    const [, bytes] = GLib.file_get_contents(GLib.build_filenamev([root, "media", `codex-${color}.svg`]));
    const file = GLib.build_filenamev([temp, `topbar-${color}.svg`]);
    GLib.file_set_contents(file, Artwork.compose(label, ByteArray.toString(bytes)));
    const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(file, -1, 40, true);
    panel = new Gtk.Window({ type: Gtk.WindowType.POPUP, name: "documentation-panel" });
    panel.set_accept_focus(false);
    panel.set_keep_above(true);
    const provider = new Gtk.CssProvider();
    provider.load_from_data("#documentation-panel { background-color: #1d1d1d; }");
    panel.get_style_context().add_provider(provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const box = new Gtk.Box({ margin: 20 });
    box.add(Gtk.Image.new_from_pixbuf(pixbuf));
    panel.add(box);
    panel.show_all();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 450, () => {
        try {
            saveWindow(panel.get_window(), `topbar-${color}.png`);
            panel.destroy(); panel = null;
            next();
        } catch (e) { logError(e); Gtk.main_quit(); }
        return GLib.SOURCE_REMOVE;
    });
}

const payload = { workspaceLabel: "Example project", title: "Update completed", durationSec: 20,
    message: "The requested changes are ready. **Checks passed**, and the extension has been reinstalled.",
    iconPath: GLib.build_filenamev([root, "codex-notifier.png"]) };
popup = Gio.Subprocess.new(["gjs", GLib.build_filenamev([root, "preview-overlay.js"]), "--stdin",
    "--screenshot", GLib.build_filenamev([output, "bottom-left-notification.png"])],
    Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDIN_PIPE);
popup.get_stdin_pipe().write_all(ByteArray.fromString(JSON.stringify(payload)), null);
popup.get_stdin_pipe().close(null);
popup.wait_check_async(null, (process, result) => {
    try {
        process.wait_check_finish(result);
        popup = null;
        panelPreview("blue", "2", () => panelPreview("green", "0", () => { succeeded = true; Gtk.main_quit(); }));
    } catch (e) { logError(e); Gtk.main_quit(); }
});
Gtk.main();
if (popup) popup.force_exit();
if (panel) panel.destroy();
for (const color of ["blue", "green"]) GLib.unlink(GLib.build_filenamev([temp, `topbar-${color}.svg`]));
GLib.rmdir(temp);
if (!succeeded) imports.system.exit(1);
print("Captured notification and two top-bar previews with synthetic content.");
