"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { appearance, gtkCss, validColors, resolvedColors } = require("../lib/theme");

test("fallback follows light, dark and high contrast, resolved tokens take priority", () => {
  assert.equal(appearance(1).background, "#ffffff");
  assert.equal(appearance(2).background, "#252526");
  assert.equal(appearance(3).border, "#ffffff");
  assert.equal(appearance(4).border, "#000000");
  const theme = appearance(2, { background: "#123456", fontFamily: "Ubuntu Sans", fontSize: 16 });
  assert.equal(theme.background, "#123456");
  assert.match(gtkCss(theme), /font-family: "Ubuntu Sans"/);
  assert.match(gtkCss(theme), /font-size: 16px/);
});

test("untrusted theme messages cannot inject GTK CSS and font sizes remain bounded", () => {
  const theme = appearance(2, { background: 'red; } window { opacity: 0;', fontFamily: '"; opacity: 0;', fontSize: 1000 });
  assert.equal(theme.background, "#252526");
  assert.equal(theme.fontFamily, "sans-serif");
  assert.equal(theme.fontSize, 22);
  assert.ok(!gtkCss(theme).includes('opacity: 0'));
});

test("custom hex overrides preserve exact chosen text colors and inherit unset defaults", () => {
  const base = appearance(1);
  const custom = { background: "#123456", badgeBackground: "#abcdef", badgeText: "#654321", button: "#ffffff", buttonText: "#eeeeee" };
  const css = gtkCss(base, custom);
  assert.match(css, /background-color: #123456/);
  assert.match(css, /\.codex-badge \{ background-color: #abcdef/);
  assert.match(css, /\.codex-badge \.header-sub \{ color: #654321/);
  assert.match(css, /color: #eeeeee/);
  assert.equal(resolvedColors(base, custom).working, "#d4a259");
  assert.equal(resolvedColors(base, { working: "#aa44ff" }).working, "#aa44ff");
  assert.equal(resolvedColors(base, {}).background, base.background);
});

test("color settings reject unsupported fields and CSS injection", () => {
  for (const colors of [null, [], "#abcdef", { background: "red" }, { working: "#abc" },
    { badgeBackground: "#fff; opacity: 0" }, { unknown: "#ffffff" }, JSON.parse('{"__proto__":"#ffffff"}')]) {
    assert.equal(validColors(colors), false);
  }
  assert.equal(validColors({}), true);
  assert.equal(validColors({ badgeBackground: "#ABCDEF" }), true);
});
