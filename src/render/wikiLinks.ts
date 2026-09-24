/*
 * Wiki links, as Obsidian and other note apps write them:
 *
 *     [[Page]]  [[Page|shown text]]  [[Page#Heading]]  [[#Heading]]  ![[image.png]]
 *
 * A page is a Markdown file: `Page` links to `Page.md` next to the document
 * (the host looks for it elsewhere in the workspace when it is not there).
 * No VS Code API: unit tested.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import type { MarkdownIt } from 'markdown-it';
import { SlugRegistry } from './slugify';

const IMAGE = /\.(png|jpe?g|gif|svg|webp|avif|bmp)$/i;
const HAS_EXTENSION = /\.[a-z0-9]{1,8}$/i;

export interface WikiLink {
  href: string;
  label: string;
  image: boolean;
}

/** What `[[inner]]` points to; undefined when it is not a wiki link. */
export function parseWikiLink(inner: string, embed = false): WikiLink | undefined {
  if (!inner.trim() || /[[\]\n]/.test(inner)) {
    return undefined;
  }
  const bar = inner.indexOf('|');
  const target = (bar < 0 ? inner : inner.slice(0, bar)).trim();
  const alias = bar < 0 ? '' : inner.slice(bar + 1).trim();
  const hash = target.indexOf('#');
  const page = (hash < 0 ? target : target.slice(0, hash)).trim();
  const heading = hash < 0 ? '' : target.slice(hash + 1).trim();
  if (!page && !heading) {
    return undefined;
  }
  if (embed && IMAGE.test(page)) {
    return { href: encodeURI(page), label: alias || page, image: true };
  }
  const file = page && !HAS_EXTENSION.test(page) ? `${page}.md` : page;
  const fragment = heading ? `#${new SlugRegistry().unique(heading)}` : '';
  const label = alias || [page, heading].filter(Boolean).join(' › ');
  return { href: encodeURI(file) + fragment, label, image: false };
}

export function wikiLinks(md: MarkdownIt): void {
  md.inline.ruler.before('link', 'wiki_link', (state, silent) => {
    const { src, pos } = state;
    const embed = src.charCodeAt(pos) === 0x21 /* ! */;
    const start = embed ? pos + 1 : pos;
    if (!src.startsWith('[[', start)) {
      return false;
    }
    const end = src.indexOf(']]', start + 2);
    const link = end < 0 ? undefined : parseWikiLink(src.slice(start + 2, end), embed);
    if (!link) {
      return false;
    }
    if (!silent) {
      if (link.image) {
        const image = state.push('image', 'img', 0);
        image.attrs = [['src', link.href], ['alt', '']];
        const alt = new state.Token('text', '', 0);
        alt.content = link.label;
        image.children = [alt];
        image.content = link.label;
      } else {
        const open = state.push('link_open', 'a', 1);
        open.attrs = [['href', link.href], ['class', 'folio-wikilink']];
        state.push('text', '', 0).content = link.label;
        state.push('link_close', 'a', -1);
      }
    }
    state.pos = end + 2;
    return true;
  });
}
