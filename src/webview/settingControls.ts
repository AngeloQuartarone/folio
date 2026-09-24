/*
 * Controls for the settings described by the host (see src/settingsView.ts).
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * Every change is only a request: the host validates it, updates the
 * setting and sends the new values back.
 */
import type { SettingItem, WebviewMessage } from '../messages';

export type Post = (message: WebviewMessage) => void;

/** Choices shown side by side (a segmented control) instead of a menu. */
const MAX_SEGMENTS = 3;

const isSegmented = (item: SettingItem) => item.kind === 'select' && item.options.length <= MAX_SEGMENTS;

/** A labelled row: name (and description) on the left, the control on the right. */
export function settingRow(item: SettingItem, post: Post, compact = false): HTMLElement {
  const row = document.createElement(item.kind === 'path' || isSegmented(item) ? 'div' : 'label');
  row.className = 'mtp-setting';
  row.dataset['kind'] = isSegmented(item) ? 'segmented' : item.kind;
  row.dataset['key'] = item.key;
  const text = document.createElement('span');
  text.className = 'mtp-setting-text';
  const label = document.createElement('span');
  label.className = 'mtp-setting-label';
  label.textContent = item.label;
  text.append(label);
  if (item.description && !compact) {
    const description = document.createElement('span');
    description.className = 'mtp-setting-description';
    description.textContent = item.description;
    text.append(description);
  }
  row.append(text, settingControl(item, post));
  return row;
}

export function settingControl(item: SettingItem, post: Post): HTMLElement {
  const set = (value: unknown) => post({ type: 'setSetting', key: item.key, value });
  switch (item.kind) {
    case 'toggle': {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'mtp-switch';
      input.checked = item.value;
      input.addEventListener('change', () => set(input.checked));
      return input;
    }
    case 'select': {
      if (isSegmented(item)) {
        return segmented(item, set);
      }
      const select = document.createElement('select');
      for (const choice of item.options) {
        const option = document.createElement('option');
        option.value = choice.value;
        option.textContent = choice.label;
        option.selected = choice.value === item.value;
        select.appendChild(option);
      }
      select.addEventListener('change', () => set(select.value));
      return select;
    }
    case 'number': {
      const wrapper = document.createElement('span');
      wrapper.className = 'mtp-number';
      const input = document.createElement('input');
      input.type = 'number';
      input.min = String(item.min);
      input.max = String(item.max);
      input.step = String(item.step);
      input.value = String(item.value);
      input.addEventListener('change', () => {
        const value = Math.min(item.max, Math.max(item.min, Math.round(Number(input.value) || 0)));
        input.value = String(value);
        set(value);
      });
      const unit = document.createElement('span');
      unit.textContent = item.unit;
      wrapper.append(input, unit);
      return wrapper;
    }
    case 'path': {
      const wrapper = document.createElement('span');
      wrapper.className = 'mtp-path';
      const value = document.createElement('span');
      value.className = item.value ? 'mtp-path-value' : 'mtp-path-value mtp-path-default';
      // Left-to-right marks: the element is right-to-left (to keep the end of
      // a long path visible), which would otherwise move the leading "/".
      value.textContent = item.value ? `\u200e${item.value}\u200e` : item.placeholder;
      value.title = item.value || item.placeholder;
      wrapper.append(value, button('Change…', () => post({ type: 'choosePath', key: item.key })));
      if (item.value) {
        wrapper.append(button('Reset', () => post({ type: 'resetSetting', key: item.key })));
      }
      return wrapper;
    }
  }
}

/** Radio buttons styled as one pill with a sliding highlight. */
function segmented(item: Extract<SettingItem, { kind: 'select' }>, set: (value: unknown) => void): HTMLElement {
  const group = document.createElement('div');
  group.className = 'mtp-segmented';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', item.label);
  for (const choice of item.options) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'mtp-segment';
    option.dataset['value'] = choice.value.replace(/\.css$/, '');
    option.setAttribute('role', 'radio');
    option.setAttribute('aria-checked', String(choice.value === item.value));
    const swatch = document.createElement('span');
    swatch.className = 'mtp-swatch';
    swatch.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = choice.label;
    option.append(swatch, label);
    option.addEventListener('click', () => {
      if (option.getAttribute('aria-checked') === 'true') {
        return;
      }
      for (const other of group.children) {
        other.setAttribute('aria-checked', String(other === option));
      }
      set(choice.value);
    });
    group.append(option);
  }
  return group;
}

export function button(label: string, onClick: () => void, className = 'mtp-button'): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
}
