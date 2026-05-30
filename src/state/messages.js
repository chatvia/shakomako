/**
 * Message Handling Module
 * Handles message display, streaming, and markdown parsing
 */

import { CSS_CLASSES, DEFAULT_AVATAR_SVG, STREAMING_FINALIZE_TIMEOUT, debug } from '../utils.js';
import { createElement, createIcon } from '../ui.js';
import { isInHumanMode, sendMessageInHumanMode, subscribeToConversation } from './handoff.js';
import { t } from '../i18n.js';
// Canonical markdown impl lives in markdown.js. Import for local use, and
// re-export so existing call sites that go through messages.js keep working.
import { parseMarkdown, escapeHtml } from '../markdown.js';
export { parseMarkdown, escapeHtml };

/**
 * Add a message to the chat
 */
export async function addMessage(widget, type, text, addToHistory = true, options = {}) {
  if (!widget.messagesContainer) return null;

  const isHumanAgentMessage = options.isHuman === true;

  // Build class list - add human agent class if from human agent
  let messageClass = `${CSS_CLASSES.MESSAGE} ${type}`;
  if (isHumanAgentMessage) {
    messageClass += ` ${CSS_CLASSES.MESSAGE_HUMAN_AGENT}`;
  }

  const message = createElement('div', { className: messageClass });
  const contentWrapper = createElement('div', { className: 'chatvia-widget-content-wrapper' });

  if (type === CSS_CLASSES.MESSAGE_AGENT) {
    contentWrapper.appendChild(createAvatar(widget, isHumanAgentMessage));
  }

  const bubble = createElement('div', { className: CSS_CLASSES.MESSAGE_BUBBLE });
  await setMessageBubbleContent(bubble, type, text);
  contentWrapper.appendChild(bubble);
  message.appendChild(contentWrapper);

  // Add action buttons for AI assistant messages only (not human agent messages)
  // Timestamp goes inside actions for AI messages, standalone otherwise
  const hasActions =
    type === CSS_CLASSES.MESSAGE_AGENT && text && !options.hideActions && !isHumanAgentMessage;

  if (hasActions) {
    const actionsContainer = createMessageActions(
      widget,
      text,
      options.messageId,
      options.feedback,
      options.timestamp
    );
    message.appendChild(actionsContainer);
  } else if (options.timestamp || options.isHuman) {
    // Standalone timestamp for user messages and human agent messages
    const timeElement = createElement('div', {
      className: CSS_CLASSES.MESSAGE_TIME,
      title: options.timestamp ? formatFullDate(options.timestamp) : ''
    });

    // Add read status for user messages in human mode
    if (type === CSS_CLASSES.MESSAGE_USER && widget.handoffMode === 'human') {
      const readStatus = createReadStatusIndicator(options.readAt);
      timeElement.appendChild(readStatus);
    }

    if (options.timestamp) {
      const timeText = document.createTextNode(formatMessageTime(options.timestamp));
      timeElement.appendChild(timeText);
    }

    message.appendChild(timeElement);
  }

  if (addToHistory) {
    addMessageToHistory(widget, type, text, options);
  }

  widget.messagesContainer.appendChild(message);
  widget.scrollToBottom();
  return message;
}

/**
 * Format timestamp for display
 */
function formatMessageTime(timestamp) {
  if (!timestamp) return '';

  let date;

  // Handle Unix timestamp (seconds) - if it's a number less than year 3000 in seconds
  if (typeof timestamp === 'number' && timestamp < 32503680000) {
    date = new Date(timestamp * 1000); // Convert seconds to milliseconds
  } else {
    date = new Date(timestamp);
  }

  // Check if date is valid and reasonable (not before year 2000)
  if (isNaN(date.getTime()) || date.getFullYear() < 2000) {
    return '';
  }

  const now = new Date();
  const diffMs = now - date;

  // If negative or very small, it's "just now"
  if (diffMs < 0) return t('threads.just_now');

  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return t('threads.just_now');
  if (diffMins === 1) return t('threads.minute_ago');
  if (diffMins < 60) return t('threads.minutes_ago', { count: diffMins });
  if (diffHours === 1) return t('threads.hour_ago');
  if (diffHours < 24) return t('threads.hours_ago', { count: diffHours });
  if (diffDays === 1) return t('threads.yesterday');
  if (diffDays < 30) return t('threads.days_ago', { count: diffDays });

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;

  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`;
}

/**
 * Format full date for tooltip
 */
function formatFullDate(timestamp) {
  if (!timestamp) return '';

  let date;

  // Handle Unix timestamp (seconds) - if it's a number less than year 3000 in seconds
  if (typeof timestamp === 'number' && timestamp < 32503680000) {
    date = new Date(timestamp * 1000); // Convert seconds to milliseconds
  } else {
    date = new Date(timestamp);
  }

  // Check if date is valid and reasonable
  if (isNaN(date.getTime()) || date.getFullYear() < 2000) {
    return '';
  }

  return date.toLocaleString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Create read status indicator (checkmarks for sent/read)
 */
function createReadStatusIndicator(readAt) {
  const container = createElement('span', {
    className: `chatvia-widget-read-status ${readAt ? 'read' : ''}`
  });

  // Double checkmark SVG
  const checkSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 6L7 17l-5-5"/>
      <path d="M22 6L11 17"/>
    </svg>
  `;

  container.innerHTML = checkSvg;
  container.title = readAt ? 'Read' : 'Sent';

  return container;
}

/**
 * Create avatar element
 */
// Human agent icon SVG
const HUMAN_AGENT_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
    <circle cx="12" cy="7" r="4"></circle>
  </svg>
`;

export function createAvatar(widget, isHumanAgent = false) {
  const avatar = createElement('div', { className: CSS_CLASSES.MESSAGE_AVATAR });

  // Human agents always show person icon
  if (isHumanAgent) {
    avatar.innerHTML = HUMAN_AGENT_SVG;
    return avatar;
  }

  // AI assistant shows brand logo or default bot icon
  const brandLogoUrl = widget.settings.branding?.logo_url;
  if (brandLogoUrl) {
    const avatarImg = createElement('img', {
      src: brandLogoUrl,
      alt: 'Assistant'
    });
    avatar.appendChild(avatarImg);
  } else {
    avatar.innerHTML = DEFAULT_AVATAR_SVG;
  }
  return avatar;
}

/**
 * Create message action buttons
 */
export function createMessageActions(widget, messageText, messageId, feedback, timestamp) {
  const actionsContainer = createElement('div', {
    className: CSS_CLASSES.MESSAGE_ACTIONS
  });

  // Copy button - always show (left side)
  const copyButton = createElement('button', {
    className: 'chatvia-widget-action-btn chatvia-widget-copy-btn',
    'aria-label': t('messages.copy_message'),
    title: t('messages.copy')
  });
  copyButton.appendChild(createIcon('copy'));
  copyButton.addEventListener('click', () => handleCopyMessage(messageText, copyButton));
  actionsContainer.appendChild(copyButton);

  // Only show feedback buttons if there's a message ID
  if (messageId) {
    // Thumbs up button
    const thumbsUpButton = createElement('button', {
      className: `chatvia-widget-action-btn chatvia-widget-thumbs-up${feedback === true ? ' chatvia-widget-active' : ''}`,
      'aria-label': t('messages.good_response'),
      title: t('messages.good_response'),
      'data-message-id': messageId
    });
    thumbsUpButton.appendChild(createIcon('thumbs-up'));

    // Thumbs down button
    const thumbsDownButton = createElement('button', {
      className: `chatvia-widget-action-btn chatvia-widget-thumbs-down${feedback === false ? ' chatvia-widget-active' : ''}`,
      'aria-label': t('messages.bad_response'),
      title: t('messages.bad_response'),
      'data-message-id': messageId
    });
    thumbsDownButton.appendChild(createIcon('thumbs-down'));

    // Add event listeners
    thumbsUpButton.addEventListener('click', () =>
      handleFeedback(widget, messageId, true, thumbsUpButton, thumbsDownButton)
    );
    thumbsDownButton.addEventListener('click', () =>
      handleFeedback(widget, messageId, false, thumbsDownButton, thumbsUpButton)
    );

    actionsContainer.appendChild(thumbsUpButton);
    actionsContainer.appendChild(thumbsDownButton);
  }

  // Add timestamp after feedback buttons (with divider)
  if (timestamp) {
    const timeElement = createElement('div', {
      className: CSS_CLASSES.MESSAGE_TIME,
      title: formatFullDate(timestamp) // Full date on hover
    });
    timeElement.textContent = formatMessageTime(timestamp);
    actionsContainer.appendChild(timeElement);
  }

  return actionsContainer;
}

/**
 * Handle copy message action
 */
export async function handleCopyMessage(text, button) {
  try {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = text;
    const plainText = tempDiv.textContent || tempDiv.innerText || text;

    await navigator.clipboard.writeText(plainText);

    const originalIcon = button.innerHTML;
    button.innerHTML = '';
    button.appendChild(createIcon('check'));
    button.classList.add('chatvia-widget-copied');

    setTimeout(() => {
      button.innerHTML = originalIcon;
      button.classList.remove('chatvia-widget-copied');
    }, 2000);
  } catch (error) {
    console.error('Failed to copy message:', error);
  }
}

/**
 * Handle feedback action
 */
export async function handleFeedback(widget, messageId, isPositive, clickedButton, otherButton) {
  if (!messageId) return;

  const isAlreadyActive = clickedButton.classList.contains('chatvia-widget-active');

  try {
    const api = (await import('../api.js')).default;

    const response = await api({
      endpoint: 'feedback',
      method: 'POST',
      headers: {
        'X-AGENT-ID': widget.agentId,
        'X-SESSION-ID': widget.sessionId,
        'X-THREAD-ID': widget.getCurrentActiveThreadId(),
        'X-MESSAGE-ID': messageId
      },
      body: JSON.stringify({ feedback: isPositive })
    });

    if (response.ok) {
      if (isAlreadyActive) {
        clickedButton.classList.remove('chatvia-widget-active');
      } else {
        clickedButton.classList.add('chatvia-widget-active');
        otherButton.classList.remove('chatvia-widget-active');
      }
    } else {
      console.error('Failed to submit feedback:', response.status);
    }
  } catch (error) {
    console.error('Error submitting feedback:', error);
  }
}

/**
 * Set message bubble content
 */
function setMessageBubbleContent(bubble, type, text) {
  if (type === CSS_CLASSES.MESSAGE_AGENT) {
    bubble.innerHTML = parseMarkdown(text);
  } else {
    bubble.textContent = text;
  }
}

/**
 * Add message to history
 */
function addMessageToHistory(widget, type, text, options) {
  const messageData = { type, text, timestamp: new Date().toISOString(), options };
  widget.messageHistory.push(messageData);
  const activeThread = widget.getActiveThread();

  if (activeThread) {
    if (!Array.isArray(activeThread.messages)) activeThread.messages = [];
    activeThread.messages.push(messageData);

    if (type === CSS_CLASSES.MESSAGE_USER) {
      activeThread.hasUserInteraction = true;
      widget._updateThreadActionButtons();
    }
  }
}

/**
 * Send user message
 */
export async function sendUserMessage(widget, customText) {
  const text = customText || widget.chatInput.value.trim();
  if (!text) return;

  await addMessage(widget, CSS_CLASSES.MESSAGE_USER, text, true);

  if (!customText) {
    widget.chatInput.value = '';
    widget.autoResizeInput();
  }

  widget.hideStarters();

  const activeThread = widget.getActiveThread();
  if (activeThread) {
    activeThread.hasUserInteraction = true;
    widget._updateThreadActionButtons();
  }

  // Check if we're in human mode (handoff active)
  if (isInHumanMode(widget)) {
    // In human mode, send via HTTP POST (WebSocket receives response)
    debug('Sending message in human mode');
    const success = await sendMessageInHumanMode(widget, text);

    if (!success) {
      const el = await addMessage(
        widget,
        CSS_CLASSES.MESSAGE_SYSTEM,
        'Failed to send message. Please try again.',
        false,
        {
          retryText: text
        }
      );
      el?.classList.add('error');
    }

    widget.scrollToBottom();
    return;
  }

  // AI mode - use SSE
  // Clear any previous loading timeout
  if (widget._loadingTimeout) {
    clearTimeout(widget._loadingTimeout);
  }

  // Store timeout on widget so it can be cleared when SSE message arrives
  widget._loadingTimeout = setTimeout(() => {
    if (!document.getElementById(CSS_CLASSES.STREAMING_MESSAGE)) {
      widget.showLoading();
    }
  }, 150);

  if (!widget.sseClient) {
    console.error('SSE client not initialized.');
    clearTimeout(widget._loadingTimeout);
    widget.hideLoading();
    const el = await addMessage(
      widget,
      CSS_CLASSES.MESSAGE_SYSTEM,
      'SSE client error. Cannot send message.',
      false,
      {
        retryText: text
      }
    );
    el?.classList.add('error');
    return;
  }

  const messagePayload = {
    session_id: widget.sessionId,
    thread_id: widget.getCurrentActiveThreadId(),
    type: 'message',
    content: text,
    url: window.location.href,
    referrer: document.referrer || ''
  };

  // Don't log full payload in production — it contains user content.
  debug('Sending SSE message', { thread_id: messagePayload.thread_id });

  // Reset per-turn stream flags used by the silent-close error guard.
  widget._streamHandled = false;
  widget._streamErrorShown = false;

  const success = await widget.sseClient.send(messagePayload);

  if (!success) {
    console.error('Failed to send message via SSE.');
    clearTimeout(widget._loadingTimeout);
    widget.hideLoading();
    const el = await addMessage(
      widget,
      CSS_CLASSES.MESSAGE_SYSTEM,
      'Failed to send message. Please try again.',
      false,
      {
        retryText: text
      }
    );
    el?.classList.add('error');
    widget.chatInput.disabled = false;
    widget.sendButton.disabled = false;
  } else {
    widget.chatInput.disabled = true;
    widget.sendButton.disabled = true;

    // Subscribe to WebSocket now that we have a conversation on the server
    // This enables receiving admin takeover events
    if (!widget.pusherChannel) {
      subscribeToConversation(widget);
    }
  }

  widget.scrollToBottom();
}

/**
 * Display history messages
 */
export async function displayHistoryMessages(widget) {
  widget.clearMessages();

  if (widget.messageHistory && widget.messageHistory.length > 0) {
    for (const message of widget.messageHistory) {
      const messageType = message.role ? mapRoleToMessageType(message.role) : message.type;
      const isWelcomeMessage =
        widget.settings.welcome_message && message.content === widget.settings.welcome_message;
      const isHumanAgent = message.role === 'agent';
      await addMessage(widget, messageType, message.content, false, {
        messageId: message.id,
        feedback: message.feedback,
        hideActions: isWelcomeMessage,
        isHuman: isHumanAgent,
        timestamp: message.created_at || message.timestamp,
        readAt: message.read_at
      });
    }
  } else if (widget.settings.welcome_message) {
    const activeThread = widget.getActiveThread();
    if (activeThread && !activeThread.welcomeShown) {
      activeThread.welcomeShown = true;
      // Tracked on the widget so destroy() can cancel it; the original code
      // leaked this 500ms timer if the widget was torn down during the gap.
      widget._welcomeMessageTimeout = setTimeout(async () => {
        widget._welcomeMessageTimeout = null;
        await addMessage(
          widget,
          CSS_CLASSES.MESSAGE_AGENT,
          widget.settings.welcome_message,
          false,
          {
            hideActions: true
          }
        );
      }, 500);
    }
  }
}

/**
 * Start streaming message
 */
export function startStreamingMessage(widget) {
  if (document.getElementById(CSS_CLASSES.STREAMING_MESSAGE) || !widget.messagesContainer) {
    return;
  }

  const streamingMsgElement = createElement('div', {
    className: `${CSS_CLASSES.MESSAGE} ${CSS_CLASSES.MESSAGE_AGENT}`,
    id: CSS_CLASSES.STREAMING_MESSAGE
  });

  // Tool activity lives OUTSIDE the bubble (the bubble's innerHTML is
  // overwritten on every delta). Holds the transient "calling tool" shimmer.
  const toolActivity = createElement('div', { className: CSS_CLASSES.TOOL_ACTIVITY });
  streamingMsgElement.appendChild(toolActivity);
  widget._activeToolCalls = new Set();

  const contentWrapper = createElement('div', { className: 'chatvia-widget-content-wrapper' });
  // Hidden until the first text delta arrives, so a tool-call shimmer shows on
  // its own with no empty avatar/bubble beneath it.
  contentWrapper.style.display = 'none';
  const avatar = createAvatar(widget);
  avatar.classList.add(CSS_CLASSES.STREAMING); // drives the avatar typing pulse
  contentWrapper.appendChild(avatar);
  const messageBubble = createElement('div', { className: CSS_CLASSES.MESSAGE_BUBBLE });
  contentWrapper.appendChild(messageBubble);

  streamingMsgElement.appendChild(contentWrapper);
  widget.messagesContainer.appendChild(streamingMsgElement);
  widget.scrollToBottom();
}

/**
 * Schedule a streaming re-render, coalesced to one paint per animation frame.
 * SSE deltas can arrive far faster than the browser paints; rendering each one
 * re-parsed + DOMPurify-sanitized the entire accumulated message, making a turn
 * O(N²) in its own length. Instead we render the latest text once per frame.
 */
export function updateStreamingMessage(widget) {
  if (widget._streamRenderScheduled) return;
  widget._streamRenderScheduled = true;
  widget._streamRenderRAF = requestAnimationFrame(() => {
    widget._streamRenderScheduled = false;
    widget._streamRenderRAF = null;
    renderStreamingMessageNow(widget);
  });
}

/**
 * Render the current accumulated streamed text synchronously. Always reads the
 * live widget.currentStreamedMessage, so one frame reflects every delta that
 * landed since the previous paint.
 */
function renderStreamingMessageNow(widget) {
  const streamingMsgElement = document.getElementById(CSS_CLASSES.STREAMING_MESSAGE);
  if (!streamingMsgElement) return;

  const messageBubble = streamingMsgElement.querySelector(`.${CSS_CLASSES.MESSAGE_BUBBLE}`);
  if (messageBubble) {
    // Reveal the avatar/bubble row now that real text is streaming in
    // (it stays hidden during a tool-call shimmer, see startStreamingMessage).
    if (widget.currentStreamedMessage) {
      const wrapper = messageBubble.closest('.chatvia-widget-content-wrapper');
      if (wrapper) wrapper.style.display = '';
    }
    updateMessageBubbleContent(messageBubble, widget.currentStreamedMessage);
  }

  widget.scrollToBottom();
}

/**
 * Update message bubble content
 */
export function updateMessageBubbleContent(messageBubble, content) {
  try {
    messageBubble.innerHTML = parseMarkdown(content);
  } catch (error) {
    console.error('Error processing markdown:', error);
    messageBubble.textContent = content;
  }
}

/**
 * Finalize streaming message
 */
export async function finalizeStreamingMessage(widget) {
  if (!widget.isStreaming) return;

  // Cancel any pending coalesced render; we render the final text synchronously
  // below, so a late frame must not overwrite or re-append actions.
  if (widget._streamRenderRAF) {
    cancelAnimationFrame(widget._streamRenderRAF);
    widget._streamRenderRAF = null;
  }
  widget._streamRenderScheduled = false;

  debug('Finalizing streaming message');

  clearSSETimeouts(widget);
  widget.hideLoading();

  const finalMessage = widget.currentStreamedMessage;

  const streamingMsgElement = document.getElementById(CSS_CLASSES.STREAMING_MESSAGE);
  if (streamingMsgElement && finalMessage !== '') {
    const messageBubble = streamingMsgElement.querySelector(`.${CSS_CLASSES.MESSAGE_BUBBLE}`);
    if (messageBubble) {
      // Ensure the row is visible (e.g. a single-shot final message that never
      // went through updateStreamingMessage's reveal).
      const wrapper = messageBubble.closest('.chatvia-widget-content-wrapper');
      if (wrapper) wrapper.style.display = '';
      await updateMessageBubbleContent(messageBubble, finalMessage);
    }

    const actionsContainer = createMessageActions(
      widget,
      finalMessage,
      widget.currentStreamedMessageId
    );
    streamingMsgElement.appendChild(actionsContainer);

    streamingMsgElement
      .querySelector(`.${CSS_CLASSES.MESSAGE_AVATAR}`)
      ?.classList.remove(CSS_CLASSES.STREAMING);
    streamingMsgElement.removeAttribute('id');

    addMessageToHistory(widget, CSS_CLASSES.MESSAGE_AGENT, finalMessage, {
      messageId: widget.currentStreamedMessageId
    });
  } else if (streamingMsgElement) {
    streamingMsgElement.remove();
  }

  widget.isStreaming = false;
  widget.currentStreamedMessage = '';
  widget.currentStreamedMessageId = null;

  if (widget.chatInput) {
    widget.chatInput.disabled = false;
    widget.chatInput.focus();
  }
  if (widget.sendButton) {
    widget.sendButton.disabled = false;
  }
  widget.autoResizeInput();
}

/**
 * Show a transient "calling external tool" shimmer while a function/MCP call
 * runs, then hide it once every active call has finished so the answer can
 * stream in below. Tracked by tool_call_id so parallel or sequential calls
 * keep the indicator visible until the last one ends — no per-tool icons.
 */
export function handleToolEvent(widget, tool) {
  const streamingMsgElement = document.getElementById(CSS_CLASSES.STREAMING_MESSAGE);
  if (!streamingMsgElement || !tool || !tool.tool_call_id) return;

  const container = streamingMsgElement.querySelector(`.${CSS_CLASSES.TOOL_ACTIVITY}`);
  if (!container) return;

  if (!widget._activeToolCalls) widget._activeToolCalls = new Set();

  if (tool.phase === 'start') {
    widget._activeToolCalls.add(tool.tool_call_id);
    if (!container.firstChild) {
      container.appendChild(
        createElement('div', {
          className: CSS_CLASSES.TOOL_CALLING,
          textContent: t('tool.calling')
        })
      );
    }
    widget.scrollToBottom();
    return;
  }

  if (tool.phase === 'end') {
    widget._activeToolCalls.delete(tool.tool_call_id);
    if (widget._activeToolCalls.size === 0) {
      container.innerHTML = '';
    }
  }
}

/**
 * Surface a stream error as a system message. Used for backend `error`
 * events, transport failures, and silent empty closes (so the user always
 * sees something instead of a stuck/empty turn).
 */
export async function renderStreamError(widget, message) {
  widget.hideLoading();

  // Drop an empty streaming bubble so we don't leave a blank assistant turn.
  const streamingMsgElement = document.getElementById(CSS_CLASSES.STREAMING_MESSAGE);
  if (streamingMsgElement && !widget.currentStreamedMessage) {
    streamingMsgElement.remove();
  }

  const text = message || t('errors.response_failed');
  const el = await addMessage(widget, CSS_CLASSES.MESSAGE_SYSTEM, text, false);
  // `.error` swaps the default (green handoff-style) system bubble for the
  // red error variant + warning-triangle icon defined in widget.css.
  el?.classList.add('error');

  if (widget.chatInput) widget.chatInput.disabled = false;
  if (widget.sendButton) widget.sendButton.disabled = false;
  widget.scrollToBottom();
}

/**
 * Clear SSE timeouts
 */
export function clearSSETimeouts(widget) {
  if (widget._sseMessageLoadingTimeout) {
    clearTimeout(widget._sseMessageLoadingTimeout);
    widget._sseMessageLoadingTimeout = null;
  }
  if (widget._finalizeTimeout) {
    clearTimeout(widget._finalizeTimeout);
    widget._finalizeTimeout = null;
  }
}

/**
 * Reset finalize timeout
 */
export function resetFinalizeTimeout(widget) {
  if (widget._finalizeTimeout) clearTimeout(widget._finalizeTimeout);
  widget._finalizeTimeout = setTimeout(
    () => finalizeStreamingMessage(widget),
    STREAMING_FINALIZE_TIMEOUT
  );
}

/**
 * Map role to message type
 */
export function mapRoleToMessageType(role) {
  switch (role) {
    case 'user':
      return CSS_CLASSES.MESSAGE_USER;
    case 'assistant':
      return CSS_CLASSES.MESSAGE_AGENT;
    case 'system':
      return CSS_CLASSES.MESSAGE_SYSTEM;
    default:
      return CSS_CLASSES.MESSAGE_AGENT;
  }
}
