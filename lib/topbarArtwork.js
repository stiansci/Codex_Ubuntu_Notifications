"use strict";

// A wide icon preserves count | logo order on Ubuntu AppIndicators, whose
// separate native label is always placed after the icon.
function compose(label, logoSvg) {
  if (!/^[0-9?]{1,12}$/.test(label)) throw new Error("Invalid activity label");
  const path = logoSvg.match(/<path\b[\s\S]*?\/>/g)?.join("");
  if (!path) throw new Error("Missing activity icon geometry");
  const textWidth = Math.max(10, label.length * 9);
  const logoX = textWidth + 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${logoX + 20}" height="20" viewBox="0 0 ${logoX + 20} 20">
<text x="${textWidth}" y="15" text-anchor="end" font-family="sans-serif" font-weight="600" font-size="14" fill="#f8fafc">${label}</text>
<path d="M${textWidth + 8} 3v14" stroke="#f8fafc" stroke-opacity="0.55" stroke-width="1"/>
<g transform="translate(${logoX},0) scale(0.8333333333)">${path}</g>
</svg>\n`;
}
if (typeof module !== "undefined") module.exports = { compose };
