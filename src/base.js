import { createSSEClient } from './sse.js';
import { getSettings } from './settings.js';
import { SessionManager } from './sessions.js';
import { AgentManager } from './agent.js';
import StorageManager from './storage.js';
import { createElement, createIcon } from './ui.js';
import { CSS_CLASSES } from './utils.js';

// Create a namespace for our libraries
const WidgetLibs = {
  marked: null,
  DOMPurify: null,
  _loadingPromise: null,
  _loaded: false
};

// Load libraries dynamically
// Returns true if libraries loaded successfully, false otherwise
const loadLibraries = async () => {
  // Already loaded successfully
  if (WidgetLibs._loaded && WidgetLibs.marked && WidgetLibs.DOMPurify) {
    return true;
  }
  
  // Loading in progress, wait for it
  if (WidgetLibs._loadingPromise) {
    await WidgetLibs._loadingPromise;
    return WidgetLibs._loaded;
  }
  
  // Start loading
  WidgetLibs._loadingPromise = (async () => {
    try {
      const [markedModule, DOMPurifyModule] = await Promise.all([
        import('marked'),
        import('dompurify')
      ]);
      WidgetLibs.marked = markedModule.marked;
      WidgetLibs.DOMPurify = DOMPurifyModule.default;
      WidgetLibs._loaded = true;
      console.log('Markdown libraries loaded successfully.');
      return true;
    } catch (error) {
      console.error('Failed to load markdown libraries:', error);
      WidgetLibs._loadingPromise = null;
      WidgetLibs._loaded = false;
      return false;
    }
  })();
  
  return WidgetLibs._loadingPromise;
};

export { WidgetLibs, loadLibraries };

export class BaseWidget {
  constructor(agentId) {
    this.agentId = agentId;
    this.sessionId = null;
    this.threadId = null;
    this.threads = [];
    this.settings = {};

    this.agentManager = new AgentManager(agentId);
    this.sessionManager = null;
    this.storageManager = null;

    this.messageHistory = [];
    this.sseClient = null;
    this.currentStreamedMessage = '';
    this.isStreaming = false;
  }

  async init() {
    await this._verifyClient();
    this.settings = await getSettings(this.agentId);
    console.log('Settings loaded:', this.settings);

    this.sessionManager = new SessionManager(this.agentId);
    await this._initializeSession();

    this.storageManager = new StorageManager(this.agentId, this.sessionId);
    await this.initThreads();

    this.setupSSE();
    await loadLibraries();
  }

  async _verifyClient() {
    const isVerified = await this.agentManager.verifyClient();
    if (!isVerified) {
      console.error('Client verification failed.');
      throw new Error('Client verification failed');
    }
    console.log('Client verified.');
  }

  async _initializeSession() {
    console.log('Initializing session...');
    const sessionId = await this.sessionManager.startSession();

    if (!sessionId) {
      console.error('Failed to initialize session.');
      throw new Error('Session initialization failed');
    }

    this.sessionId = sessionId;
    console.log('Session initialized:', sessionId);
  }

  async initThreads() {
    console.log('Initializing threads...');
    try {
      const { threads, activeThreadId } = await this.storageManager.loadThreads();
      console.log('Loaded threads from API:', threads, 'Active ID:', activeThreadId);

      this.threads = threads || [];
      this.threadId = activeThreadId || null;

      if (this.threadId && this.threads.length > 0) {
        const activeThreadExists = this.threads.find(t => t.id === this.threadId);
        if (!activeThreadExists) {
          console.log('Stored active thread no longer exists, selecting first available thread');
          const firstThread = this.threads[0];
          this.storageManager.setActiveThreadId(firstThread.id);
          this.threadId = firstThread.id;
        }
      }

      if (this.threads.length === 0) {
        console.log('No threads found, creating a new one...');
        await this.createNewThread();
      }
      console.log(`Active thread ID: ${this.threadId}`);
    } catch (error) {
      console.error('Error initializing threads:', error);
      throw error;
    }
  }

  getActiveThread() {
    if (!this.threadId || !this.threads || this.threads.length === 0) {
      return null;
    }
    return this.threads.find(t => t.id === this.threadId) || null;
  }

  async createNewThread() {
    console.log('Requesting new thread from API...');
    try {
      const newThread = await this.storageManager.createNewThread();
      if (newThread) {
        this.threads.unshift(newThread);
        this.threadId = newThread.id;
        this.messageHistory = [];
        console.log('New thread created successfully:', newThread);

        this.setupSSE();
        return newThread;
      } else {
        console.error('API did not return a new thread object.');
        return null;
      }
    } catch (error) {
      console.error('Failed to create new thread:', error);
      return null;
    }
  }

  setupSSE() {
    if (this.sseClient) {
      this.sseClient.close();
    }

    this.sseClient = createSSEClient(
      this.agentId,
      this.sessionId,
      this.threadId,
      {
        onOpen: () => {
          console.log('SSE connection opened');
        },
        onClose: () => {
          console.log('SSE connection closed');
          this.isStreaming = false;
          this._finalizeStreamedMessage();
        },
        onError: (error) => {
          console.error('SSE error:', error);
          this.isStreaming = false;
        },
        onMessage: (data) => {
          this._handleStreamedMessage(data);
        }
      }
    );

    this.sseClient.connect();
  }

  async sendMessage(text) {
    this.isStreaming = true;
    this.currentStreamedMessage = '';

    const messagePayload = {
      session_id: this.sessionId,
      thread_id: this.threadId,
      type: 'message',
      content: text,
      url: window.location.href,
      referrer: document.referrer || ''
    };

    console.log('Sending SSE message:', messagePayload);

    try {
      await this.sseClient.send(messagePayload);
    } catch (error) {
      console.error('Error sending message:', error);
      this.isStreaming = false;
      throw error;
    }
  }

  _handleStreamedMessage(data) {
    if (data.content && data.content !== '[DONE]') {
      this.currentStreamedMessage += data.content;
      this._updateStreamingMessage();
    }
  }

  // These methods should be implemented by subclasses
  _updateStreamingMessage() {
    throw new Error('_updateStreamingMessage must be implemented by subclass');
  }

  _finalizeStreamedMessage() {
    throw new Error('_finalizeStreamedMessage must be implemented by subclass');
  }

  // Shared feedback button methods
  _createMessageActions(messageText, messageId, feedback) {
    const actionsContainer = createElement('div', {
      className: CSS_CLASSES.MESSAGE_ACTIONS
    });

    // Copy button - always show
    const copyButton = createElement('button', {
      className: `${CSS_CLASSES.MESSAGE_ACTION_BTN} ${CSS_CLASSES.MESSAGE_COPY_BTN}`,
      'aria-label': 'Copy message',
      title: 'Copy'
    });
    copyButton.appendChild(createIcon('copy'));
    copyButton.addEventListener('click', () => this._handleCopyMessage(messageText, copyButton));
    actionsContainer.appendChild(copyButton);

    // Only show feedback buttons if there's a message ID
    if (messageId) {
      // Thumbs up button
      const thumbsUpButton = createElement('button', {
        className: `${CSS_CLASSES.MESSAGE_ACTION_BTN} ${CSS_CLASSES.MESSAGE_THUMBS_UP}${feedback === true ? ` ${CSS_CLASSES.MESSAGE_ACTION_ACTIVE}` : ''}`,
        'aria-label': 'Good response',
        title: 'Good response',
        'data-message-id': messageId
      });
      thumbsUpButton.appendChild(createIcon('thumbs-up'));

      // Thumbs down button
      const thumbsDownButton = createElement('button', {
        className: `${CSS_CLASSES.MESSAGE_ACTION_BTN} ${CSS_CLASSES.MESSAGE_THUMBS_DOWN}${feedback === false ? ` ${CSS_CLASSES.MESSAGE_ACTION_ACTIVE}` : ''}`,
        'aria-label': 'Bad response',
        title: 'Bad response',
        'data-message-id': messageId
      });
      thumbsDownButton.appendChild(createIcon('thumbs-down'));

      // Add event listeners
      thumbsUpButton.addEventListener('click', () => this._handleFeedback(messageId, true, thumbsUpButton, thumbsDownButton));
      thumbsDownButton.addEventListener('click', () => this._handleFeedback(messageId, false, thumbsDownButton, thumbsUpButton));

      actionsContainer.appendChild(thumbsUpButton);
      actionsContainer.appendChild(thumbsDownButton);
    }

    return actionsContainer;
  }

  async _handleCopyMessage(text, button) {
    try {
      // Remove HTML tags and get plain text
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = text;
      const plainText = tempDiv.textContent || tempDiv.innerText || text;

      await navigator.clipboard.writeText(plainText);

      // Visual feedback
      const originalIcon = button.innerHTML;
      button.innerHTML = '';
      button.appendChild(createIcon('check'));
      button.classList.add(CSS_CLASSES.MESSAGE_COPY_BTN + '-copied');

      setTimeout(() => {
        button.innerHTML = originalIcon;
        button.classList.remove(CSS_CLASSES.MESSAGE_COPY_BTN + '-copied');
      }, 2000);
    } catch (error) {
      console.error('Failed to copy message:', error);
    }
  }

  async _handleFeedback(messageId, isPositive, clickedButton, otherButton) {
    if (!messageId) return;

    // Check if the same button was clicked (toggle off)
    const isAlreadyActive = clickedButton.classList.contains(CSS_CLASSES.MESSAGE_ACTION_ACTIVE);

    try {
      // Import api function
      const api = (await import('./api.js')).default;

      // Send feedback to API
      const response = await api({
        endpoint: 'feedback',
        method: 'POST',
        headers: {
          'X-AGENT-ID': this.agentId,
          'X-SESSION-ID': this.sessionId,
          'X-THREAD-ID': this.threadId,
          'X-MESSAGE-ID': messageId
        },
        body: JSON.stringify({
          feedback: isPositive
        })
      });

      if (response.ok) {
        // Toggle the clicked button
        if (isAlreadyActive) {
          clickedButton.classList.remove(CSS_CLASSES.MESSAGE_ACTION_ACTIVE);
        } else {
          clickedButton.classList.add(CSS_CLASSES.MESSAGE_ACTION_ACTIVE);
          // Remove active state from the other button (mutually exclusive)
          otherButton.classList.remove(CSS_CLASSES.MESSAGE_ACTION_ACTIVE);
        }
      } else {
        console.error('Failed to submit feedback:', response.status);
      }
    } catch (error) {
      console.error('Error submitting feedback:', error);
    }
  }

  getCurrentActiveThreadId() {
    return this.threadId;
  }

  destroy() {
    if (this.sseClient) {
      this.sseClient.close();
    }
  }
}

