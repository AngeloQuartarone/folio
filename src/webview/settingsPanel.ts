/*
 * The full settings view, opened from the quick panel: every setting,
 * grouped in sections, plus the offline languages.
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * It covers the preview. Settings that restyle the preview reload the
 * webview, so the open section is kept in the webview state and the view
 * reopens on it.
 */
import type { LanguageStatus, SettingSection } from '../messages';
import { Post, button, settingRow } from './settingControls';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Sidebar icons (24×24 outline paths), drawn white on a coloured tile. */
const SECTION_ICONS: Record<string, string> = {
  appearance: 'M12 3a9 9 0 1 0 0 18V3zm0 0a9 9 0 0 1 0 18',
  reading: 'M3 5.5C5 4.5 8.5 4.5 12 6.5c3.5-2 7-2 9-1V19c-2-1-5.5-1-9 1-3.5-2-7-2-9-1V5.5zM12 6.5V20',
  translation: 'M4 5h9M8.5 3v2m3 0c-1 4-3.5 7-7 9m2.5-5c1.5 2.5 3.5 4 6 5M13 21l4-9 4 9m-6.8-3h5.6',
  languages: 'M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  preview: 'M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  export: 'M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7',
};

export interface ViewState {
  get(): string | undefined;
  set(section: string | undefined): void;
}

export class SettingsPanel {
  private readonly element: HTMLDivElement;
  private readonly nav: HTMLElement;
  private readonly content: HTMLElement;
  private sections: SettingSection[];
  private languages: LanguageStatus[] = [];
  private current: string | undefined;

  constructor(
    private readonly post: Post,
    sections: SettingSection[],
    private readonly state: ViewState,
    private readonly copyFormatted: () => void,
  ) {
    this.sections = sections;
    // A dimmed, blurred backdrop with a centered window, like a macOS sheet.
    this.element = document.createElement('div');
    this.element.className = 'mtp-ui mtp-settings';
    this.element.hidden = true;
    this.element.addEventListener('mousedown', (event) => {
      if (event.target === this.element) {
        this.close();
      }
    });

    const sheet = document.createElement('div');
    sheet.className = 'mtp-settings-window';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Settings');

    const sidebar = document.createElement('aside');
    sidebar.className = 'mtp-settings-sidebar';
    const title = document.createElement('div');
    title.className = 'mtp-settings-title';
    title.textContent = 'Settings';
    this.nav = document.createElement('nav');
    this.nav.className = 'mtp-settings-nav';
    const vscodeSettings = button(
      'VS Code settings',
      () => this.post({ type: 'command', command: 'openSettings' }),
      'mtp-link mtp-settings-vscode',
    );
    sidebar.append(title, this.nav, vscodeSettings);

    this.content = document.createElement('section');
    this.content.className = 'mtp-settings-content';

    sheet.append(sidebar, this.content);
    this.element.append(sheet);
    document.body.append(this.element);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.element.hidden) {
        this.close();
      }
    });

    const saved = state.get();
    if (saved && sections.some((section) => section.id === saved)) {
      this.open(saved);
    }
  }

  open(section = this.current ?? this.sections[0]?.id): void {
    this.current = section;
    this.state.set(section);
    this.element.hidden = false;
    document.body.classList.add('mtp-settings-open');
    this.render();
  }

  close(): void {
    this.element.hidden = true;
    document.body.classList.remove('mtp-settings-open');
    this.state.set(undefined);
  }

  setSections(sections: SettingSection[]): void {
    this.sections = sections;
    if (!this.element.hidden) {
      this.render();
    }
  }

  setLanguages(languages: LanguageStatus[]): void {
    this.languages = languages;
    if (!this.element.hidden) {
      this.render();
    }
  }

  private render(): void {
    this.nav.replaceChildren(
      ...this.sections.map((section) => {
        const item = button('', () => this.open(section.id), 'mtp-settings-tab');
        item.append(sectionIcon(section.id), document.createTextNode(section.title));
        item.dataset['section'] = section.id;
        item.setAttribute('aria-current', section.id === this.current ? 'page' : 'false');
        return item;
      }),
    );
    const section = this.sections.find((candidate) => candidate.id === this.current) ?? this.sections[0];
    if (!section) {
      return;
    }
    const scroll = this.content.scrollTop;
    const header = document.createElement('header');
    header.className = 'mtp-settings-header';
    const heading = document.createElement('h3');
    heading.textContent = section.title;
    const close = button('', () => this.close(), 'mtp-settings-close');
    close.title = 'Close (Esc)';
    close.setAttribute('aria-label', 'Close settings');
    header.append(heading, close);

    const children: HTMLElement[] = [header];
    if (section.items.length) {
      children.push(group(section.items.map((item) => settingRow(item, this.post))));
    }
    if (section.languages) {
      children.push(...this.languageRows());
    }
    if (section.exports) {
      const actions = document.createElement('div');
      actions.className = 'mtp-settings-actions';
      actions.append(
        button('Export PDF', () => this.post({ type: 'command', command: 'exportPdf' }), 'mtp-button mtp-button-primary'),
        button('Export HTML', () => this.post({ type: 'command', command: 'exportHtml' })),
        button('Copy as formatted text', () => this.copyFormatted()),
      );
      children.push(actions);
    }
    this.content.replaceChildren(...children);
    this.content.scrollTop = scroll;
  }

  private languageRows(): HTMLElement[] {
    const note = document.createElement('p');
    note.className = 'mtp-settings-note';
    note.textContent =
      'Translation runs on your computer. Each language is downloaded once (its models to and from English); ' +
      'removing it also removes its dictionaries.';
    const list = group([]);
    list.classList.add('mtp-languages');
    list.append(
      ...this.languages.map((language) => {
        const row = document.createElement('div');
        row.className = 'mtp-language';
        row.dataset['state'] = language.state;
        const name = document.createElement('span');
        name.className = 'mtp-language-name';
        name.textContent = language.label;
        const controls = document.createElement('span');
        controls.className = 'mtp-language-controls';
        switch (language.state) {
          case 'builtin':
            controls.append(status('Built in'));
            break;
          case 'downloading':
            controls.append(status('Downloading…'));
            break;
          case 'installed':
            controls.append(status('Installed'), this.languageButton(language, 'remove', 'Remove'));
            break;
          case 'partial':
            controls.append(
              this.languageButton(language, 'download', `Complete · ${language.size}`),
              this.languageButton(language, 'remove', 'Remove'),
            );
            break;
          case 'missing':
            controls.append(this.languageButton(language, 'download', `Download · ${language.size}`));
            break;
        }
        row.append(name, controls);
        return row;
      }),
    );
    return [note, list];
  }

  private languageButton(language: LanguageStatus, action: 'download' | 'remove', label: string): HTMLButtonElement {
    const element = button(
      label,
      () => {
        element.disabled = true;
        this.post({ type: 'languageModels', action, language: language.code });
      },
      `mtp-language-button mtp-language-${action}`,
    );
    element.title = `${action === 'download' ? 'Download' : 'Remove'} the ${language.label} models`;
    return element;
  }
}

/** Rows inside a rounded card, separated by hairlines. */
function group(rows: HTMLElement[]): HTMLDivElement {
  const element = document.createElement('div');
  element.className = 'mtp-group';
  element.append(...rows);
  return element;
}

function sectionIcon(id: string): HTMLSpanElement {
  const tile = document.createElement('span');
  tile.className = 'mtp-settings-icon';
  tile.dataset['section'] = id;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', SECTION_ICONS[id] ?? 'M12 12h.01');
  svg.append(path);
  tile.append(svg);
  return tile;
}

function status(text: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = 'mtp-language-status';
  element.textContent = text;
  return element;
}
