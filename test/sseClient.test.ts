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

  it('passes on the sources of a reply, with its id', async () => {
    const events = [
      { type: 'start', data: { assistant_message_id: 'msg-1' } },
      { type: 'delta', data: { text: 'Returns are free.' } },
      {
        type: 'sources',
        data: {
          sources: [
            {
              id: 'c-1',
              label: 'Returns',
              kind: 'website',
              url: 'https://shop.test/returns',
              page: null
            }
          ]
        }
      },
      { type: 'done', data: {} }
    ];
    const body = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(body, { status: 200 })))
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const onMessage = vi.fn();
    const onClose = vi.fn();
    const client = createSSEClient('agent-1', 'sess-1', 'conv-1', { onMessage, onClose });

    await client.send(turn);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());

    expect(onMessage).toHaveBeenCalledWith({
      type: 'sources',
      id: 'msg-1',
      sources: [
        {
          id: 'c-1',
          label: 'Returns',
          kind: 'website',
          url: 'https://shop.test/returns',
          page: null
        }
      ]
    });
  });

  it('passes on the guarded answer that replaces the streamed text', async () => {
    const events = [
      { type: 'start', data: { assistant_message_id: 'msg-1' } },
      { type: 'delta', data: { text: 'Write to jo@example.com' } },
      { type: 'replace', data: { text: 'Write to [EMAIL_1]' } },
      { type: 'done', data: {} }
    ];
    const body = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(body, { status: 200 })))
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const onMessage = vi.fn();
    const onClose = vi.fn();
    const client = createSSEClient('agent-1', 'sess-1', 'conv-1', { onMessage, onClose });

    await client.send(turn);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());

    expect(onMessage).toHaveBeenCalledWith({
      type: 'replace',
      content: 'Write to [EMAIL_1]',
      id: 'msg-1'
    });
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
