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
