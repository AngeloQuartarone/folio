/*
 * Quick settings: a small gear button in the preview corner and its panel.
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * The button stays invisible until the mouse moves over the preview and
 * fades out again when idle. The panel holds only the everyday settings;
 * "All settings" opens the full settings view. The panel only asks the host
 * to change a setting or run a command; the host validates every request.
 */
import type { SettingSection, WebviewCommand } from '../messages';
import { Post, button, settingRow } from './settingControls';

const IDLE_MS = 2000;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** The settings shown in the panel, in this order. */
const QUICK_KEYS = ['previewTheme', 'translation.targetLanguage', 'translation.enabled', 'scrollSync'];

// Material "settings" icon path (Apache-2.0, Google).
const GEAR_PATH =
  'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.46.46 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z';

export class QuickSettings {
  private readonly button: HTMLButtonElement;
  private readonly panel: HTMLDivElement;
  private readonly rows: HTMLDivElement;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly post: Post,
    sections: SettingSection[],
    private readonly openAllSettings: () => void,
    private readonly copyFormatted: () => void,
    private readonly translateDocument: () => void,
  ) {
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'mtp-ui mtp-gear';
    this.button.title = 'Preview settings';
    this.button.setAttribute('aria-label', 'Preview settings');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.appendChild(gearIcon());
    this.button.addEventListener('click', () => this.toggle());

    this.panel = document.createElement('div');
    this.panel.className = 'mtp-ui mtp-panel';
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Preview settings');
    this.panel.hidden = true;

    this.rows = document.createElement('div');
    this.rows.className = 'mtp-panel-rows';
    this.setSections(sections);

    const actions = document.createElement('div');
    actions.className = 'mtp-panel-actions';
    actions.append(
      this.action('Export PDF', 'exportPdf'),
      this.action('Export HTML', 'exportHtml'),
      button(
        'Translate document',
        () => {
          this.close();
          this.translateDocument();
        },
        'mtp-button mtp-panel-wide',
      ),
      button(
        'Copy as formatted text',
        () => {
          this.close();
          this.copyFormatted();
        },
        'mtp-button mtp-panel-wide',
      ),
      button(
        'All settings…',
        () => {
          this.close();
          this.openAllSettings();
        },
        'mtp-button mtp-panel-wide',
      ),
    );
    this.panel.append(this.rows, actions);

    document.body.append(this.button, this.panel);

    // Show the button while the mouse moves; hide it again when idle.
    document.addEventListener('mousemove', () => this.wake());
    document.addEventListener('mousedown', (event) => {
      const target = event.target as Node;
      if (!this.panel.hidden && !this.panel.contains(target) && !this.button.contains(target)) {
        this.close();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.panel.hidden) {
        this.close();
        this.button.focus();
      }
    });
    this.button.addEventListener('focus', () => this.wake());
  }

  /** Show the current values (sent by the host after every change). */
  setSections(sections: SettingSection[]): void {
    const items = sections.flatMap((section) => section.items);
    this.rows.replaceChildren(
      ...QUICK_KEYS.flatMap((key) => {
        const item = items.find((candidate) => candidate.key === key);
        return item ? [settingRow(item, this.post, true)] : [];
      }),
    );
  }

  private action(label: string, command: WebviewCommand): HTMLButtonElement {
    return button(label, () => {
      this.post({ type: 'command', command });
      this.close();
    });
  }

  private wake(): void {
    this.button.classList.add('mtp-awake');
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.panel.hidden && document.activeElement !== this.button) {
        this.button.classList.remove('mtp-awake');
      }
    }, IDLE_MS);
  }

  private toggle(): void {
    if (this.panel.hidden) {
      this.panel.hidden = false;
      this.button.setAttribute('aria-expanded', 'true');
      this.button.classList.add('mtp-awake');
    } else {
      this.close();
    }
  }

  private close(): void {
    this.panel.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    this.wake();
  }
}

function gearIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', GEAR_PATH);
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}
