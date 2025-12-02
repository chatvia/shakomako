/**
 * SSE Handler Module
 * Handles SSE setup, message handling, and streaming
 */

import { createSSEClient } from '../sse.js';
import { CSS_CLASSES, STREAMING_DONE_MARKER } from '../utils.js';
import { 
  startStreamingMessage, 
  updateStreamingMessage, 
  finalizeStreamingMessage,
  clearSSETimeouts,
  resetFinalizeTimeout,
  enableStreamingMessageActions
} from './messages.js';

/**
 * Setup SSE connection
 */
export function setupSSE(widget) {
  if (widget.sseClient) {
    widget.sseClient.close();
  }

  const currentActiveThreadId = widget.getCurrentActiveThreadId();
  widget.sseClient = createSSEClient(widget.agentId, widget.sessionId, currentActiveThreadId, {
    onOpen: () => removeConnectionErrorMessages(widget),
    onClose: () => {
      // Clear loading timeout to prevent race conditions
      if (widget._loadingTimeout) {
        clearTimeout(widget._loadingTimeout);
        widget._loadingTimeout = null;
      }
      widget.hideLoading();
      finalizeStreamingMessage(widget);
      // Re-enable input on close
      if (widget.chatInput) widget.chatInput.disabled = false;
      if (widget.sendButton) widget.sendButton.disabled = false;
    },
    onMessage: data => handleSSEMessage(widget, data)
  });
}

/**
 * Handle incoming SSE messages
 */
export function handleSSEMessage(widget, data) {
  console.log('Received raw SSE data:', data);
  
  // Clear the loading timeout to prevent it from firing after we've received a message
  if (widget._loadingTimeout) {
    clearTimeout(widget._loadingTimeout);
    widget._loadingTimeout = null;
  }
  widget.hideLoading();

  let message;
  if (typeof data === 'object' && data !== null) {
    message = data;
  } else {
    try {
      message = JSON.parse(data);
    } catch (error) {
      console.error('Failed to parse SSE data as JSON:', error);
      console.log('Raw data:', data);
      return;
    }
  }

  clearSSETimeouts(widget);

  if (message.content === STREAMING_DONE_MARKER) {
    console.log('Stream [DONE] received. Finalizing immediately.');
    finalizeStreamingMessage(widget);
    return;
  }

  handleReceivedMessage(widget, message);
}

/**
 * Handle stream chunk
 */
export async function handleStreamChunk(widget, content) {
  console.log('Stream chunk received:', content);
  if (!widget.isStreaming) {
    widget.isStreaming = true;
    widget.currentStreamedMessage = '';
    startStreamingMessage(widget);
    console.log('Started new streaming message');
  }

  widget.currentStreamedMessage += content;
  console.log('Updated accumulated message:', widget.currentStreamedMessage);
  await updateStreamingMessage(widget);
  resetFinalizeTimeout(widget);
}

/**
 * Handle received message
 */
export async function handleReceivedMessage(widget, message) {
  const messageContent = message.content || '';
  console.log('Received message with content:', messageContent);

  const messageId = message.id || message.message_id;
  if (messageId) {
    widget.currentStreamedMessageId = messageId;
    console.log('Stored message ID:', messageId);
    enableStreamingMessageActions(widget, messageId);
  }

  if (messageContent) {
    if (widget.isStreaming) {
      console.log('Adding to existing stream:', messageContent);
      widget.currentStreamedMessage += messageContent;
      await updateStreamingMessage(widget);
      resetFinalizeTimeout(widget);
    } else {
      console.log('Starting new stream with:', messageContent);
      await handleStreamChunk(widget, messageContent);
    }
  }
}

/**
 * Remove connection error messages
 */
export function removeConnectionErrorMessages(widget) {
  widget.messagesContainer?.querySelectorAll(`.${CSS_CLASSES.MESSAGE}.${CSS_CLASSES.MESSAGE_SYSTEM}`).forEach(element => {
    const bubble = element.querySelector(`.${CSS_CLASSES.MESSAGE_BUBBLE}`);
    if (
      bubble &&
      (bubble.textContent.includes('Unable to') ||
        bubble.textContent.includes('Failed to') ||
        bubble.textContent.includes('Connection lost'))
    ) {
      element.remove();
    }
  });
}

