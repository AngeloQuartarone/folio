/*
 * Quick settings: a small gear button in the preview corner and its panel.
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * The button stays invisible until the mouse moves over the preview and
 * fades out again when idle. The panel only asks the host to change a
 * setting or run a command; the host validates every request.
 */
import type { Choice, WebviewCommand, WebviewMessage, WebviewSettings } from '../messages';

const IDLE_MS = 2000;
const SVG_NS = 'http://www.w3.org/2000/svg';

// Material "settings" icon path (Apache-2.0, Google).
const GEAR_PATH =
  'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.46.46 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z';

export class QuickSettings {
  private readonly button: HTMLButtonElement;
  private readonly panel: HTMLDivElement;
  private readonly translationToggle: HTMLInputElement;
  private readonly scrollSyncToggle: HTMLInputElement;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly post: (message: WebviewMessage) => void,
    settings: WebviewSettings,
  ) {
    const quick = settings.quickSettings;

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

    this.panel.append(
      row('Theme', select(quick.themes, quick.previewTheme, (value) =>
        this.post({ type: 'setSetting', key: 'previewTheme', value }),
      )),
      row('Translate into', select(quick.languages, quick.targetLanguage, (value) =>
        this.post({ type: 'setSetting', key: 'targetLanguage', value }),
      )),
    );
    this.translationToggle = toggle(settings.translationEnabled, (value) =>
      this.post({ type: 'setSetting', key: 'enabled', value }),
    );
    this.scrollSyncToggle = toggle(settings.scrollSync, (value) =>
      this.post({ type: 'setSetting', key: 'scrollSync', value }),
    );
    this.panel.append(
      row('Translation on selection', this.translationToggle),
      row('Scroll sync', this.scrollSyncToggle),
    );

    const actions = document.createElement('div');
    actions.className = 'mtp-panel-actions';
    actions.append(
      this.action('Export PDF', 'exportPdf'),
      this.action('Export HTML', 'exportHtml'),
      this.action('Offline languages…', 'manageOfflineLanguages'),
      this.action('All settings…', 'openSettings'),
    );
    this.panel.append(actions);

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

  /** Keep the toggle in sync when the setting changes elsewhere. */
  setTranslationEnabled(enabled: boolean): void {
    this.translationToggle.checked = enabled;
  }

  private action(label: string, command: WebviewCommand): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mtp-panel-button';
    button.textContent = label;
    button.addEventListener('click', () => {
      this.post({ type: 'command', command });
      this.close();
    });
    return button;
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

function row(label: string, control: HTMLElement): HTMLLabelElement {
  const element = document.createElement('label');
  element.className = 'mtp-panel-row';
  const text = document.createElement('span');
  text.textContent = label;
  element.append(text, control);
  return element;
}

function select(choices: Choice[], current: string, onChange: (value: string) => void): HTMLSelectElement {
  const element = document.createElement('select');
  for (const choice of choices) {
    const option = document.createElement('option');
    option.value = choice.value;
    option.textContent = choice.label;
    option.selected = choice.value === current;
    element.appendChild(option);
  }
  element.addEventListener('change', () => onChange(element.value));
  return element;
}

function toggle(checked: boolean, onChange: (value: boolean) => void): HTMLInputElement {
  const element = document.createElement('input');
  element.type = 'checkbox';
  element.className = 'mtp-switch';
  element.checked = checked;
  element.addEventListener('change', () => onChange(element.checked));
  return element;
}
