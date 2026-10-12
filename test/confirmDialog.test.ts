import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { ChatWidget } from '../src/widget';
import { initI18n } from '../src/i18n';
import { CSS_CLASSES } from '../src/utils';

// `_showConfirmationDialog` only reads `settings.theme` and the menu elements,
// so a bare prototype instance is enough to exercise it.
function buildWidget(theme = 'light'): ChatWidget {
  const widget = Object.create(ChatWidget.prototype) as ChatWidget;
  widget.settings = { theme };
  widget.menuDropdown = document.createElement('div');
  widget.menuButton = document.createElement('div');
  return widget;
}

const dialogSelector = '.' + CSS_CLASSES.CONFIRM_DIALOG;

describe('confirmation dialog', () => {
  beforeAll(async () => {
    await initI18n({ language: 'en' });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is an alert dialog with its title and message wired up', () => {
    buildWidget()._showConfirmationDialog(
      'Delete chat?',
      'This cannot be undone.',
      'Delete',
      () => {}
    );

    const content = document.querySelector('[role="alertdialog"]')!;
    expect(content.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(content.getAttribute('aria-labelledby')!)?.textContent).toBe(
      'Delete chat?'
    );
    expect(document.getElementById(content.getAttribute('aria-describedby')!)?.textContent).toBe(
      'This cannot be undone.'
    );
  });

  it('starts on Cancel, the safe choice', () => {
    buildWidget()._showConfirmationDialog('Delete chat?', 'Sure?', 'Delete', () => {});

    expect(document.activeElement?.classList.contains(CSS_CLASSES.CONFIRM_CANCEL)).toBe(true);
  });

  it('closes on Escape without confirming, and returns focus', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const onConfirm = vi.fn();
    buildWidget()._showConfirmationDialog('Delete chat?', 'Sure?', 'Delete', onConfirm);

    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );

    expect(document.querySelector(dialogSelector)).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  });

  it('runs the action on confirm', () => {
    const onConfirm = vi.fn();
    buildWidget()._showConfirmationDialog('Delete chat?', 'Sure?', 'Delete', onConfirm);

    document.querySelector<HTMLElement>('.' + CSS_CLASSES.CONFIRM_DELETE)!.click();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(document.querySelector(dialogSelector)).toBeNull();
  });

  it('follows the widget into dark mode', () => {
    buildWidget('dark')._showConfirmationDialog('Delete chat?', 'Sure?', 'Delete', () => {});

    expect(
      document.querySelector(dialogSelector)?.classList.contains(CSS_CLASSES.WINDOW_DARK)
    ).toBe(true);
  });
});
