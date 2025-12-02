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
              try {
                const data = JSON.parse(dataMatch[1]);
                console.log('✅ Received SSE message:', data);
                
                // Handle [DONE] marker
                if (data.content === '[DONE]') {
                  isDone = true;
                  isStreaming = false;
                  sseCallbacks.onClose();
                  return Promise.resolve();
                }
                
                // Handle regular content messages
                if (data.content) {
                  sseCallbacks.onMessage(data);
                }
              } catch (e) {
                console.error('❌ Error parsing SSE data:', e);
                console.log('Raw data:', dataMatch[1]);
              }
            }
          }

          // Continue reading if not done
          return reader.read().then(processChunk);
        }

        return reader.read().then(processChunk);
      })
      .catch(error => {
        if (error.name === 'AbortError') {
          console.log('Fetch aborted');
        } else {
          console.error('❌ SSE error:', error);
        }
        isStreaming = false;
        sseCallbacks.onClose();
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
    sseCallbacks.onClose();
  }

  return {
    connect,
    send,
    close,
    isConnected: () => isStreaming
  };
}
