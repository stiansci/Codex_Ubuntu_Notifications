#!/usr/bin/env gjs

imports.gi.versions.Gtk = "3.0";
imports.gi.versions.Gdk = "3.0";
imports.gi.versions.GdkPixbuf = "2.0";
imports.gi.versions.Pango = "1.0";

const { Gtk, Gdk, GdkPixbuf, Pango, GLib } = imports.gi;

// Force X11 backend so window.move(x, y) can position at bottom-left on Wayland/XWayland
GLib.setenv("GDK_BACKEND", "x11", true);

Gtk.init(null);

const disp = Gdk.Display.get_default();
const mon = disp.get_primary_monitor() || disp.get_monitor(0);
const workarea = mon.get_workarea();
const maxHeight = Math.max(1, Math.floor(workarea.height / 3));

function parsePayload() {
  try {
    if (ARGV.length > 0 && ARGV[0]) {
      return JSON.parse(ARGV[0]);
    }
  } catch (e) {}
  return {};
}

const payload = parsePayload();
const workspaceLabel = payload.workspaceLabel || "Workspace";
const workspacePath = payload.workspacePath || "";
const turnTitle = payload.title || "Turn completed";
const rawMessage = payload.message || "Finished answering your request.";
const iconPath = payload.iconPath || "";
const codeBin = typeof payload.codeBin === "string" ? payload.codeBin : "";
const durationSec = Math.max(2, Math.min(30, Number(payload.durationSec) || 7));

// Shared safe Markdown renderer; preserve original card layout.
imports.searchPath.unshift(GLib.build_filenamev([GLib.path_get_dirname(imports.system.programPath), 'lib']));
const Markdown = imports.notificationMarkdown;

const win = new Gtk.Window({
  type: Gtk.WindowType.POPUP
});
win.set_decorated(false);
win.set_skip_taskbar_hint(true);
win.set_skip_pager_hint(true);
win.set_keep_above(true);
win.set_accept_focus(false);
win.set_focus_on_map(false);
win.set_resizable(false);
win.set_app_paintable(true);

const screen = win.get_screen();
const visual = screen.get_rgba_visual();
if (visual) {
  win.set_visual(visual);
}

const cssProvider = new Gtk.CssProvider();
const css = `
  window {
    background-color: transparent;
  }
  .notification-viewport, .notification-viewport viewport {
    background-color: transparent;
    border: none;
    padding: 0;
  }
  .outer-frame {
    padding: 10px 14px 14px 14px;
    background-color: transparent;
  }
  .toast-card {
    background-color: #ffffff;
    border-radius: 18px;
    border: 1px solid rgba(15, 23, 42, 0.09);
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
    padding: 15px 18px 13px 18px;
  }
  .header-project {
    color: #334155;
    font-weight: 700;
    font-size: 14px;
  }
  .header-sub {
    color: #64748b;
    font-weight: 400;
    font-size: 12.5px;
  }
  .close-btn {
    background: transparent;
    border: none;
    border-radius: 99px;
    padding: 4px 7px;
    color: #64748b;
    font-size: 14px;
    font-weight: 700;
    box-shadow: none;
  }
  .close-btn:hover {
    background-color: #f1f5f9;
    color: #0f172a;
  }
  .preview-box {
    background-color: #f1f5f4;
    border-radius: 12px;
    padding: 13px 15px;
    margin-top: 10px;
    margin-bottom: 11px;
  }
  .preview-label {
    color: #1e293b;
    font-size: 14.5px;
  }
  .footer-meta {
    color: #64748b;
    font-size: 12px;
  }
  .action-pill {
    background-color: #e2f5ea;
    color: #0d6847;
    border-radius: 9px;
    border: none;
    padding: 5px 12px;
    font-weight: 600;
    font-size: 12px;
    box-shadow: none;
  }
  .action-pill:hover {
    background-color: #d0eedc;
  }
`;
cssProvider.load_from_data(css + (typeof payload.themeCss === "string" ? payload.themeCss : ""));
Gtk.StyleContext.add_provider_for_screen(
  screen,
  cssProvider,
  Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
);

const outer = new Gtk.Box({
  orientation: Gtk.Orientation.VERTICAL
});
outer.get_style_context().add_class("outer-frame");

const card = new Gtk.Box({
  orientation: Gtk.Orientation.VERTICAL,
  spacing: 0
});
card.get_style_context().add_class("toast-card");
card.set_size_request(390, -1);

// Header row
const headerRow = new Gtk.Box({
  orientation: Gtk.Orientation.HORIZONTAL,
  spacing: 9
});

if (iconPath && GLib.file_test(iconPath, GLib.FileTest.EXISTS)) {
  try {
    const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(iconPath, 26, 26, true);
    const img = Gtk.Image.new_from_pixbuf(pixbuf);
    img.set_valign(Gtk.Align.CENTER);
    headerRow.pack_start(img, false, false, 0);
  } catch (e) {}
}

const titleBox = new Gtk.Box({
  orientation: Gtk.Orientation.HORIZONTAL,
  spacing: 7
});
titleBox.set_valign(Gtk.Align.CENTER);

const projLabel = new Gtk.Label({
  label: workspaceLabel
});
projLabel.get_style_context().add_class("header-project");
projLabel.set_ellipsize(Pango.EllipsizeMode.END);
projLabel.set_max_width_chars(30);

const subLabel = new Gtk.Label({
  label: "Codex"
});
subLabel.get_style_context().add_class("header-sub");

titleBox.pack_start(projLabel, false, false, 0);
titleBox.pack_start(subLabel, false, false, 0);
headerRow.pack_start(titleBox, true, true, 0);

const closeBtn = new Gtk.Button({
  label: "✕"
});
closeBtn.get_style_context().add_class("close-btn");
closeBtn.set_valign(Gtk.Align.CENTER);
headerRow.pack_end(closeBtn, false, false, 0);

card.pack_start(headerRow, false, false, 0);

// Inner preview box (4 lines max)
const previewBox = new Gtk.Box({
  orientation: Gtk.Orientation.VERTICAL
});
previewBox.get_style_context().add_class("preview-box");

const previewLabel = new Gtk.Label();
previewLabel.get_style_context().add_class("preview-label");
previewLabel.set_use_markup(true);
// Measure an empty label first so a long answer never sizes the initial window.
previewLabel.set_markup("");
previewLabel.set_line_wrap(true);
previewLabel.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
previewLabel.set_lines(4);
previewLabel.set_ellipsize(Pango.EllipsizeMode.END);
previewLabel.set_xalign(0);
previewLabel.set_yalign(0);
previewLabel.set_max_width_chars(44);
previewLabel.set_width_chars(40);

previewBox.pack_start(previewLabel, false, false, 0);
card.pack_start(previewBox, false, false, 0);

// Footer row
const footerRow = new Gtk.Box({
  orientation: Gtk.Orientation.HORIZONTAL,
  spacing: 8
});

const shortTurnTitle =
  turnTitle.length > 34 ? turnTitle.slice(0, 33) + "…" : turnTitle;
const footerMeta = new Gtk.Label({
  label: `+ ${shortTurnTitle}`
});
footerMeta.get_style_context().add_class("footer-meta");
footerMeta.set_ellipsize(Pango.EllipsizeMode.END);
footerMeta.set_xalign(0);
footerMeta.set_valign(Gtk.Align.CENTER);
footerRow.pack_start(footerMeta, true, true, 0);

const actionBtn = new Gtk.Button({
  label: "VS Code ↗"
});
actionBtn.get_style_context().add_class("action-pill");
actionBtn.set_valign(Gtk.Align.CENTER);
footerRow.pack_end(actionBtn, false, false, 0);

card.pack_start(footerRow, false, false, 0);
outer.pack_start(card, false, false, 0);
// Bound the complete popup independently of Gtk.Label's per-paragraph line
// handling. EXTERNAL permits clipping without displaying a scrollbar.
const frame = new Gtk.ScrolledWindow();
frame.get_style_context().add_class("notification-viewport");
frame.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.EXTERNAL);
frame.set_shadow_type(Gtk.ShadowType.NONE);
frame.set_propagate_natural_height(false);
frame.set_min_content_height(0);
frame.set_max_content_height(maxHeight);
frame.add(outer);
win.add(frame);

win.set_opacity(0.0);
win.show_all();

// Reserve the measured header, footer, padding and borders before fitting text.
const [, natRequisition] = outer.get_preferred_size();
const winWidth = natRequisition.width || 418;
const emptyLabelHeight = previewLabel.get_preferred_height_for_width(winWidth)[1];
const chromeHeight = outer.get_preferred_height_for_width(winWidth)[1] - emptyLabelHeight;
const textBudget = Math.max(0, maxHeight - chromeHeight - 2);
let horizontalPadding = 0;
for (const widget of [outer, card, previewBox]) {
  const style = widget.get_style_context();
  const padding = style.get_padding(Gtk.StateFlags.NORMAL);
  const border = style.get_border(Gtk.StateFlags.NORMAL);
  horizontalPadding += padding.left + padding.right + border.left + border.right;
}
const textWidth = Math.max(1, winWidth - horizontalPadding);
const measure = previewLabel.create_pango_layout("");
measure.set_width(textWidth * Pango.SCALE);
measure.set_wrap(Pango.WrapMode.WORD_CHAR);
measure.set_ellipsize(Pango.EllipsizeMode.NONE);
function fits(text) {
  measure.set_markup(Markdown.render(text), -1);
  return measure.get_pixel_size()[1] <= textBudget && measure.get_line_count() <= 4;
}
let fittedMessage = Markdown.previewText(rawMessage);
if (!fits(fittedMessage)) {
  const characters = Array.from(fittedMessage);
  let lo = 0, hi = characters.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(characters.slice(0, mid).join("").trimEnd() + "…")) lo = mid;
    else hi = mid - 1;
  }
  fittedMessage = characters.slice(0, lo).join("").trimEnd() + "…";
  // Markdown boundaries can change wrapping non-monotonically as text is cut.
  while (lo > 0 && !fits(fittedMessage)) {
    lo--;
    fittedMessage = characters.slice(0, lo).join("").trimEnd() + "…";
  }
  if (!fits(fittedMessage)) fittedMessage = "";
}
previewLabel.set_width_chars(-1);
previewLabel.set_max_width_chars(-1);
previewLabel.set_size_request(textWidth, -1);
previewLabel.set_markup(fittedMessage ? Markdown.render(fittedMessage) : "");
if (!textBudget) previewBox.hide();
const winHeight = Math.min(maxHeight, Math.max(1, outer.get_preferred_height_for_width(winWidth)[1]));
frame.set_size_request(winWidth, winHeight);
win.resize(winWidth, winHeight);

const targetX = workarea.x + 22;
const targetY = workarea.y + workarea.height - winHeight - 22;
const startY = targetY + 34;

win.move(targetX, startY);

let animStep = 0;
const totalSteps = 16;
let closing = false;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Slide-up + fade-in @ 60fps (~250ms)
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 15, () => {
  if (closing) {
    return GLib.SOURCE_REMOVE;
  }
  animStep++;
  const progress = Math.min(1.0, animStep / totalSteps);
  const eased = easeOutCubic(progress);
  const curY = Math.round(startY + (targetY - startY) * eased);
  win.move(targetX, curY);
  win.set_opacity(eased);
  return progress < 1.0 ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
});

function startCloseAnimation() {
  if (closing) {
    return;
  }
  closing = true;
  let closeStep = 0;
  const closeTotal = 12;
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 15, () => {
    closeStep++;
    const p = Math.min(1.0, closeStep / closeTotal);
    const curY = Math.round(targetY + 24 * p);
    win.move(targetX, curY);
    win.set_opacity(Math.max(0.0, 1.0 - p));
    if (p >= 1.0) {
      Gtk.main_quit();
      return GLib.SOURCE_REMOVE;
    }
    return GLib.SOURCE_CONTINUE;
  });
}

closeBtn.connect("clicked", () => {
  startCloseAnimation();
});

actionBtn.connect("clicked", () => {
  try {
    if (!codeBin || !GLib.path_is_absolute(codeBin)) return;
    if (workspacePath) {
      GLib.spawn_async(
        null,
        [codeBin, "--reuse-window", "--", workspacePath],
        null,
        GLib.SpawnFlags.SEARCH_PATH,
        null
      );
    } else {
      GLib.spawn_async(null, [codeBin, "--reuse-window"], null, GLib.SpawnFlags.DEFAULT, null);
    }
  } catch (e) { log("Unable to open VS Code"); }
  startCloseAnimation();
});

GLib.timeout_add(GLib.PRIORITY_DEFAULT, durationSec * 1000, () => {
  startCloseAnimation();
  return GLib.SOURCE_REMOVE;
});

Gtk.main();
