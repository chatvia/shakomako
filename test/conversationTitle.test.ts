import { describe, it, expect, vi } from 'vitest';
import { requestConversationTitle } from '../src/state/conversations';
import type { ChatWidget } from '../src/widget';

/** A widget with just what naming a conversation reads. */
function fakeWidget(generate: (id: string) => Promise<string | null>) {
  const generateConversationTitle = vi.fn(generate);
  const widget = {
    activeConversationId: 'conv-1',
    conversations: [{ id: 'conv-1', title: null }],
    storageManager: { generateConversationTitle }
  } as unknown as ChatWidget;

  return { widget, generateConversationTitle };
}

describe('requestConversationTitle', () => {
  it('names the active conversation once, and keeps the title for the history list', async () => {
    const { widget, generateConversationTitle } = fakeWidget(async () => 'Order status');

    await requestConversationTitle(widget);
    await requestConversationTitle(widget);

    expect(generateConversationTitle).toHaveBeenCalledTimes(1);
    expect(generateConversationTitle).toHaveBeenCalledWith('conv-1');
    expect(widget.conversations[0].title).toBe('Order status');
  });

  it('asks again for another conversation', async () => {
    const { widget, generateConversationTitle } = fakeWidget(async () => 'A title');

    await requestConversationTitle(widget);
    widget.activeConversationId = 'conv-2';
    await requestConversationTitle(widget);

    expect(generateConversationTitle).toHaveBeenCalledTimes(2);
  });

  it('only logs a failure: the server names the conversation later', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { widget } = fakeWidget(async () => {
      throw new Error('offline');
    });

    await expect(requestConversationTitle(widget)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(widget.conversations[0].title).toBeNull();
  });
});
