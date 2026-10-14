/**
 * SSE Handler Module
 * Handles SSE setup, message handling, and streaming
 */

import { CONNECTION_LOST, createSSEClient } from '../sse';
import { CSS_CLASSES, STREAMING_DONE_MARKER, debug } from '../utils';
import {
  startStreamingMessage,
  updateStreamingMessage,
  finalizeStreamingMessage,
  clearSSETimeouts,
  resetFinalizeTimeout,
  handleToolEvent,
  renderStreamError
} from './messages';
import { handleHandoffEvent } from './handoff';
import { requestConversationTitle } from './conversations';
import { t } from '../i18n';
import type { SSECloseInfo } from '../sse';
import type { StreamMessage } from '../types';
import type { ChatWidget } from '../widget';

/**
 * Setup SSE connection
 */
export function setupSSE(widget: ChatWidget): void {
  if (widget.sseClient) {
    widget.sseClient.close();
  }

  const currentActiveConversationId = widget.getCurrentActiveConversationId();
  widget.sseClient = createSSEClient(
    widget.agentId,
    widget.sessionId,
    currentActiveConversationId,
    {
      onOpen: () => removeConnectionErrorMessages(widget),
      onClose: (info: SSECloseInfo = {}) => {
        // Clear loading timeout to prevent race conditions
        if (widget._loadingTimeout) {
          clearTimeout(widget._loadingTimeout);
          widget._loadingTimeout = null;
        }
        widget.hideLoading();
        finalizeStreamingMessage(widget);

        // Tool-only turn that produced no text: finalize bails early (isStreaming
        // false), leaving an empty placeholder whose avatar/bubble row is still
        // hidden. Drop it entirely so no blank assistant message lingers;
        // otherwise just clear the streaming marker + avatar pulse.
        const leftover = document.getElementById(CSS_CLASSES.STREAMING_MESSAGE);
        if (leftover) {
          const bubble = leftover.querySelector(`.${CSS_CLASSES.MESSAGE_BUBBLE}`);
          if (!bubble || bubble.textContent.trim() === '') {
            leftover.remove();
          } else {
            leftover
              .querySelector(`.${CSS_CLASSES.MESSAGE_AVATAR}`)
              ?.classList.remove(CSS_CLASSES.STREAMING);
            leftover.removeAttribute('id');
            leftover.removeAttribute('aria-busy');
          }
        }

        // Stream closed cleanly but nothing was rendered and no error was
        // shown — surface a generic failure instead of a silent dead turn.
        // Skip when aborted (teardown/supersede): that's not a failed turn.
        if (!info.aborted && !widget._streamHandled && !widget._streamErrorShown) {
          renderStreamError(widget);
        }

        // A reply landed: name the conversation now (once), not a minute later.
        if (!info.aborted && widget._streamHandled && !widget._streamErrorShown) {
          void requestConversationTitle(widget);
        }
        widget._streamHandled = false;
        widget._streamErrorShown = false;

        // Re-enable input on close
        if (widget.chatInput) widget.chatInput.disabled = false;
        if (widget.sendButton) widget.sendButton.disabled = false;
      },
      onMessage: data => handleSSEMessage(widget, data)
    }
  );
}

/**
 * Handle incoming SSE messages
 */
export function handleSSEMessage(widget: ChatWidget, data: StreamMessage | string): void {
  // Per-delta log — gated behind debug so a hot turn (50+ deltas/sec) doesn't
  // flood the host page's console.
  debug('Received raw SSE data', data);

  // Clear the loading timeout to prevent it from firing after we've received a message
  if (widget._loadingTimeout) {
    clearTimeout(widget._loadingTimeout);
    widget._loadingTimeout = null;
  }
  widget.hideLoading();

  let message: StreamMessage;
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
export async function handleStreamChunk(widget: ChatWidget, content: string): Promise<void> {
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
export async function handleReceivedMessage(
  widget: ChatWidget,
  message: StreamMessage
): Promise<void> {
  const messageContent = message.content || '';
  const messageType = message.type;
  console.log('Received message with content:', messageContent, 'type:', messageType);

  // Handle handoff acknowledgment - message was sent during human mode
  // Just silently acknowledge, the message is already displayed and saved
  if (messageType === 'handoff_ack') {
    console.log('✅ Handoff message acknowledged');
    // Re-enable input
    if (widget.chatInput) widget.chatInput.disabled = false;
    if (widget.sendButton) widget.sendButton.disabled = false;
    return;
  }

  // Tool activity (function + MCP) — render as a chip; no text content.
  if (messageType === 'tool') {
    widget._streamHandled = true;
    if (!document.getElementById(CSS_CLASSES.STREAMING_MESSAGE)) {
      startStreamingMessage(widget);
    }
    handleToolEvent(widget, message);
    return;
  }

  // Backend-signalled error — surface it and stop.
  if (messageType === 'error') {
    widget._streamHandled = true;
    widget._streamErrorShown = true;
    renderStreamError(
      widget,
      message.message ||
        (message.code === CONNECTION_LOST ? t('errors.connection_lost') : undefined)
    );
    return;
  }

  // Check for handoff event - can come in different formats:
  // 1. { type: 'handoff', status: 'human', ... }
  // 2. { handoff: { status: 'human', ... } }
  // 3. { status: 'human', conversation_id: '...', message: '...' }
  const isHandoffEvent =
    messageType === 'handoff' ||
    message.handoff ||
    (message.status && ['human', 'returned', 'ai'].includes(message.status));

  if (isHandoffEvent) {
    widget._streamHandled = true;
    const handoffData = message.handoff || message;
    console.log('🔄 Handoff event detected:', handoffData);

    // Finalize any streaming message before handling handoff
    if (widget.isStreaming) {
      finalizeStreamingMessage(widget);
    }

    await handleHandoffEvent(widget, handoffData);
    return;
  }

  const messageId = message.id || message.message_id;
  if (messageId) {
    widget.currentStreamedMessageId = messageId;
    console.log('Stored message ID:', messageId);
  }

  if (messageContent) {
    widget._streamHandled = true;
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
export function removeConnectionErrorMessages(widget: ChatWidget): void {
  // Marked by showConnectionError(): works in every language, unlike matching
  // the English error text.
  widget.messagesContainer
    ?.querySelectorAll(`.${CSS_CLASSES.CONNECTION_ERROR}`)
    .forEach(element => element.remove());
}
