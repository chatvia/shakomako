export function createSSEClient(agent_id, session_id, thread_id, callbacks = {}) {
  const sseCallbacks = {
    onOpen: () => {},
    onClose: () => {},
    onMessage: () => {},
    ...callbacks
  };

  let abortController = null;
  let isStreaming = false;

  function connect() {
    console.log('=== SSE CLIENT READY ===');
    console.log('Agent ID:', agent_id);
    console.log('Session ID:', session_id);
    console.log('Thread ID:', thread_id);
    sseCallbacks.onOpen();
  }

  function send(message) {
    console.log('=== SENDING MESSAGE ===');
    console.log('Message:', message);
    
    // Abort any existing connection
    if (abortController) {
      abortController.abort();
    }

    abortController = new AbortController();
    isStreaming = true;
    let isDone = false;
    let assistantMessageId = null;

    try {
      /* global __API_URL__ */
      const sendUrl = __API_URL__ + '/stream';
      
      console.log('Send URL:', sendUrl);
      console.log('Message payload:', {
        ...message,
        agent_id: agent_id
      });
      console.log('Headers:', {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'X-AGENT-ID': agent_id,
        'X-SESSION-ID': session_id,
        'X-THREAD-ID': thread_id,
      });
      
      // Create POST request with payload
      fetch(sendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'X-AGENT-ID': agent_id,
          'X-SESSION-ID': session_id,
          'X-THREAD-ID': thread_id,
        },
        body: JSON.stringify({
          ...message,
          agent_id: agent_id
        }),
        signal: abortController.signal,
      })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }

        console.log('✅ Message sent successfully, starting stream...');
        sseCallbacks.onOpen();

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        function processChunk({done, value}) {
          if (done || isDone) {
            if (!isDone) {
              isDone = true;
              isStreaming = false;
              sseCallbacks.onClose();
            }
            return Promise.resolve();
          }

          // Decode the chunk and add to buffer
          buffer += decoder.decode(value, {stream: true});

          // Process complete SSE messages
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || ''; // Keep the last incomplete chunk

          for (const line of lines) {
            if (line.trim() === '') continue;

            // Extract data from SSE format
            const dataMatch = line.match(/^data: (.+)$/m);
            
            if (dataMatch) {
              let event;
              try {
                event = JSON.parse(dataMatch[1]);
              } catch (e) {
                console.error('❌ Error parsing SSE data:', e, dataMatch[1]);
                continue;
              }

              const type = event.type;
              const d = event.data || {};

              // start: capture assistant id for feedback/copy; emit nothing
              // (avoids a premature hideLoading flash before any text arrives).
              if (type === 'start') {
                assistantMessageId = d.assistant_message_id || event.id || assistantMessageId;
                continue;
              }

              // terminal: clean `done` envelope OR legacy [DONE]
              if (type === 'done' || event.content === '[DONE]') {
                isDone = true;
                isStreaming = false;
                sseCallbacks.onClose();
                return Promise.resolve();
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

              // function + MCP tool lifecycle
              if (type === 'tool') {
                sseCallbacks.onMessage({ type: 'tool', id: assistantMessageId, ...d });
                continue;
              }

              // handoff now rides inside meta{key:'handoff', value:{status,…}}
              if (type === 'meta' && d.key === 'handoff' && d.value) {
                sseCallbacks.onMessage({ ...d.value, status: d.value.status });
                isDone = true;
                isStreaming = false;
                sseCallbacks.onClose();
                return Promise.resolve();
              }

              // legacy flat handoff: { status: 'human' | 'returned' | 'ai' }
              const legacyStatus = d.status || event.status;
              if (legacyStatus && ['human', 'returned', 'ai'].includes(legacyStatus)) {
                sseCallbacks.onMessage({ ...(event.data || event), status: legacyStatus });
                isDone = true;
                isStreaming = false;
                sseCallbacks.onClose();
                return Promise.resolve();
              }

              // backward-compat: flat { content } (old format + server.js mock)
              if (event.content) sseCallbacks.onMessage(event);
              // meta(non-handoff) / sources / unknown types: ignored
            }
          }

          // Continue reading if not done
          return reader.read().then(processChunk);
        }

        return reader.read().then(processChunk);
      })
      .catch(error => {
        isStreaming = false;
        if (error.name === 'AbortError') {
          // Superseded by a new send or torn down — not a failed turn.
          console.log('Fetch aborted');
          sseCallbacks.onClose({ aborted: true });
        } else {
          console.error('❌ SSE error:', error);
          sseCallbacks.onMessage({ type: 'error', message: 'Connection lost. Please try again.' });
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

  function close() {
    if (abortController) {
      console.log('🧹 Aborting SSE connection');
      abortController.abort();
      abortController = null;
    }
    isStreaming = false;
    // Teardown (init, thread switch, new chat) — not a failed turn, so flag it
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
