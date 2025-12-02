/**
 * Message Handling Module
 * Handles message display, streaming, and markdown parsing
 */

import { CSS_CLASSES, DEFAULT_AVATAR_SVG, STREAMING_FINALIZE_TIMEOUT } from '../utils.js';
import { createElement, createIcon } from '../ui.js';

// Create a namespace for our libraries
export const MarkdownLibs = {
  marked: null,
  DOMPurify: null,
  _loadingPromise: null
};

// Shared DOMPurify configuration
export const DOMPURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'a', 'b', 'br', 'code', 'div', 'em', 'h1', 'h2', 'h3',
    'h4', 'h5', 'h6', 'hr', 'i', 'li', 'ol', 'p', 'pre',
    'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr',
    'ul', 'span', 'math', 'mi', 'mo', 'mn', 'mtext'
  ],
  ALLOWED_ATTR: ['href', 'target', 'class', 'rel', 'colspan', 'rowspan', 'style'],
  USE_PROFILES: { html: true },
  KEEP_CONTENT: true,
  ADD_ATTR: [
    ['target', '_blank'],
    ['rel', 'noopener noreferrer']
  ]
};

/**
 * Load markdown libraries dynamically
 */
export async function loadLibraries() {
  if (!MarkdownLibs._loadingPromise) {
    MarkdownLibs._loadingPromise = (async () => {
      try {
        const [markedModule, DOMPurifyModule] = await Promise.all([
          import('marked'),
          import('dompurify')
        ]);
        MarkdownLibs.marked = markedModule.marked;
        MarkdownLibs.DOMPurify = DOMPurifyModule.default;
        console.log('Libraries loaded successfully.');
      } catch (error) {
        console.error('Failed to load markdown libraries:', error);
        MarkdownLibs._loadingPromise = null;
      }
    })();
  }
  return MarkdownLibs._loadingPromise;
}

/**
 * Parse markdown text to HTML
 */
export async function parseMarkdown(text) {
  if (!text) return '';

  try {
    if (!MarkdownLibs.marked || !MarkdownLibs.DOMPurify) {
      await loadLibraries();
    }

    if (!MarkdownLibs.marked || !MarkdownLibs.DOMPurify) {
      console.warn('Markdown libraries failed to load, falling back to plain text');
      return escapeHtml(text);
    }

    MarkdownLibs.marked.setOptions({
      gfm: true,
      breaks: true,
      headerIds: false,
      mangle: false,
      smartLists: true,
      smartypants: true,
      xhtml: false,
      tables: true
    });

    let html = MarkdownLibs.marked.parse(text);
    html = MarkdownLibs.DOMPurify.sanitize(html, DOMPURIFY_CONFIG);
    return html;
  } catch (error) {
    console.error('Error parsing markdown:', error);
    return escapeHtml(text);
  }
}

/**
 * Escape HTML entities
 */
export function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br>');
}

/**
 * Add a message to the chat
 */
export async function addMessage(widget, type, text, addToHistory = true, options = {}) {
  console.log('addMessage called:', { type, text, addToHistory, messagesContainer: !!widget.messagesContainer });
  if (!widget.messagesContainer) {
    console.log('No messagesContainer found, returning null');
    return null;
  }

  const message = createElement('div', { className: `${CSS_CLASSES.MESSAGE} ${type}` });
  const contentWrapper = createElement('div', { className: 'chatvia-widget-content-wrapper' });

  if (type === CSS_CLASSES.MESSAGE_AGENT) {
    contentWrapper.appendChild(createAvatar(widget));
  }

  const bubble = createElement('div', { className: CSS_CLASSES.MESSAGE_BUBBLE });
  await setMessageBubbleContent(bubble, type, text);
  contentWrapper.appendChild(bubble);
  message.appendChild(contentWrapper);

  // Add action buttons for agent messages
  if (type === CSS_CLASSES.MESSAGE_AGENT && text && !options.hideActions) {
    const actionsContainer = createMessageActions(widget, text, options.messageId, options.feedback);
    message.appendChild(actionsContainer);
  }

  if (addToHistory) {
    addMessageToHistory(widget, type, text, options);
  }

  widget.messagesContainer.appendChild(message);
  widget.scrollToBottom();
  return message;
}

/**
 * Create avatar element
 */
export function createAvatar(widget) {
  const avatar = createElement('div', { className: CSS_CLASSES.MESSAGE_AVATAR });
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
export function createMessageActions(widget, messageText, messageId, feedback) {
  const actionsContainer = createElement('div', { 
    className: CSS_CLASSES.MESSAGE_ACTIONS 
  });

  // Copy button - always show
  const copyButton = createElement('button', {
    className: 'chatvia-widget-action-btn chatvia-widget-copy-btn',
    'aria-label': 'Copy message',
    title: 'Copy'
  });
  copyButton.appendChild(createIcon('copy'));
  copyButton.addEventListener('click', () => handleCopyMessage(messageText, copyButton));
  actionsContainer.appendChild(copyButton);

  // Only show feedback buttons if there's a message ID
  if (messageId) {
    // Thumbs up button
    const thumbsUpButton = createElement('button', {
      className: `chatvia-widget-action-btn chatvia-widget-thumbs-up${feedback === true ? ' chatvia-widget-active' : ''}`,
      'aria-label': 'Good response',
      title: 'Good response',
      'data-message-id': messageId
    });
    thumbsUpButton.appendChild(createIcon('thumbs-up'));

    // Thumbs down button
    const thumbsDownButton = createElement('button', {
      className: `chatvia-widget-action-btn chatvia-widget-thumbs-down${feedback === false ? ' chatvia-widget-active' : ''}`,
      'aria-label': 'Bad response',
      title: 'Bad response',
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
        'x-agent-id': widget.agentId,
        'x-session-id': widget.sessionId,
        'x-thread-id': widget.getCurrentActiveThreadId(),
        'x-message-id': messageId
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
async function setMessageBubbleContent(bubble, type, text) {
  if (type === CSS_CLASSES.MESSAGE_AGENT) {
    bubble.innerHTML = await parseMarkdown(text);
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
    activeThread.updatedAt = new Date().toISOString();

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
    await addMessage(widget, CSS_CLASSES.MESSAGE_SYSTEM, 'SSE client error. Cannot send message.', false, {
      retryText: text
    });
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

  console.log('Sending SSE message:', messagePayload);

  const success = await widget.sseClient.send(messagePayload);

  if (!success) {
    console.error('Failed to send message via SSE.');
    clearTimeout(widget._loadingTimeout);
    widget.hideLoading();
    await addMessage(widget, CSS_CLASSES.MESSAGE_SYSTEM, 'Failed to send message. Please try again.', false, {
      retryText: text
    });
    widget.chatInput.disabled = false;
    widget.sendButton.disabled = false;
  } else {
    widget.chatInput.disabled = true;
    widget.sendButton.disabled = true;
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
      const messageType = message.role 
        ? widget._mapRoleToMessageType(message.role) 
        : message.type;
      const isWelcomeMessage = widget.settings.welcome_message && 
        message.content === widget.settings.welcome_message;
      await addMessage(widget, messageType, message.content, false, {
        messageId: message.id,
        feedback: message.feedback,
        hideActions: isWelcomeMessage
      });
    }
  } else if (widget.settings.welcome_message) {
    console.log('Welcome message exists:', widget.settings.welcome_message);
    const activeThread = widget.getActiveThread();
    console.log('Active thread:', activeThread);

    if (activeThread && !activeThread.welcomeShown) {
      console.log('Showing welcome message');
      activeThread.welcomeShown = true;
      
      setTimeout(async () => {
        console.log('Welcome message timeout fired, calling addMessage');
        const result = await addMessage(widget, CSS_CLASSES.MESSAGE_AGENT, widget.settings.welcome_message, false, {
          hideActions: true
        });
        console.log('addMessage result:', result);
      }, 500);
    } else {
      console.log('Welcome message already shown or no active thread');
    }
  } else {
    console.log('No welcome message in settings');
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
  
  const contentWrapper = createElement('div', { className: 'chatvia-widget-content-wrapper' });
  contentWrapper.appendChild(createAvatar(widget));
  const messageBubble = createElement('div', { className: CSS_CLASSES.MESSAGE_BUBBLE });
  contentWrapper.appendChild(messageBubble);
  
  streamingMsgElement.appendChild(contentWrapper);
  widget.messagesContainer.appendChild(streamingMsgElement);
  widget.scrollToBottom();
}

/**
 * Update streaming message
 */
export async function updateStreamingMessage(widget) {
  const streamingMsgElement = document.getElementById(CSS_CLASSES.STREAMING_MESSAGE);
  if (streamingMsgElement) {
    const messageBubble = streamingMsgElement.querySelector(`.${CSS_CLASSES.MESSAGE_BUBBLE}`);
    if (messageBubble) {
      await updateMessageBubbleContent(messageBubble, widget.currentStreamedMessage);
    }

    // Create action buttons early
    if (!streamingMsgElement.querySelector(`.${CSS_CLASSES.MESSAGE_ACTIONS}`) && 
        widget.currentStreamedMessage && 
        widget.currentStreamedMessage.trim().length > 0) {
      const actionsContainer = createMessageActions(
        widget, 
        widget.currentStreamedMessage, 
        widget.currentStreamedMessageId, 
        null
      );
      streamingMsgElement.appendChild(actionsContainer);
    }

    widget.scrollToBottom();
  }
}

/**
 * Update message bubble content
 */
export async function updateMessageBubbleContent(messageBubble, content) {
  try {
    if (!MarkdownLibs.marked || !MarkdownLibs.DOMPurify) {
      await loadLibraries();
    }
    
    if (MarkdownLibs.marked && MarkdownLibs.DOMPurify) {
      MarkdownLibs.marked.setOptions({
        gfm: true,
        breaks: true,
        headerIds: false,
        mangle: false,
        smartLists: true,
        smartypants: true,
        xhtml: false,
        tables: true
      });

      let html = MarkdownLibs.marked.parse(content);
      html = MarkdownLibs.DOMPurify.sanitize(html, DOMPURIFY_CONFIG);
      messageBubble.innerHTML = html;
    } else {
      messageBubble.textContent = content;
    }
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
  console.log('Finalizing streaming message');

  clearSSETimeouts(widget);
  widget.hideLoading();

  let finalMessage = widget.currentStreamedMessage;
  let shouldShowLeadForm = false;

  if (finalMessage.includes('<ShowLeadForm/>')) {
    console.log('ShowLeadForm detected in final message! Triggering lead form');
    finalMessage = finalMessage.replace('<ShowLeadForm/>', '').trim();
    shouldShowLeadForm = true;
  }

  const streamingMsgElement = document.getElementById(CSS_CLASSES.STREAMING_MESSAGE);
  if (streamingMsgElement && finalMessage !== '') {
    const messageBubble = streamingMsgElement.querySelector(`.${CSS_CLASSES.MESSAGE_BUBBLE}`);
    if (messageBubble) {
      await updateMessageBubbleContent(messageBubble, finalMessage);
    }

    let actionsContainer = streamingMsgElement.querySelector(`.${CSS_CLASSES.MESSAGE_ACTIONS}`);
    
    if (!actionsContainer) {
      actionsContainer = createMessageActions(widget, finalMessage, widget.currentStreamedMessageId);
      streamingMsgElement.appendChild(actionsContainer);
    } else if (widget.currentStreamedMessageId) {
      enableStreamingMessageActions(widget, widget.currentStreamedMessageId);
    }

    streamingMsgElement.classList.remove(CSS_CLASSES.STREAMING);
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

  if (shouldShowLeadForm) {
    console.log('Showing lead form after message finalization');
    widget._showLeadForm();
  }

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
 * Enable streaming message actions (add feedback buttons when messageId arrives)
 */
export function enableStreamingMessageActions(widget, messageId) {
  const streamingElement = document.getElementById(CSS_CLASSES.STREAMING_MESSAGE);
  if (!streamingElement || !messageId) return;
  
  let actionsContainer = streamingElement.querySelector(`.${CSS_CLASSES.MESSAGE_ACTIONS}`);
  
  if (actionsContainer) {
    // Check if feedback buttons already exist
    let thumbsUpBtn = actionsContainer.querySelector(`.${CSS_CLASSES.MESSAGE_THUMBS_UP}`);
    let thumbsDownBtn = actionsContainer.querySelector(`.${CSS_CLASSES.MESSAGE_THUMBS_DOWN}`);
    
    // If no feedback buttons exist yet, add them now that we have a messageId
    if (!thumbsUpBtn && !thumbsDownBtn) {
      // Thumbs up button
      thumbsUpBtn = createElement('button', {
        className: `chatvia-widget-action-btn chatvia-widget-thumbs-up`,
        'aria-label': 'Good response',
        title: 'Good response',
        'data-message-id': messageId
      });
      thumbsUpBtn.appendChild(createIcon('thumbs-up'));
      
      // Thumbs down button
      thumbsDownBtn = createElement('button', {
        className: `chatvia-widget-action-btn chatvia-widget-thumbs-down`,
        'aria-label': 'Bad response',
        title: 'Bad response',
        'data-message-id': messageId
      });
      thumbsDownBtn.appendChild(createIcon('thumbs-down'));
      
      // Add event listeners
      thumbsUpBtn.addEventListener('click', () => 
        handleFeedback(widget, messageId, true, thumbsUpBtn, thumbsDownBtn)
      );
      thumbsDownBtn.addEventListener('click', () => 
        handleFeedback(widget, messageId, false, thumbsDownBtn, thumbsUpBtn)
      );
      
      actionsContainer.appendChild(thumbsUpBtn);
      actionsContainer.appendChild(thumbsDownBtn);
    }
  } else if (widget.currentStreamedMessage && widget.currentStreamedMessage.trim().length > 0) {
    // No actions container yet, create one with messageId (so it will include feedback buttons)
    actionsContainer = createMessageActions(widget, widget.currentStreamedMessage, messageId, null);
    streamingElement.appendChild(actionsContainer);
  }
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

