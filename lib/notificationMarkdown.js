// Deliberately limited Markdown subset, rendered as escaped Pango markup.
function escape(text) {
  return imports.gi.GLib.markup_escape_text(String(text), -1);
}

// Normalize links before fitting, keeping destinations out of truncated text.
function linkLabels(text, onLink = () => {}) {
  const tokens = /`[^`\n]+`|!?\[([^\]\n]+)\]\(/g;
  let result = '', end = 0;
  for (const match of text.matchAll(tokens)) {
    if (match.index < end || match[0].startsWith('`')) continue;
    let cursor = match.index + match[0].length;
    let depth = 1;
    for (; cursor < text.length && text[cursor] !== '\n'; cursor++) {
      if (text[cursor] === '\\') { cursor++; continue; }
      if (text[cursor] === '(') depth++;
      if (text[cursor] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) continue;
    onLink(text.slice(match.index + match[0].length, cursor), match[1]);
    result += text.slice(end, match.index) + match[1];
    end = cursor + 1;
  }
  return result + text.slice(end);
}

function inline(text) {
  text = linkLabels(text);
  const tokens = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|__[^_\n]+__|_[^_\n]+_)/g;
  let result = '';
  let end = 0;
  for (const match of text.matchAll(tokens)) {
    result += escape(text.slice(end, match.index));
    const token = match[0];
    if (token.startsWith('`')) result += `<tt>${escape(token.slice(1, -1))}</tt>`;
    else if (token.startsWith('**') || token.startsWith('__')) result += `<b>${escape(token.slice(2, -2))}</b>`;
    else result += `<i>${escape(token.slice(1, -1))}</i>`;
    end = match.index + token.length;
  }
  return result + escape(text.slice(end));
}

// A narrow desktop card cannot preserve Markdown table columns. Turn each
// data row into a self-contained list of named values before fitting it.
function previewText(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '')
    .split(/(?<!\\)\|/).map(cell => cell.replace(/\\\|/g, '|').trim());
  const separator = line => {
    if (!line.includes('|')) return false;
    const parts = cells(line);
    return parts.length > 1 && parts.every(part => /^:?-{3,}:?$/.test(part));
  };
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) {
      fenced = !fenced;
      output.push(lines[i]);
      continue;
    }
    if (fenced) {
      output.push(lines[i]);
      continue;
    }
    lines[i] = linkLabels(lines[i]);
    if (i + 1 >= lines.length || !lines[i].includes('|') || !separator(lines[i + 1])) {
      output.push(lines[i]);
      continue;
    }
    const headers = cells(lines[i]);
    i++;
    let rows = 0;
    while (i + 1 < lines.length && lines[i + 1].includes('|')) {
      const values = cells(linkLabels(lines[++i]));
      output.push('• ' + headers.map((header, index) =>
        `${header || `Column ${index + 1}`}: ${values[index] || '–'}`).join('  ·  '));
      rows++;
    }
    if (!rows) output.push(headers.join('  ·  '));
  }
  return output.join('\n');
}

function render(text) {
  let fenced = false;
  const lines = String(text || 'Risposta completata.').replace(/\r\n?/g, '\n').split('\n');
  return lines.map(line => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return null;
    }
    if (fenced) return `<tt>${escape(line)}</tt>`;
    if (/^#{1,6}\s+/.test(line)) return `<b>${inline(line.replace(/^#{1,6}\s+/, ''))}</b>`;
    if (/^\s*[-*+]\s+/.test(line)) return '  •  ' + inline(line.replace(/^\s*[-*+]\s+/, ''));
    if (/^\s*>\s?/.test(line)) return '<i>' + inline(line.replace(/^\s*>\s?/, '')) + '</i>';
    return inline(line);
  }).filter(line => line !== null).join('\n');
}

if (typeof module !== "undefined") module.exports = { linkLabels };
