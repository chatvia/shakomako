import { describe, it, expect, vi } from 'vitest';
import { setupInputListeners } from '../src/state/events';
import type { ChatWidget } from '../src/widget';

function makeWidget() {
  const sendUserMessage = vi.fn();
  const widget = {
    chatInput: document.createElement('textarea'),
    sendButton: document.createElement('button'),
    sendUserMessage,
    autoResizeInput() {},
    isInHumanMode: () => false
  } as unknown as ChatWidget;
  return { widget, sendUserMessage };
}

function pressEnter(target: HTMLElement, init: KeyboardEventInit = {}) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init })
  );
}

// Japanese, Chinese and Korean input methods use Enter to pick a candidate.
// That Enter must never send the half-composed message.
describe('composer Enter key', () => {
  it('sends on a plain Enter', () => {
    const { widget, sendUserMessage } = makeWidget();
    setupInputListeners(widget);

    pressEnter(widget.chatInput);

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
  });

  it('ignores Enter while an IME composition is active', () => {
    const { widget, sendUserMessage } = makeWidget();
    setupInputListeners(widget);

    pressEnter(widget.chatInput, { isComposing: true });

    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("ignores Safari's composition-commit Enter (keyCode 229)", () => {
    const { widget, sendUserMessage } = makeWidget();
    setupInputListeners(widget);

    pressEnter(widget.chatInput, { keyCode: 229 } as KeyboardEventInit);

    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it('keeps Shift+Enter for a new line', () => {
    const { widget, sendUserMessage } = makeWidget();
    setupInputListeners(widget);

    pressEnter(widget.chatInput, { shiftKey: true });

    expect(sendUserMessage).not.toHaveBeenCalled();
  });
});
