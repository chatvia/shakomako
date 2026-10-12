import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ChatWidget } from '../src/widget';

const apiMock = vi.fn();
vi.mock('../src/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/api')>()),
  default: (...args: unknown[]) => apiMock(...args)
}));

const { default: StorageManager } = await import('../src/storage');
const { initConversations } = await import('../src/state/conversations');

beforeEach(() => {
  apiMock.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// Loads used to swallow failures and return an empty result, so a network
// error looked like "no history" and the widget's error messages never showed.
describe('StorageManager load failures', () => {
  it('reports a failed conversation list instead of an empty one', async () => {
    apiMock.mockResolvedValue({ ok: false, status: 503 });

    await expect(new StorageManager('agent-1', 'sess-1').loadConversations()).rejects.toThrow();
  });

  it('reports failed messages instead of an empty conversation', async () => {
    apiMock.mockResolvedValue({ ok: false, status: 500 });

    await expect(new StorageManager('agent-1', 'sess-1').getMessages('conv-1')).rejects.toThrow();
  });
});

describe('initConversations without the conversation list', () => {
  function makeWidget(initialConversationId: string | null) {
    const storageManager = {
      loadConversations: vi.fn().mockRejectedValue(new Error('offline')),
      setActiveConversationId: vi.fn(),
      createNewConversation: vi.fn().mockResolvedValue({ id: 'conv-new' })
    };
    const widget = {
      storageManager,
      initialConversationId,
      handoffMode: 'ai',
      conversations: [],
      activeConversationId: null,
      messageHistory: [],
      setupSSE() {},
      displayHistoryMessages: vi.fn(),
      _updateConversationActionButtons() {},
      closeMenuDropdown() {},
      scrollToBottom() {},
      getCurrentActiveConversationId: () => null
    } as unknown as ChatWidget;
    return { widget, storageManager };
  }

  it("keeps the session's conversation rather than orphaning it for a new one", async () => {
    const { widget, storageManager } = makeWidget('conv-session');

    await initConversations(widget);

    expect(storageManager.createNewConversation).not.toHaveBeenCalled();
    expect(widget.activeConversationId).toBe('conv-session');
    expect(widget.conversations).toEqual([{ id: 'conv-session' }]);
  });

  it('starts a new conversation when the session gave none', async () => {
    const { widget, storageManager } = makeWidget(null);

    await initConversations(widget);

    expect(storageManager.createNewConversation).toHaveBeenCalledTimes(1);
  });
});
