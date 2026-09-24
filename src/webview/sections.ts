/*
 * Folding sections: an arrow next to each heading hides everything up to the
 * next heading of the same or a higher level. What is folded is remembered
 * per document, so it survives edits and reloads of the preview.
 * Copyright (c) 2026 Angelo Quartarone.
 */
import type { StateStore } from './reading';

const HEADING = /^H([1-6])$/;

function level(element: Element): number {
  const match = HEADING.exec(element.tagName);
  return match ? Number(match[1]) : 0;
}

export class Sections {
  private uri = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly state: StateStore,
    /** The layout changed: scroll map, note pins… */
    private readonly onChange: () => void,
  ) {}

  /** After a render: an arrow on every heading, and the folds applied again. */
  refresh(uri: string): void {
    this.uri = uri;
    for (const heading of Array.from(this.root.children)) {
      if (!level(heading) || !heading.id || heading.querySelector(':scope > .folio-fold')) {
        continue;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'folio-fold';
      button.setAttribute('aria-label', 'Fold section');
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.toggle(heading.id);
      });
      heading.prepend(button);
    }
    this.apply();
  }

  /** Unfold whatever hides `element` (a link target, a note, a heading). */
  reveal(element: Element): void {
    let block: Element | null = element;
    while (block && block.parentElement !== this.root) {
      block = block.parentElement;
    }
    if (!block) {
      return;
    }
    const folded = new Set(this.folded());
    let below = level(block) || 7;
    let changed = false;
    for (let sibling = block.previousElementSibling; sibling && below > 1; sibling = sibling.previousElementSibling) {
      const sectionLevel = level(sibling);
      if (sectionLevel && sectionLevel < below) {
        changed = folded.delete(sibling.id) || changed;
        below = sectionLevel;
      }
    }
    if (changed) {
      this.save([...folded]);
      this.apply();
      this.onChange();
    }
  }

  private toggle(id: string): void {
    const folded = new Set(this.folded());
    if (!folded.delete(id)) {
      folded.add(id);
    }
    this.save([...folded]);
    this.apply();
    this.onChange();
  }

  private apply(): void {
    const folded = new Set(this.folded());
    let foldedAt = 0; // level of the folded heading being passed, 0 when none
    for (const element of Array.from(this.root.children)) {
      const headingLevel = level(element);
      if (foldedAt && headingLevel && headingLevel <= foldedAt) {
        foldedAt = 0;
      }
      element.classList.toggle('folio-folded', foldedAt > 0);
      if (!foldedAt && headingLevel) {
        const isFolded = folded.has(element.id);
        element.classList.toggle('folio-collapsed', isFolded);
        const button = element.querySelector(':scope > .folio-fold');
        button?.setAttribute('aria-expanded', String(!isFolded));
        button?.setAttribute('aria-label', isFolded ? 'Unfold section' : 'Fold section');
        if (isFolded) {
          foldedAt = headingLevel;
        }
      }
    }
  }

  private folded(): string[] {
    return this.state.get<Record<string, string[]>>('folded')?.[this.uri] ?? [];
  }

  private save(ids: string[]): void {
    const all = { ...this.state.get<Record<string, string[]>>('folded') };
    if (ids.length) {
      all[this.uri] = ids;
    } else {
      delete all[this.uri];
    }
    this.state.set('folded', all);
  }
}
