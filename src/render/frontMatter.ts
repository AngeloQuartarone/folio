/*
 * Front matter shown as a quiet header (folio.frontMatter: "show"): the
 * simple `key: value` and list entries of YAML, or `key = value` of TOML.
 * Nested values are shown as written. No VS Code API: unit tested.
 * Copyright (c) 2026 Angelo Quartarone.
 */

export interface FrontMatter {
  /** Lines it takes, fences included. */
  lines: number;
  entries: Array<{ key: string; value: string | string[] }>;
}

const unquote = (value: string) => value.trim().replace(/^(["'])(.*)\1$/, '$2');

/** The front matter at the start of `text`, if there is one. */
export function parseFrontMatter(text: string): FrontMatter | undefined {
  const lines = text.split(/\r?\n/);
  const fence = /^(---|\+\+\+)[ \t]*$/.exec(lines[0] ?? '')?.[1];
  if (!fence) {
    return undefined;
  }
  const closing = fence === '---' ? /^(---|\.\.\.)[ \t]*$/ : /^\+\+\+[ \t]*$/;
  const end = lines.findIndex((line, i) => i > 0 && closing.test(line));
  if (end < 0) {
    return undefined;
  }
  const entries: FrontMatter['entries'] = [];
  const separator = fence === '---' ? /^([A-Za-z0-9_][\w .-]*?)\s*:\s?(.*)$/ : /^([A-Za-z0-9_][\w.-]*)\s*=\s*(.*)$/;
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    const entry = /^\s/.test(line) ? null : separator.exec(line);
    if (entry) {
      const raw = entry[2].trim();
      const list = /^\[(.*)\]$/.exec(raw);
      entries.push({
        key: entry[1],
        value: list ? list[1].split(',').map(unquote).filter(Boolean) : unquote(raw),
      });
      continue;
    }
    const last = entries[entries.length - 1];
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (last && item && (Array.isArray(last.value) || last.value === '')) {
      last.value = [...(Array.isArray(last.value) ? last.value : []), unquote(item[1])];
    } else if (last && line.trim() && !Array.isArray(last.value)) {
      last.value = `${last.value}${last.value ? ' ' : ''}${line.trim()}`;
    }
  }
  return { lines: end + 1, entries: entries.filter((entry) => entry.value.length > 0) };
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The header: one row per entry, lists as small tags. */
export function frontMatterHtml(frontMatter: FrontMatter): string {
  if (!frontMatter.entries.length) {
    return '';
  }
  const rows = frontMatter.entries.map(({ key, value }) => {
    const shown = Array.isArray(value)
      ? value.map((item) => `<span class="folio-tag">${escape(item)}</span>`).join(' ')
      : escape(value);
    return `<div><dt>${escape(key)}</dt><dd>${shown}</dd></div>`;
  });
  return `<dl class="folio-front-matter" data-source-line="1" data-source-end="${frontMatter.lines}">${rows.join('')}</dl>\n`;
}
