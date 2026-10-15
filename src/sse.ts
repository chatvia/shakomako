import { requestHeaders } from './api';
import { authHeaders } from './auth';
import { getApiUrl } from './endpoints';
import { debug } from './utils';
import type { Attachment, HandoffEventData, StreamMessage, StreamSource, ToolEvent } from './types';

/** One visitor turn, posted to the stream endpoint. */
export interface StreamRequest {
  session_id: string | null;
  conversation_id: string | null;
  type: string;
  content: string;
  url: string;
  referrer: string;
  attachments: Attachment[];
}

export interface SSECloseInfo {
  /** Torn down or superseded by a newer send: not a failed turn. */
  aborted?: boolean;
}

export interface SSECallbacks {
  onOpen: () => void;
  onClose: (info?: SSECloseInfo) => void;
  onMessage: (message: StreamMessage) => void;
}

export interface SSEClient {
  connect(): void;
  /** Resolves true once the turn is on its way; the reply arrives via onMessage. */
  send(message: StreamRequest): Promise<boolean>;
  close(): void;
  isConnected(): boolean;
}

/** The JSON in one `data:` line of the stream. */
interface StreamEnvelope {
  type?: string;
  id?: string;
  content?: string;
  status?: string;
  data?: StreamEnvelopeData;
}

interface StreamEnvelopeData extends ToolEvent {
  assistant_message_id?: string;
  code?: string;
  message?: string;
  text?: string;
  key?: string;
  value?: HandoffEventData;
  status?: string;
  sources?: StreamSource[];
}

/**
 * How long a turn may go without any data (no response yet, or no new chunk)
 * before it is abandoned as a failure. Without a limit a stalled stream left
 * the composer disabled until the page was reloaded.
 */
const STREAM_IDLE_TIMEOUT = 120000;

/** Error code for a turn lost to the network or the idle timeout. */
export const CONNECTION_LOST = 'connection_lost';

export function createSSEClient(
  agent_id: string,
  session_id: string | null,
  conversation_id: string | null,
  callbacks: Partial<SSECallbacks> = {}
): SSEClient {
  const sseCallbacks: SSECallbacks = {
    onOpen: () => {},
    onClose: () => {},
    onMessage: () => {},
    ...callbacks
  };

  let abortController: AbortController | null = null;
  let isStreaming = false;

  function connect(): void {
    debug('SSE client ready', { agent_id, session_id, conversation_id });
    sseCallbacks.onOpen();
  }

  function send(message: StreamRequest): Promise<boolean> {
    // Never log full message content in production — gated via debug().
    debug('SSE send', { conversation_id, type: message?.type });

    // Abort any existing connection
    if (abortController) {
      abortController.abort();
    }

    abortController = new AbortController();
    // Captured so the retry loop below stops the moment a newer send()
    // (or close()) aborts this turn — otherwise a backed-off retry could fire
    // after the connection was intentionally torn down.
    const myController = abortController;
    isStreaming = true;
    let isDone = false;

    // Idle watchdog: restarted by the response and by every chunk, cleared
    // when the turn ends. Firing aborts the turn as a failure (not as a
    // supersede, which is what a plain abort means below).
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const keepAlive = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (myController.signal.aborted) return;
        timedOut = true;
        myController.abort();
      }, STREAM_IDLE_TIMEOUT);
    };
    keepAlive();

    function finishTurn(): Promise<void> {
      clearTimeout(idleTimer);
      isDone = true;
      isStreaming = false;
      sseCallbacks.onClose();
      return Promise.resolve();
    }

    const sendUrl = getApiUrl() + '/stream';

    // Transient, worker-/gateway-level failures: the POST was rejected before a
    // worker ran it (nothing persisted server-side), so re-sending the same turn
    // is safe and idempotent. These usually clear within ~1s as a worker frees,
    // so retry a couple of times with backoff before surfacing an error — that
    // turns the common "no reply" blip into a self-healing hiccup.
    const TRANSIENT_STATUS = new Set([429, 502, 503, 504]);
    const MAX_RETRIES = 2;

    function attempt(retriesLeft: number): Promise<void> {
      let assistantMessageId: string | null = null;

      const headers = requestHeaders({
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-AGENT-ID': agent_id,
        'X-SESSION-ID': session_id,
        'X-CONVERSATION-ID': conversation_id,
        ...authHeaders(agent_id)
      });

      return fetch(sendUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...message,
          agent_id: agent_id
        }),
        signal: myController.signal
      }).then((response): Promise<void> => {
        keepAlive();
        if (!response.ok) {
          if (
            TRANSIENT_STATUS.has(response.status) &&
            retriesLeft > 0 &&
            !myController.signal.aborted
          ) {
            const backoff = (MAX_RETRIES - retriesLeft + 1) * 700; // 700ms, then 1400ms
            debug('SSE transient failure — retrying', {
              status: response.status,
              retriesLeft,
              backoff
            });
            return new Promise(resolve => setTimeout(resolve, backoff)).then(() => {
              if (myController.signal.aborted) {
                throw Object.assign(new Error('aborted'), { name: 'AbortError' });
              }
              return attempt(retriesLeft - 1);
            });
          }
          throw new Error(`HTTP error! Status: ${response.status}`);
        }

        debug('SSE stream open');
        sseCallbacks.onOpen();

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        function processChunk({
          done,
          value
        }: ReadableStreamReadResult<Uint8Array>): Promise<void> {
          if (done || isDone) {
            return isDone ? Promise.resolve() : finishTurn();
          }
          keepAlive();

          // Decode the chunk and add to buffer
          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE messages
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || ''; // Keep the last incomplete chunk

          for (const line of lines) {
            if (line.trim() === '') continue;

            // Extract data from SSE format
            const dataMatch = line.match(/^data: (.+)$/m);

            if (dataMatch) {
              let event: StreamEnvelope;
              try {
                event = JSON.parse(dataMatch[1]);
              } catch (e) {
                console.error('❌ Error parsing SSE data:', e, dataMatch[1]);
                continue;
              }

              const type = event.type;
              const d: StreamEnvelopeData = event.data || {};

              // start: capture assistant id for feedback/copy; emit nothing
              // (avoids a premature hideLoading flash before any text arrives).
              if (type === 'start') {
                assistantMessageId = d.assistant_message_id || event.id || assistantMessageId;
                continue;
              }

              // terminal: clean `done` envelope OR legacy [DONE]
              if (type === 'done' || event.content === '[DONE]') {
                return finishTurn();
              }

              // backend-signalled error: surface, then let the following `done` close
              if (type === 'error') {
                sseCallbacks.onMessage({ type: 'error', code: d.code, message: d.message });
                continue;
              }

              // streamed text chunk
              if (type === 'delta') {
                if (d.text) sseCallbacks.onMessage({ content: d.text, id: assistantMessageId });
                continue;
              }

              // the output guardrail's correction: the full safe answer that
              // replaces everything streamed so far
              if (type === 'replace') {
                if (typeof d.text === 'string') {
                  sseCallbacks.onMessage({
                    type: 'replace',
                    content: d.text,
                    id: assistantMessageId
                  });
                }
                continue;
              }

              // function + MCP tool lifecycle
              if (type === 'tool') {
                // `type` last: a tool payload's own `type` field must not hide that
                // this is a tool event.
                sseCallbacks.onMessage({ id: assistantMessageId, ...d, type: 'tool' });
                continue;
              }

              // the sources the reply was given; shown under it once it is done
              if (type === 'sources') {
                if (Array.isArray(d.sources)) {
                  sseCallbacks.onMessage({
                    type: 'sources',
                    id: assistantMessageId,
                    sources: d.sources
                  });
                }
                continue;
              }

              // handoff now rides inside meta{key:'handoff', value:{status,…}}
              if (type === 'meta' && d.key === 'handoff' && d.value) {
                sseCallbacks.onMessage({ ...d.value, status: d.value.status });
                return finishTurn();
              }

              // legacy flat handoff: { status: 'human' | 'returned' | 'ai' }
              const legacyStatus = d.status || event.status;
              if (legacyStatus && ['human', 'returned', 'ai'].includes(legacyStatus)) {
                sseCallbacks.onMessage({ ...(event.data || event), status: legacyStatus });
                return finishTurn();
              }

              // backward-compat: flat { content } (old format + server.js mock)
              if (event.content) sseCallbacks.onMessage(event);
              // meta(non-handoff) / unknown types: ignored
            }
          }

          // Continue reading if not done
          return reader.read().then(processChunk);
        }

        return reader.read().then(processChunk);
      });
    }

    try {
      // Single failure handler for the whole turn — runs only after retries are
      // exhausted (or on a non-transient/aborted failure).
      attempt(MAX_RETRIES).catch((error: Error) => {
        clearTimeout(idleTimer);
        isStreaming = false;
        if (error.name === 'AbortError' && !timedOut) {
          // Superseded by a new send or torn down — not a failed turn.
          console.log('Fetch aborted');
          sseCallbacks.onClose({ aborted: true });
        } else {
          console.error('❌ SSE error:', timedOut ? 'no data for too long' : error);
          // The widget turns the code into a message in the visitor's language.
          sseCallbacks.onMessage({ type: 'error', code: CONNECTION_LOST });
          sseCallbacks.onClose();
        }
      });

      return Promise.resolve(true); // Return immediately since we're streaming
    } catch (error) {
      console.error('❌ Error in send function:', error);
      isStreaming = false;
      return Promise.resolve(false);
    }
  }

  function close(): void {
    if (abortController) {
      debug('Aborting SSE connection');
      abortController.abort();
      abortController = null;
    }
    isStreaming = false;
    // Teardown (init, conversation switch, new chat) — not a failed turn, so flag it
    // aborted to keep the empty-close guard from surfacing a spurious error.
    sseCallbacks.onClose({ aborted: true });
  }

  return {
    connect,
    send,
    close,
    isConnected: () => isStreaming
  };
}
