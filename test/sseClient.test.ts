import { describe, it, expect, afterEach, vi } from 'vitest';
import { createSSEClient, CONNECTION_LOST } from '../src/sse';
import { requestHeaders } from '../src/api';
import type { StreamRequest } from '../src/sse';

const turn: StreamRequest = {
  session_id: 'sess-1',
  conversation_id: null,
  type: 'message',
  content: 'Hello',
  url: 'https://example.test/',
  referrer: '',
  attachments: []
};

// A fetch that never answers, but rejects like the browser when aborted.
function hangingFetch() {
  return vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        );
      })
  );
}

describe('stream client', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('gives up on a silent stream and reports a lost connection', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onMessage = vi.fn();
    const onClose = vi.fn();
    const client = createSSEClient('agent-1', 'sess-1', 'conv-1', { onMessage, onClose });

    await client.send(turn);
    await vi.advanceTimersByTimeAsync(120000);

    expect(onMessage).toHaveBeenCalledWith({ type: 'error', code: CONNECTION_LOST });
    expect(onClose).toHaveBeenCalledWith();
    expect(client.isConnected()).toBe(false);
  });

  it('treats closing the client as a teardown, not a failure', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const onMessage = vi.fn();
    const onClose = vi.fn();
    const client = createSSEClient('agent-1', 'sess-1', 'conv-1', { onMessage, onClose });

    await client.send(turn);
    client.close();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(onMessage).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith({ aborted: true });
  });

  it('leaves unknown ids out of the request headers instead of sending "null"', () => {
    expect(
      requestHeaders({
        'X-AGENT-ID': 'agent-1',
        'X-CONVERSATION-ID': null,
        'X-SESSION-ID': undefined
      })
    ).toEqual({ 'X-AGENT-ID': 'agent-1' });
  });
});
