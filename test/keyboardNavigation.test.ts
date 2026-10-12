import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { setupFocusTrap, setupMenuKeyboard } from '../src/state/events';
import type { ChatWidget } from '../src/widget';

// jsdom does no layout, so "is this element rendered?" is answered by a stub.
beforeAll(() => {
  Element.prototype.checkVisibility = () => true;
});

afterEach(() => {
  document.body.innerHTML = '';
});

function item(label: string): HTMLDivElement {
  const el = document.createElement('div');
  el.tabIndex = 0;
  el.textContent = label;
  return el;
}

function press(key: string, init: KeyboardEventInit = {}) {
  document.activeElement!.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  );
}

describe('header menu keyboard', () => {
  function makeWidget() {
    const menuDropdown = document.createElement('div');
    const items = ['New chat', 'History', 'Clear'].map(item);
    items.forEach(el => menuDropdown.appendChild(el));
    const menuButton = item('Menu');
    document.body.append(menuButton, menuDropdown);
    const closeMenuDropdown = vi.fn();
    const widget = { menuDropdown, menuButton, closeMenuDropdown } as unknown as ChatWidget;
    setupMenuKeyboard(widget);
    return { items, menuButton, closeMenuDropdown };
  }

  it('moves between items with the arrow keys, wrapping at the ends', () => {
    const { items } = makeWidget();
    items[0].focus();

    press('ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    press('ArrowUp');
    press('ArrowUp');
    expect(document.activeElement).toBe(items[2]);
  });

  it('jumps to the first and last item with Home and End', () => {
    const { items } = makeWidget();
    items[1].focus();

    press('End');
    expect(document.activeElement).toBe(items[2]);
    press('Home');
    expect(document.activeElement).toBe(items[0]);
  });

  it('closes on Escape and hands focus back to the menu button', () => {
    const { items, menuButton, closeMenuDropdown } = makeWidget();
    items[1].focus();

    press('Escape');

    expect(closeMenuDropdown).toHaveBeenCalled();
    expect(document.activeElement).toBe(menuButton);
  });
});

describe('fullscreen focus trap', () => {
  function makeWidget(modal: boolean) {
    const chatWindow = document.createElement('div');
    if (modal) chatWindow.setAttribute('aria-modal', 'true');
    const controls = ['Close', 'Composer', 'Send'].map(item);
    controls.forEach(el => chatWindow.appendChild(el));
    document.body.appendChild(chatWindow);
    setupFocusTrap({ chatWindow } as unknown as ChatWidget);
    return controls;
  }

  it('wraps Tab from the last control to the first, and Shift+Tab back', () => {
    const controls = makeWidget(true);

    controls[2].focus();
    press('Tab');
    expect(document.activeElement).toBe(controls[0]);

    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(controls[2]);
  });

  it('leaves Tab alone when the chat is not covering the page', () => {
    const controls = makeWidget(false);
    controls[2].focus();

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    controls[2].dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(false);
  });
});
