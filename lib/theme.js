"use strict";

// Relative luminance and 4.5:1 small-text target: W3C WCAG 2.2, Contrast Minimum.
function contrastRatio(a, b) {
  const luminance = hex => {
    const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i+2), 16) / 255)
      .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return rgb[0]*0.2126 + rgb[1]*0.7152 + rgb[2]*0.0722;
  };
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function readableText(background, preferred, foreground) {
  const candidates = [preferred, foreground, "#ffffff", "#000000"];
  return candidates.find(color => contrastRatio(background, color) >= 4.5) ||
    candidates.sort((a, b) => contrastRatio(background, b) - contrastRatio(background, a))[0];
}
// GTK uses resolved values, never VS Code CSS variables or arbitrary CSS.
function appearance(kind = 2, tokens = {}) {
  const light = kind === 1 || kind === 4;
  const contrast = kind === 3 || kind === 4;
  const fallback = light ? {
    background: "#ffffff", foreground: "#202020", muted: "#616161", inset: "#f3f3f3",
    border: contrast ? "#000000" : "#cecece", button: "#005fb8", buttonText: "#ffffff", hover: "#004c93"
  } : {
    background: contrast ? "#000000" : "#252526", foreground: "#ffffff", muted: "#cccccc", inset: "#1e1e1e",
    border: contrast ? "#ffffff" : "#454545", button: "#0078d4", buttonText: "#ffffff", hover: "#026ec1"
  };
  fallback.insetForeground = fallback.foreground;
  const result = { ...fallback, fontFamily: "sans-serif", fontSize: 13 };
  for (const key of Object.keys(fallback)) {
    const value = tokens?.[key];
    if (typeof value === "string" && /^#[\da-f]{6}$/i.test(value)) result[key] = value;
  }
  // Missing optional tokens must inherit the resolved palette, not a generic gray.
  if (!/^#[\da-f]{6}$/i.test(tokens?.inset || "")) result.inset = result.background;
  if (!/^#[\da-f]{6}$/i.test(tokens?.insetForeground || "")) result.insetForeground = result.foreground;
  // When the webview has no complete button palette, use the resolved card
  // palette instead of mixing a generic blue with custom theme text.
  if (!/^#[\da-f]{6}$/i.test(tokens?.button || "") || !/^#[\da-f]{6}$/i.test(tokens?.buttonText || "")) {
    result.button = result.inset;
    result.buttonText = result.insetForeground;
    result.hover = result.background;
  }
  if (!/^#[\da-f]{6}$/i.test(tokens?.hover || "")) result.hover = result.button;
  result.buttonText = readableText(result.button, result.buttonText, result.foreground);
  result.hoverText = readableText(result.hover, result.buttonText, result.foreground);
  // Use one family; reject CSS syntax, quotes and control characters.
  if (typeof tokens?.fontFamily === "string" && /^[\p{L}\p{N} ._-]{1,80}$/u.test(tokens.fontFamily)) result.fontFamily = tokens.fontFamily;
  if (Number.isFinite(tokens?.fontSize)) result.fontSize = Math.max(10, Math.min(22, tokens.fontSize));
  return result;
}

function gtkCss(theme) {
  const t = appearance(2, theme);
  return `
    .toast-card { background-color: ${t.background}; border-color: ${t.border}; font-family: "${t.fontFamily}"; }
    .header-project { color: ${t.foreground}; }
    .preview-label { color: ${t.insetForeground}; font-size: ${t.fontSize}px; background-color: transparent; background-image: none; }
    .header-sub, .footer-meta, .close-btn { color: ${t.muted}; }
    .preview-box { background-color: ${t.inset}; background-image: none; }
    .toast-card button.action-pill { background-image: none; background-color: ${t.button}; color: ${t.buttonText}; border: 1px solid ${t.border}; box-shadow: none; text-shadow: none; opacity: 1; }
    .toast-card button.action-pill label { color: ${t.buttonText}; text-shadow: none; }
    .toast-card button.action-pill:hover, .toast-card button.action-pill:active, .toast-card button.action-pill:checked { background-image: none; background-color: ${t.hover}; color: ${t.hoverText}; box-shadow: none; }
    .toast-card button.action-pill:hover label, .toast-card button.action-pill:active label, .toast-card button.action-pill:checked label { color: ${t.hoverText}; text-shadow: none; }
    .close-btn:hover { background-color: ${t.inset}; color: ${t.foreground}; }
  `;
}

module.exports = { appearance, gtkCss, contrastRatio };
