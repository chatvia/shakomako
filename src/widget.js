import '../css/styles.css';

import StorageManager from './storage.js';
import { AgentManager } from './agent.js';
import { createSSEClient } from './sse.js';
import { getSettings } from './settings.js';
import { SessionManager } from './sessions.js';
import {
  CSS_CLASSES,
  DEFAULT_AVATAR_SVG,
  DEFAULT_LOGO_SVG,
  DEFAULT_PRIMARY_COLOR,
  STREAMING_DONE_MARKER,
  STREAMING_FINALIZE_TIMEOUT
} from './utils.js';
import { createElement, createIcon } from './ui.js';

// Create a namespace for our libraries
const ChatWidgetLibs = {
  marked: null,
  DOMPurify: null,
  _loadingPromise: null // To ensure libraries are loaded only once
};

// Load libraries dynamically to avoid conflicts
const loadLibraries = async () => {
  if (!ChatWidgetLibs._loadingPromise) {
    ChatWidgetLibs._loadingPromise = (async () => {
      try {
        // Use Promise.all to load them in parallel
        const [markedModule, DOMPurifyModule] = await Promise.all([
          import('marked'),
          import('dompurify')
        ]);
        ChatWidgetLibs.marked = markedModule.marked;
        ChatWidgetLibs.DOMPurify = DOMPurifyModule.default;
        console.log('Libraries loaded successfully.');
      } catch (error) {
        console.error('Failed to load markdown libraries:', error);
        ChatWidgetLibs._loadingPromise = null;
      }
    })();
  }
  return ChatWidgetLibs._loadingPromise;
};

export class ChatWidget {
  constructor(agentId, mountId = null) {
    this.agentId = agentId;
    this.mountId = mountId;
    this.sessionId = null;
    this.isFlat = !!mountId;

    this.settings = {};
    this.isMobileApp = (() => {
      const mobileRegex = /Mobile|Android.*Mobile|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i;
      if (mobileRegex.test(navigator.userAgent)) {
        const tabletRegex = /iPad|Android(?!.*Mobile)|Tablet|Tab/i;
        return !tabletRegex.test(navigator.userAgent);
      }
      return window.innerWidth <= 768;
    })();

    this.agentManager = new AgentManager(agentId);
    this.storageManager = null;
    this.sessionManager = null;

    this.threads = [];
    this.activeThreadId = null;
    this.messageHistory = [];
    this.isOpen = false;
    this.sseClient = null;
    this.sseReconnectAttempts = 0;
    this.currentStreamedMessage = '';
    this.isStreaming = false;
    this.isWidthExpanded = false;
    this.startersVisible = true;

    this._previousWindowSize = null;
    this._finalizeTimeout = null;
    this._loadingSafetyTimeout = null;
    this._wsMessageLoadingTimeout = null;
  }

  async init() {
    return await this._initialize();
  }

  async _initialize() {
    try {
      await this._verifyClient();

      this.settings = await getSettings(this.agentId);
      console.log('Initial settings:', this.settings);

      if (this.isMobileApp) {
        this.settings.show_on_load = false;
        this.settings.is_fullscreen = true;
      }

      this.sessionManager = new SessionManager(this.agentId);
      await this._initializeSession();

      this.storageManager = new StorageManager(this.agentId, this.sessionId);
      await this.initThreads();

      await this._createWidgetElements();

      await this.applyConfiguration();
      this._setupEventListeners();
      this.setupSSE();
      await this.loadActiveThread();

      // Only check show_on_load once
      console.log('Checking show_on_load:', this.settings.show_on_load);
      if (this.settings.show_on_load) {
        console.log('Setting up show_on_load timer');
        setTimeout(() => {
          console.log('show_on_load timer fired');
          this.toggleChat(true);
        }, this.settings.show_on_load_delay);
      }
      console.log('Widget initialization complete.');

      setTimeout(() => {
        this.autoResizeInput();
        console.log('Initial textarea resize complete');
      }, 300);
    } catch (error) {
      console.error('Error during async initialization:', error);
      await this.disabledChat('Initialization error. Please try again later.');
      throw error;
    }
  }

  async _verifyClient() {
    const isVerified = await this.agentManager.verifyClient();

    if (!isVerified) {
      console.error('Client verification failed. Disabling chat.');
      await this.disabledChat('Client verification failed.');
      throw new Error('Client verification failed'); // Throw to stop initialization
    }

    console.log('Client verified.');
  }

  async _initializeSession() {
    console.log('Initializing session...');

    const sessionId = await this.sessionManager.startSession();

    console.log('Session started:', this.sessionId);

    if (!sessionId) {
      console.error('Failed to initialize session. Disabling chat.');
      await this.disabledChat('Session initialization failed.');
      throw new Error('Session initialization failed'); // Throw to stop initialization
    }

    this.sessionId = sessionId;

    console.log('Session initialized:', sessionId);
  }

  async disabledChat(message = 'Chat disabled') {
    if (this.sendButton) {
      this.sendButton.disabled = true;
    }
    if (this.chatInput) {
      this.chatInput.disabled = true;
      this.chatInput.placeholder = message;
    }
    this.clearMessages();
    await this.addMessage(CSS_CLASSES.MESSAGE_SYSTEM, message, false);
  }

  async initThreads() {
    console.log('Initializing threads...');
    try {
      const { threads, activeThreadId } = await this.storageManager.loadThreads();
      console.log('Loaded threads from API:', threads, 'Active ID:', activeThreadId);

      this.threads = threads || [];
      this.activeThreadId = activeThreadId || null;

      if (!(this.activeThreadId && this.threads.some(t => t.id === this.activeThreadId))) {
        if (this.threads.length > 0) {
          this.activeThreadId = this.threads[0].id; // Assume newest is first
          this.storageManager.setActiveThreadId(this.activeThreadId);
          console.log(
            `No valid active thread ID found, setting most recent as active: ${this.activeThreadId}`
          );
        } else {
          console.log('No threads found, creating a new one...');
          await this.createNewThread();
        }
      }
      console.log(`Final active thread ID after init: ${this.activeThreadId}`);
    } catch (error) {
      console.error('Error initializing threads:', error);
      await this.disabledChat('Could not load chat threads.');
      throw error;
    }
  }

  async createNewThread() {
    console.log('Requesting new thread from API...');
    try {
      const newThread = await this.storageManager.createNewThread();
      if (newThread) {
        this.threads.unshift(newThread);
        this.activeThreadId = newThread.id; // Set by storageManager
        this.messageHistory = [];
        console.log('New thread created successfully:', newThread);

        await this.displayHistoryMessages();
        this.scrollToBottom();

        return newThread;
      } else {
        console.error('API did not return a new thread object.');
        await this.disabledChat('Failed to create new chat.');
        return null;
      }
    } catch (error) {
      console.error('Failed to create new thread:', error);
      await this.disabledChat('Error creating new chat.');
      return null;
    }
  }

  getActiveThread() {
    return this.threads.find(t => t.id === this.activeThreadId);
  }

  async loadActiveThread() {
    this.clearMessages();
    if (this.inputContainer) this.inputContainer.style.display = 'flex';

    const activeThread = this.getActiveThread();

    if (!activeThread) {
      console.warn('loadActiveThread called with no active thread. Re-initializing.');
      try {
        await this.initThreads();
        const potentiallyNewActiveThread = this.getActiveThread();
        if (!potentiallyNewActiveThread) {
          console.error('Failed to establish an active thread even after re-init.');
          await this.disabledChat('Cannot load chat.');
          return;
        }
        // Don't recurse - just load the messages for the newly established thread
        const messages = await this.storageManager.getMessages(potentiallyNewActiveThread.id);
        this.messageHistory = messages || [];
        potentiallyNewActiveThread.messages = this.messageHistory;
        console.log(`Loaded ${this.messageHistory.length} messages for thread ${potentiallyNewActiveThread.id}`);
        await this.displayHistoryMessages();
        this._updateThreadActionButtons();
        this.scrollToBottom();
        return;
      } catch (error) {
        console.error('Error during re-initialization in loadActiveThread:', error);
        await this.disabledChat('Cannot load chat.');
        return;
      }
    }

    console.log(`Loading messages for active thread: ${activeThread.id}`);

    try {
      const messages = await this.storageManager.getMessages(activeThread.id);
      this.messageHistory = messages || [];

      activeThread.messages = this.messageHistory;
      console.log(`Loaded ${this.messageHistory.length} messages for thread ${activeThread.id}`);
      await this.displayHistoryMessages();

      // Check if there are any user messages in the thread or if thread has previous interaction
      const hasUserMessages = this.messageHistory.some(
        message => message.type === CSS_CLASSES.MESSAGE_USER
      );

      if (hasUserMessages || activeThread.hasUserInteraction) {
        // Hide starters if there are user messages or previous interaction
        this.hideStarters();
      } else if (
        !this.messageHistory.length ||
        (this.messageHistory.length === 1 &&
          this.messageHistory[0].type === CSS_CLASSES.MESSAGE_AGENT)
      ) {
        // Show starters only for empty threads or threads with just a welcome message
        this.showStarters();
      } else {
        this.hideStarters();
      }

      // Update buttons state based on presence of user messages
      this._updateThreadActionButtons();
    } catch (error) {
      console.error(`Error loading messages for thread ${activeThread.id}:`, error);
      await this.addMessage(
        CSS_CLASSES.MESSAGE_SYSTEM,
        'Error loading messages for this chat.',
        false
      );
    }
    this.scrollToBottom();
  }

  async displayHistoryMessages() {
    this.clearMessages();

    if (this.messageHistory && this.messageHistory.length > 0) {
      for (const message of this.messageHistory) {
        await this.addMessage(message.type, message.content, false);
      }
    } else if (this.settings.welcome_message) {
      const activeThread = this.getActiveThread();

      if (activeThread && !activeThread.welcomeShown) {
        // Set the flag immediately to prevent duplicate calls
        activeThread.welcomeShown = true;
        
        setTimeout(async () => {
          await this.addMessage(CSS_CLASSES.MESSAGE_AGENT, this.settings.welcome_message, false);
        }, 500);
      }
    }
  }

  setupSSE() {
    if (this.sseClient) {
      this.sseClient.close();
    }

    this.sseClient = createSSEClient(this.agentId, {
      onOpen: () => this.removeConnectionErrorMessages(),
      onClose: () => this.hideLoading(),
      onError: error => this._handleSSEError(error),
      onMessage: data => this._handleSSEMessage(data)
    });
  }

  async sendUserMessage(customText) {
    const text = customText || this.chatInput.value.trim();
    if (!text) return;

    await this.addMessage(CSS_CLASSES.MESSAGE_USER, text, true);

    if (!customText) {
      this.chatInput.value = '';
      this.autoResizeInput();
    }

    // Hide starters permanently for this thread
    this.hideStarters();

    // Set flag to prevent starters from showing again for this thread
    const activeThread = this.getActiveThread();

    if (activeThread) {
      activeThread.hasUserInteraction = true;
      this._updateThreadActionButtons();
    }

    let needsLoading = true;
    const loadingTimeout = setTimeout(() => {
      if (needsLoading && !document.getElementById(CSS_CLASSES.STREAMING_MESSAGE)) {
        this.showLoading();
      }
    }, 150);

    const cleanupLoading = () => {
      needsLoading = false;
      clearTimeout(loadingTimeout);
      this.hideLoading();
    };

    if (!this.sseClient) {
      console.error('SSE client not initialized.');
      cleanupLoading();
      await this.addMessage(
        CSS_CLASSES.MESSAGE_SYSTEM,
        'SSE client error. Cannot send message.',
        false,
        {
          retryText: text
        }
      );
      return;
    }

    const messagePayload = {
      session_id: this.sessionId,
      thread_id: this.activeThreadId,
      type: 'message',
      content: text,
      url: window.location.href
    };

    console.log('Sending SSE message:', messagePayload);

    const success = await this.sseClient.send(messagePayload);

    if (!success) {
      console.error('Failed to send message via SSE.');
      cleanupLoading();
      await this.addMessage(
        CSS_CLASSES.MESSAGE_SYSTEM,
        'Failed to send message. Please try again.',
        false,
        { retryText: text }
      );
      this.chatInput.disabled = false;
      this.sendButton.disabled = false;
    } else {
      this.chatInput.disabled = true;
      this.sendButton.disabled = true;
    }

    this.scrollToBottom();
  }

  toggleChat(open) {
    console.log(
      'toggleChat called with:',
      open,
      'isMobile:',
      this.isMobileApp,
      'show_on_load:',
      this.settings.show_on_load
    );
    this.isOpen = typeof open === 'boolean' ? open : !this.isOpen;

    if (this.isOpen) {
      this.chatWindow?.classList.add(CSS_CLASSES.WINDOW_OPEN);
      this.chatBubble?.classList.add(CSS_CLASSES.BUBBLE_ACTIVE);

      if (this.settings.is_fullscreen) {
        this.container.classList.add('fullscreen');
        // Hide chat bubble when window is open in fullscreen
        if (this.chatBubble) {
          this.chatBubble.style.display = 'none';
        }
      }

      setTimeout(() => this.chatInput?.focus(), 300);
    } else {
      this.chatWindow?.classList.remove(CSS_CLASSES.WINDOW_OPEN);
      this.chatBubble?.classList.remove(CSS_CLASSES.BUBBLE_ACTIVE);
      // Remove fullscreen when closing
      if (this.settings.is_fullscreen) {
        this.container.classList.remove('fullscreen');
        // Show chat bubble when window is closed in fullscreen
        if (this.chatBubble) {
          this.chatBubble.style.display = 'flex';
        }
      }
    }

    const event = new CustomEvent(this.isOpen ? 'chat:opened' : 'chat:closed', {
      detail: { widget: this }
    });
    document.dispatchEvent(event);
  }

  toggleExpand() {
    if (this.settings.window_size === 'large' && !this._previousWindowSize) {
      console.log('Already in large mode, cannot expand further unless collapsed first.');
      return;
    }

    this.chatWindow?.classList.add(CSS_CLASSES.WINDOW_ANIMATING);

    if (!this.isWidthExpanded) {
      this._previousWindowSize = this.settings.window_size;
      this.settings.window_size = 'large';
      this.isWidthExpanded = true;
      this.expandButton.title = 'Collapse chat';
      this.expandButton.innerHTML = ''; // Clear previous icon
      this.expandButton.appendChild(createIcon('collapse'));
      console.log('Expanded chat window to large from ' + this._previousWindowSize);
    } else {
      this.settings.window_size = this._previousWindowSize || 'medium';
      this._previousWindowSize = null;
      this.isWidthExpanded = false;
      this.expandButton.title = 'Expand chat';
      this.expandButton.innerHTML = ''; // Clear previous icon
      this.expandButton.appendChild(createIcon('expand'));
      console.log('Collapsed chat window to ' + this.settings.window_size);
    }

    this.applyWindowSize();

    setTimeout(() => {
      this.chatWindow?.classList.remove(CSS_CLASSES.WINDOW_ANIMATING);
    }, 600);

    setTimeout(() => this.scrollToBottom(), 300);
  }

  toggleTheme() {
    this.settings.theme = this.settings.theme === 'dark' ? 'light' : 'dark';

    if (this.settings.theme === 'dark') {
      this.chatWindow?.classList.add(CSS_CLASSES.WINDOW_DARK);
      this.themeToggleButton?.setAttribute('aria-label', 'Switch to light theme');
      this.themeToggleButton.title = 'Switch to light theme';
      this.themeToggleButton.innerHTML = '';
      this.themeToggleButton.appendChild(createIcon('sun'));
    } else {
      this.chatWindow?.classList.remove(CSS_CLASSES.WINDOW_DARK);
      this.themeToggleButton?.setAttribute('aria-label', 'Switch to dark theme');
      this.themeToggleButton.title = 'Switch to dark theme';
      this.themeToggleButton.innerHTML = '';
      this.themeToggleButton.appendChild(createIcon('moon'));
    }

    this._updateStartersContainer();

    const event = new CustomEvent('chat:theme-changed', {
      detail: { widget: this, theme: this.settings.theme }
    });
    document.dispatchEvent(event);

    this._updateThemeMenuOption();
  }

  _updateThemeMenuOption() {
    if (!this.themeOption) return;
    const iconName = this.settings.theme === 'dark' ? 'sun' : 'moon';
    const label = this.settings.theme === 'dark' ? 'Light theme' : 'Dark theme';
    // Clear existing icon/text
    this.themeOption.innerHTML = '';
    this.themeOption.appendChild(createIcon(iconName));
    this.themeOption.appendChild(createElement('span', { textContent: label }));
  }

  toggleMenuDropdown() {
    if (this.isStreaming) {
      console.log('Preventing menu open while streaming.');
      return;
    }

    const isOpen = this.menuDropdown?.classList.contains(CSS_CLASSES.MENU_DROPDOWN_OPEN);

    if (isOpen) {
      this.menuDropdown.classList.remove(CSS_CLASSES.MENU_DROPDOWN_OPEN);
      const onTransitionEnd = e => {
        if (e.propertyName === 'opacity') {
          this.menuDropdown.style.display = 'none';
          this.menuDropdown.removeEventListener('transitionend', onTransitionEnd);
        }
      };
      this.menuDropdown.addEventListener('transitionend', onTransitionEnd);
      // Fallback hide in case transition event doesn't fire
      if (
        this.menuDropdown &&
        !this.menuDropdown.classList.contains(CSS_CLASSES.MENU_DROPDOWN_OPEN)
      ) {
        this.menuDropdown.style.display = 'none';
      }
    } else if (this.menuDropdown) {
      this.menuDropdown.style.display = 'block';
      void this.menuDropdown.offsetWidth; // Force reflow
      this.menuDropdown.classList.add(CSS_CLASSES.MENU_DROPDOWN_OPEN);
      this.menuDropdown.style.opacity = '1';
      this.menuDropdown.style.zIndex = '10001';
    }
  }

  async _createWidgetElements() {
    return new Promise(resolve => {
      this._loadExternalLibrariesIfNeeded();

      const isFlat = this.isFlat;

      this.container = this._createContainer();

      if (!isFlat) {
        // Standard widget with bubble
        this.chatBubble = this._createChatBubble();
        this.container.appendChild(this.chatBubble);
      }

      this.chatWindow = this._createChatWindow();
      this.container.appendChild(this.chatWindow);

      // Behavior for flat mode
      if (isFlat) {
        // Show window immediately, no bubble toggle
        this.chatWindow.classList.add(CSS_CLASSES.WINDOW_OPEN, 'flat');
        this.isOpen = true;

        // Hide controls not needed in flat mode
        if (this.expandButton) this.expandButton.style.display = 'none';
        if (this.closeButton) this.closeButton.style.display = 'none';
      } else if (this.isMobileApp) {
        // Mobile non-flat initial hidden
        this.chatWindow.style.display = 'none';
        this.isOpen = false;
      }

      // Wait for next frame to ensure styles are applied
      requestAnimationFrame(() => {
        const mountEl = this.mountId ? document.getElementById(this.mountId) : null;
        (mountEl || document.body).appendChild(this.container);
        resolve();
      });
    });
  }

  _createContainer() {
    return createElement('div', { className: CSS_CLASSES.WIDGET });
  }

  _createChatBubble() {
    const bubble = createElement('div', {
      className: `${CSS_CLASSES.BUBBLE} ${CSS_CLASSES.BUBBLE_PULSE}`,
      role: 'button',
      'aria-label': 'Open chat',
      tabIndex: 0
    });
    const logoUrl = this.settings.logo_url || DEFAULT_LOGO_SVG;
    this.bubbleLogo = createElement('img', {
      alt: 'Chat',
      src: logoUrl,
      width: '30',
      height: '30',
      style: 'width: 30px; height: 30px; opacity: 1;'
    });
    bubble.appendChild(this.bubbleLogo);
    return bubble;
  }

  _createChatWindow() {
    const windowEl = createElement('div', {
      className: CSS_CLASSES.WINDOW,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'chat-header-title' // Matches ID set in _createHeader
    });

    this.chatHeader = this._createHeader();
    this.messagesContainer = this._createMessagesContainer();
    this.loadingIndicator = this._createLoadingIndicator(); // Create but don't append yet
    this.startersContainer = this._createStartersContainer();
    this.inputContainer = this._createInputContainer();
    this.brandFooter = this._createBrandFooter();

    windowEl.appendChild(this.chatHeader);
    windowEl.appendChild(this.messagesContainer);
    windowEl.appendChild(this.startersContainer);
    windowEl.appendChild(this.inputContainer);
    windowEl.appendChild(this.brandFooter);

    return windowEl;
  }

  _createHeader() {
    const header = createElement('div', { className: CSS_CLASSES.HEADER });

    this.headerLogo = createElement('img', {
      className: CSS_CLASSES.HEADER_LOGO,
      alt: 'Chat logo'
    });
    this.headerTitle = createElement('div', {
      className: CSS_CLASSES.HEADER_TITLE,
      id: 'chat-header-title'
    });
    this.menuButton = this._createHeaderButton('menu', 'Menu', CSS_CLASSES.MENU_BUTTON, {
      'aria-haspopup': 'true',
      'aria-expanded': 'false'
    });
    this.deleteThreadButton = this._createHeaderButton(
      'delete',
      'Clear current chat',
      CSS_CLASSES.DELETE_BUTTON
    );
    this.deleteThreadButton.style.display = 'none';
    this.expandButton = this._createHeaderButton(
      'expand',
      'Expand chat',
      CSS_CLASSES.EXPAND_BUTTON
    );
    this.themeToggleButton = this._createHeaderButton(
      this.settings.theme === 'dark' ? 'sun' : 'moon',
      this.settings.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
      CSS_CLASSES.THEME_TOGGLE
    );
    this.themeToggleButton.style.display = 'none';
    this.closeButton = this._createHeaderButton('close', 'Close chat', CSS_CLASSES.CLOSE_BUTTON);
    this.menuDropdown = this._createMenuDropdown();

    header.appendChild(this.headerLogo);
    header.appendChild(this.headerTitle);
    header.appendChild(this.deleteThreadButton);
    header.appendChild(this.expandButton);
    header.appendChild(this.menuButton);
    header.appendChild(this.menuDropdown);
    header.appendChild(this.closeButton);

    return header;
  }

  _createHeaderButton(iconName, label, className, additionalAttributes = {}) {
    const button = createElement('div', {
      className,
      role: 'button',
      'aria-label': label,
      title: label,
      tabIndex: 0,
      ...additionalAttributes
    });
    button.appendChild(createIcon(iconName));
    return button;
  }

  _createMenuDropdown() {
    const dropdown = createElement('div', {
      className: CSS_CLASSES.MENU_DROPDOWN,
      role: 'menu'
    });

    this.newChatOption = this._createMenuOption('Start new chat', 'new-chat', () =>
      this.startNewThread()
    );
    this.historyOption = this._createMenuOption('Chat history', 'history', () =>
      this.loadChatHistory()
    );
    this.themeOption = this._createMenuOption(
      this.settings.theme === 'dark' ? 'Light theme' : 'Dark theme',
      this.settings.theme === 'dark' ? 'sun' : 'moon',
      () => this.toggleTheme()
    );
    this.clearCurrentOption = this._createMenuOption('Clear current chat', 'delete', () =>
      this.confirmDeleteThread()
    );
    this.clearAllOption = this._createMenuOption('Clear all', 'clear-all', () =>
      this.confirmClearAllThreads()
    );

    dropdown.appendChild(this.newChatOption);
    dropdown.appendChild(this.historyOption);
    dropdown.appendChild(this.themeOption);
    dropdown.appendChild(
      createElement('hr', {
        style: 'border:none;border-top:1px solid var(--chat-border);margin:4px 0;'
      })
    );
    dropdown.appendChild(this.clearCurrentOption);
    dropdown.appendChild(this.clearAllOption);
    dropdown.style.display = 'none'; // Start hidden
    return dropdown;
  }

  _createMenuOption(text, iconName, action) {
    const option = createElement(
      'div',
      {
        className: CSS_CLASSES.MENU_OPTION,
        role: 'menuitem',
        tabIndex: 0
      },
      {
        click: action,
        keydown: e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            action();
          }
        }
      }
    );
    option.appendChild(createIcon(iconName));
    option.appendChild(createElement('span', { textContent: text }));
    return option;
  }

  _createMessagesContainer() {
    return createElement('div', {
      className: CSS_CLASSES.MESSAGES_CONTAINER,
      role: 'log',
      'aria-live': 'polite'
    });
  }

  _createLoadingIndicator() {
    const indicator = createElement('div', {
      className: CSS_CLASSES.LOADING,
      'aria-label': 'Loading'
    });
    const dotsContainer = createElement('div', { className: CSS_CLASSES.LOADING_DOTS });
    for (let i = 0; i < 3; i++) {
      dotsContainer.appendChild(createElement('div', { className: CSS_CLASSES.LOADING_DOT }));
    }
    indicator.appendChild(dotsContainer);
    indicator.style.display = 'none'; // Start hidden
    return indicator;
  }

  _createStartersContainer() {
    const container = createElement('div', {
      className: CSS_CLASSES.STARTERS_CONTAINER
    });

    return container;
  }

  _updateStartersContainer() {
    if (!this.startersContainer) return;

    // Clear existing starters
    this.startersContainer.innerHTML = '';

    // Check if we should show starters
    if (
      !this.settings.starters ||
      !Array.isArray(this.settings.starters) ||
      this.settings.starters.length === 0 ||
      !this.startersVisible
    ) {
      this.startersContainer.style.height = '0';
      this.startersContainer.style.padding = '0';
      this.startersContainer.style.opacity = '0';
      this.startersContainer.style.overflow = 'hidden';
      return;
    }

    // Show starters container
    this.startersContainer.style.display = 'flex';
    this.startersContainer.style.height = 'auto';
    this.startersContainer.style.padding = '16px';
    this.startersContainer.style.opacity = '1';
    this.startersContainer.style.overflow = 'auto';

    // Create starter buttons
    this.settings.starters.forEach(starter => {
      const starterButton = createElement('div', {
        className: CSS_CLASSES.STARTER_BUTTON,
        textContent: starter,
        role: 'button',
        tabIndex: 0
      });

      starterButton.addEventListener('click', () => {
        this.sendUserMessage(starter);
        this.hideStarters();
      });

      starterButton.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.sendUserMessage(starter);
          this.hideStarters();
        }
      });

      this.startersContainer.appendChild(starterButton);
    });
  }

  hideStarters() {
    this.startersVisible = false;
    this._updateStartersContainer();
    this.autoResizeInput(); // Recalculate messagesContainer spacing
  }

  showStarters() {
    this.startersVisible = true;
    this._updateStartersContainer();
    this.autoResizeInput(); // Recalculate messagesContainer spacing
  }

  _createInputContainer() {
    const container = createElement('div', { className: CSS_CLASSES.INPUT_CONTAINER });
    this.chatInput = createElement('textarea', {
      className: CSS_CLASSES.INPUT,
      placeholder: 'Type a message...',
      rows: 1,
      'aria-label': 'Type a message',
      autocomplete: 'off',
      autocorrect: 'on',
      spellcheck: 'true'
    });
    this.sendButton = createElement('div', {
      className: CSS_CLASSES.SEND_BUTTON,
      role: 'button',
      'aria-label': 'Send message',
      tabIndex: 0
    });
    this.sendButton.appendChild(createIcon('send'));

    container.appendChild(this.chatInput);
    container.appendChild(this.sendButton);
    return container;
  }

  _createBrandFooter() {
    return createElement('div', { className: CSS_CLASSES.BRAND_FOOTER });
  }

  async _loadExternalLibrariesIfNeeded() {
    if (this.settings.markdown) {
      await loadLibraries();
      await this.refreshStreamingMessages();
    }
  }

  async applyConfiguration() {
    if (!this.container) return; // Ensure elements are created

    // Set the base widget class and position (flat overrides)
    this.container.className = `${CSS_CLASSES.WIDGET} ${this.isFlat ? 'flat' : this.settings.position || 'bottom-right'}`;

    if (this.isFlat) {
      // Hide bubble if it exists
      if (this.chatBubble) this.chatBubble.style.display = 'none';
    }

    if (this.settings.theme === 'dark') {
      this.chatWindow?.classList.add(CSS_CLASSES.WINDOW_DARK);
    } else {
      this.chatWindow?.classList.remove(CSS_CLASSES.WINDOW_DARK);
    }

    this.applyWindowSize();

    if (this.themeToggleButton) {
      this.themeToggleButton.style.display = this.settings.show_theme_switcher ? 'flex' : 'none';
    }

    this._applyColors();
    this._applyLogos();
    this._applyTitle();
    this._applyBranding();
    await this._loadExternalLibrariesIfNeeded();
    this._updateStartersContainer();
  }

  _applyColors() {
    const primaryColor = this.settings.primary_color || DEFAULT_PRIMARY_COLOR;
    document.documentElement.style.setProperty('--chat-primary', primaryColor);
    document.documentElement.style.setProperty('--chat-header-text', '#ffffff'); // TODO: Calculate contrast
    document.documentElement.style.setProperty('--chat-primary-rgb', primaryColor);
  }

  _applyLogos() {
    const logoUrl = this.settings.logo_url || DEFAULT_LOGO_SVG;
    if (this.headerLogo && !this.headerLogo.src) {
      this.headerLogo.src = logoUrl;
    }
  }

  _applyTitle() {
    if (this.headerTitle) {
      this.headerTitle.textContent = this.settings.title;
    }
  }

  _applyBranding() {
    if (!this.brandFooter) return;
    const showBranding = this.settings.branding.enabled;
    if (showBranding) {
      const brandName = this.settings.branding.name;
      const brandUrl = this.settings.branding.url;
      if (brandUrl) {
        this.brandFooter.innerHTML = `<a href="${brandUrl}" target="_blank" rel="noopener noreferrer">${brandName}</a>`;
      } else {
        this.brandFooter.innerHTML = `<span>${brandName}</span>`;
      }
      this.brandFooter.style.display = 'block';
    } else {
      this.brandFooter.style.display = 'none';
    }
  }

  applyWindowSize() {
    if (!this.chatWindow) return;

    this.chatWindow.classList.remove('small', 'medium', 'large');

    if (['small', 'medium', 'large'].includes(this.settings.window_size)) {
      this.chatWindow.classList.add(this.settings.window_size);

      if (this.expandButton) {
        if (this.settings.window_size === 'large') {
          this.expandButton.style.display = this._previousWindowSize ? 'flex' : 'none';
        } else {
          this.expandButton.style.display = 'flex';
        }
      }
    }
  }

  async addMessage(type, text, addToHistory = true, options = {}) {
    if (!this.messagesContainer) return null;
    const message = createElement('div', { className: `${CSS_CLASSES.MESSAGE} ${type}` });

    if (type === CSS_CLASSES.MESSAGE_AGENT) {
      message.appendChild(this._createAvatar());
    }

    const bubble = createElement('div', { className: CSS_CLASSES.MESSAGE_BUBBLE });
    await this._setMessageBubbleContent(bubble, type, text);
    message.appendChild(bubble);

    if (addToHistory) {
      this._addMessageToHistory(type, text, options);
    }

    this.messagesContainer.appendChild(message);
    this.scrollToBottom();
    return message;
  }

  _createAvatar() {
    const avatar = createElement('div', { className: CSS_CLASSES.MESSAGE_AVATAR });
    if (this.settings.logo_url) {
      const avatarImg = createElement('img', {
        src: this.settings.logo_url,
        alt: 'Assistant'
      });
      avatar.appendChild(avatarImg);
    } else {
      avatar.innerHTML = DEFAULT_AVATAR_SVG;
    }
    return avatar;
  }

  async _setMessageBubbleContent(bubble, type, text) {
    if (type === CSS_CLASSES.MESSAGE_AGENT && this.settings.markdown) {
      bubble.innerHTML = await this.parseMarkdown(text);
    } else {
      bubble.textContent = text;
    }
  }

  _addMessageToHistory(type, text, options) {
    const messageData = { type, text, timestamp: new Date().toISOString(), options };
    this.messageHistory.push(messageData);
    const activeThread = this.getActiveThread();

    if (activeThread) {
      if (!Array.isArray(activeThread.messages)) activeThread.messages = [];

      activeThread.messages.push(messageData);
      activeThread.updatedAt = new Date().toISOString();

      // Set hasUserInteraction flag when a user message is added
      if (type === CSS_CLASSES.MESSAGE_USER) {
        activeThread.hasUserInteraction = true;
        this._updateThreadActionButtons();
      }
    }
  }

  async _handleSSEError(error) {
    console.error('SSE Error:', error);
    this.hideLoading();
    if (!this.sseReconnectAttempts) {
      // Only show initial connection error
      await this.addMessage(CSS_CLASSES.MESSAGE_SYSTEM, 'Unable to connect.', false);
    }
    // Re-enable input and button on error
    if (this.chatInput) this.chatInput.disabled = false;
    if (this.sendButton) {
      this.sendButton.disabled = false;
    }
  }



  _handleSSEMessage(data) {
    console.log('Received raw SSE data:', data);
    this.hideLoading();

    // Check if data is already an object (from SSE client) or needs parsing
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

    this._clearSSETimeouts();

    if (message.content === STREAMING_DONE_MARKER) {
      console.log('Stream [DONE] received. Finalizing immediately.');
      this.finalizeStreamingMessage();
      return;
    }

    this._handleReceivedMessage(message);
  }

  async _handleStreamChunk(content) {
    if (!this.isStreaming) {
      this.isStreaming = true;
      this.currentStreamedMessage = '';
      this.startStreamingMessage();
    }

    this.currentStreamedMessage += content;
    await this.updateStreamingMessage();
    this._resetFinalizeTimeout();
  }

  async _handleReceivedMessage(message) {
    const messageContent = message.content || '';

    if (messageContent) {
      if (this.isStreaming) {
        this.currentStreamedMessage += messageContent;
        await this.updateStreamingMessage();
        this._resetFinalizeTimeout();
      } else {
        await this._handleStreamChunk(messageContent);
      }
    }
  }

  _resetFinalizeTimeout() {
    if (this._finalizeTimeout) clearTimeout(this._finalizeTimeout);
    this._finalizeTimeout = setTimeout(
      () => this.finalizeStreamingMessage(),
      STREAMING_FINALIZE_TIMEOUT
    );
  }

  _clearSSETimeouts() {
    if (this._sseMessageLoadingTimeout) {
      clearTimeout(this._sseMessageLoadingTimeout);
      this._sseMessageLoadingTimeout = null;
    }
    if (this._finalizeTimeout) {
      clearTimeout(this._finalizeTimeout);
      this._finalizeTimeout = null;
    }
  }

  finalizeStreamingMessage() {
    if (!this.isStreaming) return;
    console.log('Finalizing streaming message');

    this._clearSSETimeouts();
    this.hideLoading();

    const streamingMsgElement = document.getElementById(CSS_CLASSES.STREAMING_MESSAGE);
    if (streamingMsgElement && this.currentStreamedMessage.trim() !== '') {
      // Just remove the streaming class but keep the assistant class
      streamingMsgElement.classList.remove('streaming');
      streamingMsgElement.removeAttribute('id');

      // Save final message to history
      this._addMessageToHistory(CSS_CLASSES.MESSAGE_AGENT, this.currentStreamedMessage);
    } else if (streamingMsgElement) {
      streamingMsgElement.remove();
    }

    this.isStreaming = false;
    this.currentStreamedMessage = '';

    // Re-enable input and button
    if (this.chatInput) {
      this.chatInput.disabled = false;
      this.chatInput.focus(); // Focus on the input field
    }
    if (this.sendButton) {
      this.sendButton.disabled = false;
    }
    this.autoResizeInput(); // Adjust layout after potential input enable
  }

  async updateStreamingMessage() {
    const streamingMsgElement = document.getElementById(CSS_CLASSES.STREAMING_MESSAGE);
    if (streamingMsgElement) {
      const messageBubble = streamingMsgElement.querySelector(`.${CSS_CLASSES.MESSAGE_BUBBLE}`);
      if (messageBubble) {
        await this._setMessageBubbleContent(
          messageBubble,
          CSS_CLASSES.MESSAGE_AGENT,
          this.currentStreamedMessage
        );
      }
      this.scrollToBottom();
    }
  }

  startStreamingMessage() {
    if (document.getElementById(CSS_CLASSES.STREAMING_MESSAGE) || !this.messagesContainer) {
      return; // Don't create if already exists or container is missing
    }

    const streamingMsgElement = createElement('div', {
      className: `${CSS_CLASSES.MESSAGE} ${CSS_CLASSES.MESSAGE_AGENT}`,
      id: CSS_CLASSES.STREAMING_MESSAGE
    });
    streamingMsgElement.appendChild(this._createAvatar());
    const messageBubble = createElement('div', { className: CSS_CLASSES.MESSAGE_BUBBLE }); // Start empty
    streamingMsgElement.appendChild(messageBubble);

    this.messagesContainer.appendChild(streamingMsgElement);
    this.scrollToBottom();
  }

  _setupEventListeners() {
    this._setupBubbleListeners();
    this._setupWindowControlListeners();
    this._setupInputListeners();
    this._setupHeaderButtonListeners();
    this._setupGlobalListeners();
    this.autoResizeInput();
  }

  _setupBubbleListeners() {
    this.chatBubble?.addEventListener('click', () => this.toggleChat());
    this.chatBubble?.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggleChat();
      }
    });
  }

  _setupWindowControlListeners() {
    this.closeButton?.addEventListener('click', () => this.toggleChat(false));
    this.closeButton?.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggleChat(false);
      }
    });
  }

  async _setupInputListeners() {
    this.sendButton?.addEventListener('click', () => this.sendUserMessage());
    this.sendButton?.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.sendUserMessage();
      }
    });
    this.chatInput?.addEventListener('keydown', async e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        await this.sendUserMessage();
      }
    });
    this.chatInput?.addEventListener('input', () => this.autoResizeInput());
  }

  _setupHeaderButtonListeners() {
    if (this.settings.show_theme_switcher) {
      this.themeToggleButton?.addEventListener('click', () => this.toggleTheme());
      this.themeToggleButton?.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.toggleTheme();
        }
      });
    }
    this.expandButton?.addEventListener('click', () => this.toggleExpand());
    this.expandButton?.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggleExpand();
      }
    });
    this.deleteThreadButton?.addEventListener('click', () => this.confirmDeleteThread());
    this.deleteThreadButton?.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.confirmDeleteThread();
      }
    });
    this.menuButton?.addEventListener('click', e => {
      e.stopPropagation();
      this.toggleMenuDropdown();
    });
    this.menuButton?.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        this.toggleMenuDropdown();
      }
    });
  }

  _setupGlobalListeners() {
    document.addEventListener('click', e => {
      if (
        this.menuDropdown?.classList.contains(CSS_CLASSES.MENU_DROPDOWN_OPEN) &&
        !this.menuDropdown.contains(e.target) &&
        !this.menuButton?.contains(e.target)
      ) {
        this.toggleMenuDropdown();
      }
    });

    // Also listen for mousedown / touchstart for quicker response on some devices
    const closeOnOutside = e => {
      if (
        this.menuDropdown?.classList.contains(CSS_CLASSES.MENU_DROPDOWN_OPEN) &&
        !this.menuDropdown.contains(e.target) &&
        !this.menuButton?.contains(e.target)
      ) {
        this.toggleMenuDropdown();
      }
    };
    document.addEventListener('mousedown', closeOnOutside);
    // Touchstart can be passive to improve scrolling performance
    document.addEventListener('touchstart', closeOnOutside, { passive: true });
  }

  removeConnectionErrorMessages() {
    this.messagesContainer?.querySelectorAll('.message.system').forEach(element => {
      const bubble = element.querySelector('.message-bubble');
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

  scrollToBottom() {
    if (!this.messagesContainer) return;
    // Use rAF to batch DOM reads/writes and provide smoother UX
    if (this._scrollRAF) cancelAnimationFrame(this._scrollRAF);
    this._scrollRAF = requestAnimationFrame(() => {
      this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    });
  }

  clearMessages() {
    if (this.messagesContainer) {
      this.messagesContainer.innerHTML = '';
    }
  }

  showLoading() {
    if (!this.loadingIndicator || !this.messagesContainer) return;

    if (!this.loadingIndicator.parentNode) {
      this.messagesContainer.appendChild(this.loadingIndicator);
    }
    this.loadingIndicator.style.display = 'flex';
    this.scrollToBottom();

    if (this._loadingSafetyTimeout) clearTimeout(this._loadingSafetyTimeout);
    this._loadingSafetyTimeout = setTimeout(() => this.hideLoading(), 30000);
  }

  hideLoading() {
    if (this._loadingSafetyTimeout) {
      clearTimeout(this._loadingSafetyTimeout);
      this._loadingSafetyTimeout = null;
    }
    if (this.loadingIndicator) {
      // More robust removal
      if (this.loadingIndicator.parentNode === this.messagesContainer) {
        this.messagesContainer.removeChild(this.loadingIndicator);
      }
      this.loadingIndicator.style.display = 'none'; // Ensure hidden even if removal fails
    }
  }

  autoResizeInput() {
    if (!this.chatInput || !this.inputContainer || !this.messagesContainer) return;

    if (this._resizeRAF) cancelAnimationFrame(this._resizeRAF);
    this._resizeRAF = requestAnimationFrame(() => {
      this.chatInput.style.height = 'auto'; // Reset
      const newHeight = Math.min(this.chatInput.scrollHeight, 120); // Max 120px
      this.chatInput.style.height = `${newHeight}px`;

      const inputHeight = this.inputContainer.offsetHeight;

      // Account for starters container if visible
      const startersHeight =
        this.startersContainer &&
        this.startersVisible &&
        this.settings.starters &&
        this.settings.starters.length > 0
          ? this.startersContainer.offsetHeight
          : 0;

      this.messagesContainer.style.bottom = `${inputHeight + startersHeight}px`;
    });
  }

  showToast(message) {
    let container = document.querySelector(`.${CSS_CLASSES.TOAST_CONTAINER}`);
    if (!container) {
      container = createElement('div', { className: CSS_CLASSES.TOAST_CONTAINER });
      document.body.appendChild(container);
    }
    const toast = createElement('div', { className: CSS_CLASSES.TOAST, textContent: message });
    container.appendChild(toast);
    setTimeout(() => toast.classList.add(CSS_CLASSES.TOAST_SHOW), 10);
    setTimeout(() => {
      toast.classList.remove(CSS_CLASSES.TOAST_SHOW);
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  confirmDeleteThread() {
    if (this.isStreaming) {
      console.log('Preventing delete thread while streaming.');
      this.showToast('Please wait for the current response to finish.');
      return;
    }

    const threadIdToDelete = this.storageManager.getActiveThreadId();
    const threadToDelete = this.threads.find(t => t.id === threadIdToDelete);
    if (!threadToDelete) {
      this.showToast('No active chat to delete.');
      return;
    }
    this._showConfirmationDialog(
      'Delete Chat',
      `Are you sure you want to delete "${threadToDelete.title || 'Untitled Chat'}"? This action cannot be undone.`,
      'Delete',
      () => this.deleteCurrentThread(threadIdToDelete)
    );
  }

  confirmClearAllThreads() {
    this.toggleMenuDropdown(); // Close menu first
    this._showConfirmationDialog(
      'Delete All Chats',
      'Are you sure you want to delete ALL your chat history? This action cannot be undone.',
      'Delete All',
      () => this.deleteAllThreadsApi()
    );
  }

  _showConfirmationDialog(title, message, confirmText, onConfirm) {
    const dialog = createElement('div', { className: CSS_CLASSES.CONFIRM_DIALOG });
    dialog.innerHTML = `
      <div class="${CSS_CLASSES.CONFIRM_CONTENT}">
        <h3>${title}</h3>
        <p>${message}</p>
        <div class="${CSS_CLASSES.CONFIRM_BUTTONS}">
          <button class="${CSS_CLASSES.CONFIRM_CANCEL}">Cancel</button>
          <button class="${CSS_CLASSES.CONFIRM_DELETE}">${confirmText}</button>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);

    const cancelButton = dialog.querySelector(`.${CSS_CLASSES.CONFIRM_CANCEL}`);
    const deleteButton = dialog.querySelector(`.${CSS_CLASSES.CONFIRM_DELETE}`);

    cancelButton.addEventListener('click', () => dialog.remove());
    deleteButton.addEventListener('click', () => {
      onConfirm();
      dialog.remove();
    });
  }

  async showDeleteSuccess(deletedThreadId) {
    this.threads = this.threads.filter(t => t.id !== deletedThreadId);

    if (this.threads.length > 0) {
      const sortedThreads = [...this.threads].sort(
        (a, b) =>
          new Date(b.updatedAt || b.created_at || 0) - new Date(a.updatedAt || a.created_at || 0)
      );
      const nextActiveThreadId = sortedThreads[0].id;
      console.log('Setting next active thread to:', nextActiveThreadId);
      this.storageManager.setActiveThreadId(nextActiveThreadId);
      this.activeThreadId = nextActiveThreadId;
      await this.loadActiveThread();
    } else {
      console.log('No threads left after deletion. Creating a new one.');
      await this.startNewThread();
    }
  }

  async deleteCurrentThread(threadId) {
    if (!threadId) {
      console.error('Cannot delete thread without an ID.');
      return;
    }
    console.log(`Attempting to delete thread: ${threadId}`);
    this.showLoading();
    try {
      const success = await this.storageManager.deleteThread(threadId);
      this.hideLoading();
      if (success) {
        await this.showDeleteSuccess(threadId);
      } else {
        console.error('Failed to delete thread via API.');
        this.showToast('Failed to delete chat.');
      }
    } catch (error) {
      this.hideLoading();
      console.error('Error deleting thread:', error);
      this.showToast('Error deleting chat.');
    }
  }

  async deleteAllThreadsApi() {
    console.log('Attempting to delete all threads via API...');
    this.showLoading();
    try {
      const success = await this.storageManager.deleteAllThreads();

      this.hideLoading();

      if (success) {
        this.threads = [];
        this.activeThreadId = null;
        this.messageHistory = [];
        this.showToast('All chat history deleted.');
        console.log('Starting a new thread after deleting all...');
        await this.startNewThread();
      } else {
        console.error('Failed to delete all threads via API.');
        this.showToast('Failed to delete chat history.');
      }
    } catch (error) {
      this.hideLoading();
      console.error('Error deleting all threads:', error);
      this.showToast('Error clearing chat history.');
    }
  }

  async loadChatHistory() {
    this.toggleMenuDropdown(); // Close menu
    this.clearMessages();
    this.showLoading();
    if (this.inputContainer) this.inputContainer.style.display = 'none';

    try {
      const { threads } = await this.storageManager.loadThreads();
      this.threads = threads;
      this.activeThreadId = this.storageManager.getActiveThreadId();
      this.hideLoading();
      this.hideStarters();

      const threadsContainer = this._createThreadsContainer(threads);
      this.messagesContainer?.appendChild(threadsContainer);
    } catch (error) {
      this.hideLoading();
      console.error('Error loading chat history:', error);
      await this.addMessage(CSS_CLASSES.MESSAGE_SYSTEM, 'Could not load chat history.', false);
      if (this.inputContainer) this.inputContainer.style.display = 'flex'; // Show input on error
    }
  }

  async startNewThread() {
    const activeThread = this.getActiveThread();

    // If current thread is already empty, just stay on it and focus input
    if (
      activeThread &&
      Array.isArray(activeThread.messages) &&
      activeThread.messages.length === 0
    ) {
      this.toggleMenuDropdown();
      this.chatInput?.focus();
      return;
    }

    console.log('Starting a new thread...');
    this.toggleMenuDropdown();

    this.clearMessages();
    this.showLoading();

    try {
      const newThread = await this.createNewThread();

      if (newThread) {
        if (this.inputContainer) this.inputContainer.style.display = 'flex';

        // Always show starters for new threads
        this.showStarters();

        setTimeout(() => this.chatInput?.focus(), 300);
      } else {
        throw new Error('Failed to create new thread');
      }
    } catch (error) {
      console.error('Error starting new thread:', error);
      await this.addMessage(CSS_CLASSES.MESSAGE_SYSTEM, 'Failed to start a new chat.', false);
    } finally {
      this.hideLoading();
    }
  }

  _createThreadsContainer(threads) {
    const container = createElement('div', {
      className: `${CSS_CLASSES.THREADS_CONTAINER} threads-list`
    });

    if (!threads || threads.length === 0) {
      const noThreadsMsg = createElement('p', {
        textContent: 'No chat history available.',
        className: CSS_CLASSES.NO_THREADS_MESSAGE
      });
      container.appendChild(noThreadsMsg);
    } else {
      const sortedThreads = [...threads].sort(
        (a, b) =>
          new Date(b.updatedAt || b.created_at || 0) - new Date(a.updatedAt || a.created_at || 0)
      );
      sortedThreads.forEach(thread => {
        const threadItem = this._createThreadItem(thread);
        container.appendChild(threadItem);
      });
    }
    return container;
  }

  _createThreadItem(thread) {
    const item = createElement('div', { className: CSS_CLASSES.THREAD_ITEM });
    if (thread.id === this.activeThreadId) {
      item.classList.add(CSS_CLASSES.THREAD_ITEM_ACTIVE);
    }

    const titleEl = createElement('div', { className: CSS_CLASSES.THREAD_TITLE });
    titleEl.textContent =
      thread.title || `Chat from ${new Date(thread.created_at).toLocaleDateString()}`;
    item.appendChild(titleEl);

    // Arrow icon to the right
    const arrowIcon = createElement('div', { className: 'thread-arrow-icon' });
    arrowIcon.appendChild(createIcon('arrow-right'));
    item.appendChild(arrowIcon);

    item.addEventListener('click', async () => {
      console.log(`Switching to thread: ${thread.id}`);
      this.storageManager.setActiveThreadId(thread.id);
      this.activeThreadId = thread.id;
      await this.loadActiveThread();
    });
    return item;
  }

  async refreshStreamingMessages() {
    if (this.isStreaming && this.settings.markdown) {
      await this.updateStreamingMessage();
    }
  }

  async parseMarkdown(text) {
    if (!text) return '';

    // If markdown is enabled, ensure libraries are loaded
    if (this.settings.markdown) {
      try {
        // Wait for libraries to load if they haven't already
        if (!ChatWidgetLibs.marked || !ChatWidgetLibs.DOMPurify) {
          await loadLibraries();
        }

        // Double check libraries are available after loading attempt
        if (!ChatWidgetLibs.marked || !ChatWidgetLibs.DOMPurify) {
          console.warn('Markdown libraries failed to load, falling back to plain text');
          return this._escapeHtml(text);
        }

        ChatWidgetLibs.marked.setOptions({
          gfm: true,
          breaks: true,
          headerIds: false,
          mangle: false,
          smartLists: true,
          smartypants: true,
          xhtml: false,
          tables: true
        });

        let html = ChatWidgetLibs.marked.parse(text);
        html = ChatWidgetLibs.DOMPurify.sanitize(html, {
          ALLOWED_TAGS: [
            'a',
            'b',
            'br',
            'code',
            'div',
            'em',
            'h1',
            'h2',
            'h3',
            'h4',
            'h5',
            'h6',
            'hr',
            'i',
            'li',
            'ol',
            'p',
            'pre',
            'strong',
            'table',
            'tbody',
            'td',
            'th',
            'thead',
            'tr',
            'ul',
            'span',
            'math',
            'mi',
            'mo',
            'mn',
            'mtext'
          ],
          ALLOWED_ATTR: ['href', 'target', 'class', 'rel', 'colspan', 'rowspan', 'style'],
          USE_PROFILES: { html: true },
          KEEP_CONTENT: true,
          ADD_ATTR: [
            ['target', '_blank'],
            ['rel', 'noopener noreferrer']
          ]
        });
        return html;
      } catch (error) {
        console.error('Error parsing markdown:', error);
        return this._escapeHtml(text);
      }
    }

    // If markdown is disabled, return escaped HTML
    return this._escapeHtml(text);
  }

  _escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
      .replace(/\n/g, '<br>');
  }

  _updateThreadActionButtons() {
    const activeThread = this.getActiveThread();
    let hasUserMessages = false;
    if (activeThread && Array.isArray(activeThread.messages)) {
      hasUserMessages = activeThread.messages.some(m => m.type === CSS_CLASSES.MESSAGE_USER);
    }

    // Menu button enabled as long as there is at least one thread
    const deleteDisabled = !hasUserMessages;
    const newChatDisabled = !hasUserMessages;

    // Disable history / clear options when only one empty thread exists
    const onlyEmptyThread =
      this.threads.length === 1 &&
      (!activeThread || !activeThread.messages || activeThread.messages.length === 0);

    const setState = (el, disabled) => {
      if (!el) return;
      el.style.pointerEvents = disabled ? 'none' : 'auto';
      el.style.opacity = disabled ? '0.4' : '1';
      el.setAttribute('aria-disabled', disabled);
    };

    setState(this.deleteThreadButton, deleteDisabled);
    setState(this.newChatOption, newChatDisabled);
    setState(this.historyOption, onlyEmptyThread);
    setState(this.clearCurrentOption, onlyEmptyThread);
    setState(this.clearAllOption, onlyEmptyThread);
  }
}
