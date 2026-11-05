"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { appearance, gtkCss } = require("../lib/theme");

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
