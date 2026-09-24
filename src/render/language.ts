/*
 * The language a Markdown document is written in, from its prose (without
 * front matter, Folio's notes, code and markup). Used to detect the source
 * language of short selections and to hyphenate justified text.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import { stripNotesBlock } from '../notes/notesBlock';
import { detectLanguage } from '../translation/offline/detect';
import { stripFrontMatter } from './plugins';

/** Up to 4000 characters of the document's prose. */
export function proseSample(markdown: string): string {
  return stripNotesBlock(stripFrontMatter(markdown))
    .replace(/^(```|~~~)[\s\S]*?^\1/gm, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/<[^>]+>|\]\([^)]*\)|[#>*_|[\]-]/g, ' ')
    .slice(0, 4000);
}

/** ISO 639-1 code of the document's language, when it is clear enough. */
export function documentLanguage(markdown: string): string | undefined {
  const detection = detectLanguage(proseSample(markdown));
  return detection.reliable ? detection.language : undefined;
}
