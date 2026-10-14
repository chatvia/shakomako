import { describe, it, expect, beforeEach, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('../src/api', () => ({ default: (...args: unknown[]) => apiMock(...args) }));

const { default: StorageManager } = await import('../src/storage');

describe('StorageManager.deleteAllConversations', () => {
  beforeEach(() => {
    apiMock.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('reports success when the server deleted them', async () => {
    apiMock.mockResolvedValue({ ok: true, status: 204 });

    await expect(new StorageManager('agent-1', 'sess-1').deleteAllConversations()).resolves.toBe(
      true
    );
  });

  it('reports failure when the server rejected the request', async () => {
    // A 401/500 deleted nothing, so the widget must not wipe the local history.
    apiMock.mockResolvedValue({ ok: false, status: 500 });

    await expect(new StorageManager('agent-1', 'sess-1').deleteAllConversations()).resolves.toBe(
      false
    );
  });
});

describe('StorageManager.generateConversationTitle', () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it('asks the server to name the conversation and returns its title', async () => {
    apiMock.mockResolvedValue({ ok: true, json: async () => ({ title: 'Order status' }) });

    await expect(
      new StorageManager('agent-1', 'sess-1').generateConversationTitle('conv-1')
    ).resolves.toBe('Order status');

    expect(apiMock).toHaveBeenCalledWith({
      endpoint: 'conversations/title',
      method: 'POST',
      headers: { 'X-AGENT-ID': 'agent-1', 'X-SESSION-ID': 'sess-1', 'X-CONVERSATION-ID': 'conv-1' }
    });
  });

  it('returns null while the conversation has no title', async () => {
    apiMock.mockResolvedValue({ ok: true, json: async () => ({ title: null }) });

    await expect(
      new StorageManager('agent-1', 'sess-1').generateConversationTitle('conv-1')
    ).resolves.toBeNull();
  });

  it('fails when the server refuses', async () => {
    apiMock.mockResolvedValue({ ok: false, status: 404 });

    await expect(
      new StorageManager('agent-1', 'sess-1').generateConversationTitle('conv-1')
    ).rejects.toThrow();
  });
});
