export function createSSEClient(agent_id, callbacks = {}) {
  const sseCallbacks = {
    onOpen: () => {},
    onClose: () => {},
    onError: () => {},
    onMessage: () => {},
    ...callbacks
  };

  // SSE state
  let abortController = null;
  let isConnected = false;
  let isConnecting = false;

  function connect() {
    if (isConnecting || isConnected) {
      console.log('SSE already connecting or connected, skipping...');
      return;
    }

    try {
      console.log('=== STARTING SSE CONNECTION ===');
      isConnecting = true;
      
      if (abortController) {
        console.log('Aborting previous connection');
        abortController.abort();
      }

      /* global __SSE_URL__ */
      const sseUrl = __SSE_URL__;
      
      console.log('SSE URL:', sseUrl);
      console.log('Agent ID:', agent_id);
      console.log('==============================');
      
      // Create abort controller for this connection
      abortController = new AbortController();
      
      const requestBody = JSON.stringify({
        agent_id: agent_id,
        type: 'connect'
      });
      
      console.log('=== SSE REQUEST ===');
      console.log('URL:', sseUrl);
      console.log('Method: POST');
      console.log('Headers:', {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
      });
      console.log('Body:', requestBody);
      console.log('==================');
      
      // Use fetch with POST for streaming
      fetch(sseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        body: requestBody,
        signal: abortController.signal
      }).then(response => {
        console.log('=== SSE RESPONSE ===');
        console.log('Status:', response.status);
        console.log('Status Text:', response.statusText);
        console.log('Headers:');
        for (let [key, value] of response.headers.entries()) {
          console.log(`  ${key}: ${value}`);
        }
        console.log('==================');
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error('Response body is not available');
        }

        console.log('✅ SSE connected successfully');
        console.log('Starting to read stream...');
        isConnected = true;
        isConnecting = false;

        sseCallbacks.onOpen();

        // Read the stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let jsonBuffer = ''; // Buffer for incomplete JSON data

        function readStream() {
          reader.read().then(({ done, value }) => {
            if (done) {
              console.log('SSE stream ended');
              
              // Clear any buffered JSON data
              if (jsonBuffer) {
                console.log('🧹 Clearing JSON buffer due to stream end');
                jsonBuffer = '';
              }
              
              isConnected = false;
              sseCallbacks.onClose();
              return;
            }

            console.log('=== RAW BYTES RECEIVED ===');
            console.log('Value (Uint8Array):', value);
            console.log('Value length:', value.length);
            console.log('Value as array:', Array.from(value));
            console.log('========================');

            // Decode the chunk and add to buffer
            const chunk = decoder.decode(value, { stream: true });
            console.log('=== SSE RESPONSE CHUNK ===');
            console.log('Raw chunk:', chunk);
            console.log('Chunk length:', chunk.length);
            console.log('Chunk as JSON:', JSON.stringify(chunk));
            console.log('========================');
            
            buffer += chunk;

            // Process complete lines
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            console.log('=== PROCESSING LINES ===');
            console.log('Lines to process:', lines.length);
            console.log('Lines:', lines);
            console.log('Remaining buffer:', buffer);
            console.log('=======================');

            for (const line of lines) {
              console.log('--- Processing line ---');
              console.log('Line:', line);
              console.log('Line length:', line.length);
              console.log('Line trimmed:', line.trim());
              
              if (line.startsWith('data: ')) {
                const data = line.slice(6); // Remove 'data: ' prefix
                console.log('Found data line, content:', data);
                if (data.trim()) {
                  // Check if this is a special marker like [DONE]
                  if (data.trim() === '[DONE]') {
                    console.log('✅ Received [DONE] marker');
                    sseCallbacks.onMessage({ content: '[DONE]' });
                    continue;
                  }
                  
                  // Try to parse as JSON, but handle incomplete data
                  try {
                    const parsedData = JSON.parse(data);
                    console.log('✅ Successfully parsed SSE data:', parsedData);
                    sseCallbacks.onMessage(parsedData);
                  } catch (error) {
                    console.log('⚠️ JSON parse failed, might be incomplete data');
                    console.log('Raw data that failed to parse:', data);
                    console.log('Current JSON buffer:', jsonBuffer);
                    
                    // Check if this looks like incomplete JSON (starts with { but doesn't end with })
                    if (data.trim().startsWith('{') && !data.trim().endsWith('}')) {
                      console.log('📝 Incomplete JSON detected, buffering...');
                      jsonBuffer += data;
                    } else if (jsonBuffer && data.trim().endsWith('}')) {
                      // Complete the buffered JSON
                      jsonBuffer += data;
                      try {
                        const completeData = JSON.parse(jsonBuffer);
                        console.log('✅ Successfully parsed complete buffered JSON:', completeData);
                        sseCallbacks.onMessage(completeData);
                        jsonBuffer = ''; // Clear buffer
                      } catch (completeError) {
                        console.error('❌ Failed to parse complete buffered JSON:', completeError);
                        console.log('Complete buffered data:', jsonBuffer);
                        // Send raw data as fallback
                        sseCallbacks.onMessage(jsonBuffer);
                        jsonBuffer = '';
                      }
                    } else if (jsonBuffer) {
                      // We have a buffer but this chunk doesn't complete it
                      console.log('📝 Adding to existing JSON buffer...');
                      jsonBuffer += data;
                    } else {
                      // Not JSON, send as raw data
                      console.log('📤 Sending raw data (not JSON)');
                      sseCallbacks.onMessage(data);
                    }
                  }
                } else {
                  console.log('Data line is empty, skipping');
                }
              } else if (line.startsWith('event: ')) {
                const eventType = line.slice(7); // Remove 'event: ' prefix
                console.log('Found event line:', eventType);
              } else if (line.trim()) {
                console.log('Other line (not data or event):', line);
              } else {
                console.log('Empty line, skipping');
              }
              console.log('----------------------');
            }

            // Continue reading
            readStream();
          }).catch(error => {
            console.error('=== SSE STREAM ERROR ===');
            console.error('Error reading stream:', error);
            console.error('Error name:', error.name);
            console.error('Error message:', error.message);
            console.error('=======================');
            
            // Clear any buffered JSON data
            if (jsonBuffer) {
              console.log('🧹 Clearing JSON buffer due to error');
              jsonBuffer = '';
            }
            
            if (error.name === 'AbortError') {
              console.log('SSE connection aborted');
            } else {
              sseCallbacks.onError(error);
            }
            isConnected = false;
            isConnecting = false;
            sseCallbacks.onClose();
          });
        }

        readStream();

      }).catch(error => {
        if (error.name === 'AbortError') {
          console.log('SSE connection aborted');
        } else {
          console.error('Error connecting to SSE:', error);
          sseCallbacks.onError(error);
        }
        isConnected = false;
        isConnecting = false;
      });

    } catch (error) {
      console.error('Error setting up SSE:', error);
      isConnecting = false;
      sseCallbacks.onError(error);
    }
  }

  function send(message) {
    console.log('=== SEND MESSAGE CALLED ===');
    console.log('Message:', message);
    console.log('isConnected:', isConnected);
    console.log('isConnecting:', isConnecting);
    
    // Connect first if not connected
    if (!isConnected && !isConnecting) {
      console.log('🔌 Starting connection for streaming...');
      connect();
    }
    
    try {
      /* global __SSE_URL__ */
      const sseUrl = __SSE_URL__;
      const sendUrl = sseUrl.replace('/events', '/send');
      
      console.log('=== SENDING MESSAGE ===');
      console.log('Send URL:', sendUrl);
      console.log('Message payload:', {
        ...message,
        agent_id: agent_id
      });
      console.log('======================');
      
      return fetch(sendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...message,
          agent_id: agent_id
        })
      }).then(response => {
        console.log('=== SEND RESPONSE ===');
        console.log('Status:', response.status);
        console.log('Status Text:', response.statusText);
        console.log('====================');
        
        if (response.ok) {
          console.log('✅ Message sent successfully');
          return true;
        } else {
          console.error('❌ Failed to send message:', response.status, response.statusText);
          return false;
        }
      }).catch(error => {
        console.error('❌ Error sending message:', error);
        sseCallbacks.onError(error);
        return false;
      });
    } catch (error) {
      console.error('❌ Error in send function:', error);
      sseCallbacks.onError(error);
      return Promise.resolve(false);
    }
  }

  function close() {
    if (abortController) {
      console.log('🧹 Aborting SSE connection and clearing buffers');
      abortController.abort();
    }
  }

  return {
    send,
    close,
    isConnected: () => isConnected
  };
}
