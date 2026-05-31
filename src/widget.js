/**
 * ChatWidget - Main Widget Class
 * Orchestrates all widget functionality using state modules
 */

import '../css/widget.css';

import StorageManager from './storage.js';
import { AgentManager } from './agent.js';
import { AuthManager } from './auth.js';
import { getSettings } from './settings.js';
import { SessionManager } from './sessions.js';
import { CSS_CLASSES, DEFAULT_LOGO_SVG, debug } from './utils.js';
import { createElement, createIcon } from './ui.js';
import { initI18n, t } from './i18n.js';

// Import state modules
import * as threads from './state/threads.js';
import * as messages from './state/messages.js';
import * as sse from './state/sse.js';
import * as events from './state/events.js';
import * as controls from './state/controls.js';
import * as config from './state/config.js';
import * as handoff from './state/handoff.js';
import { startHeartbeat } from './state/handoff.js';

/** Render modes. `bubble` = chat-bubble launcher, `bar` = floating bar launcher. */
export const VALID_MODES = ['bubble', 'bar'];
const DEFAULT_MODE = 'bubble';

export class ChatWidget {
  /**
   * @param {string} agentId — public agent id from `data-agent-id`.
   * @param {object|string} [options] — widget options. Passing a string is a
   *   legacy form that treats the value as a `mountId`.
   * @param {'bubble'|'bar'} [options.mode]
   * @param {'top'|'bottom'} [options.position] — `bar` mode only: which edge
   *   of the viewport the bar floats against.
   * @param {string} [options.language]
   * @param {'auto'|'light'|'dark'} [options.theme]
   * @param {string} [options.auth] — bootstrap JWT for protected agents.
   * @param {string} [options.mountId] — id of a host element for flat mode.
   */
  constructor(agentId, options = {}) {
    this.agentId = agentId;

    // Handle null/undefined options, or legacy mountId parameter (string)
    if (!options) {
      this.mountId = null;
      this.options = {};
    } else if (typeof options === 'string') {
      this.mountId = options;
      this.options = {};
    } else {
      this.mountId = options.mountId || null;
      this.options = options;
    }

    // Internal event emitter wired in by main.js (closure-private listener
    // registry). Defaults to a no-op so direct constructions of ChatWidget
    // (tests, alternate entry points) don't crash when something tries to
    // emit. The widget never reads listeners directly — it can only fire.
    this._emit = typeof this.options.emit === 'function' ? this.options.emit : () => {};

    // Mode: 'bubble' (default chat bubble) or 'bar' (floating launcher bar).
    // embed.js validates the input attribute; this is a safety net for direct
    // callers that bypass the loader (e.g. the index.html / bar.html demos).
    this.mode = ChatWidget._validateMode(this.options.mode);
    this.barPosition = this.options.position || 'bottom';
    this.language = this.options.language || 'auto';

    // Theme preference: 'auto' | 'light' | 'dark' | null.
    // A visitor's saved toggle choice wins over the embed's data-theme.
    // Resolved against backend settings in config.applyTheme().
    this.themePreference = config.readStoredTheme(this.agentId) || this.options.theme || null;

    this.sessionId = null;
    this.isFlat = !!this.mountId;

    this.settings = {};
    this.isMobileApp = this._detectMobile();

    this.agentManager = new AgentManager(agentId);
    this.storageManager = null;
    this.sessionManager = null;

    // Auth: protected agents (is_public = false) ship a signed bootstrap token
    // via the embed's data-auth. We exchange it once for a session token and
    // lock the chat if it's missing or rejected.
    this.bootstrapToken = this.options.auth || null;
    this.authManager = new AuthManager(agentId, this.bootstrapToken);
    this.isLocked = false;

    // State
    this.threads = [];
    this.activeThreadId = null;
    this.messageHistory = [];
    this.isOpen = false;
    this.sseClient = null;
    this.sseReconnectAttempts = 0;
    this.currentStreamedMessage = '';
    this.currentStreamedMessageId = null;
    this.isStreaming = false;
    this.isWidthExpanded = false;
    this.startersVisible = true;

    // Internal timers/state. All setTimeout ids stored on `this` so destroy()
    // can clear them; never schedule a bare setTimeout from instance methods.
    this._previousWindowSize = null;
    this._finalizeTimeout = null;
    this._loadingSafetyTimeout = null;
    this._wsMessageLoadingTimeout = null;
    this._nextBubbleTimeout = null;
    this._showOnLoadTimeout = null;
    this._initialResizeTimeout = null;

    // Initialize handoff state
    handoff.initHandoff(this);
  }

  _detectMobile() {
    const mobileRegex = /Mobile|Android.*Mobile|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i;
    if (mobileRegex.test(navigator.userAgent)) {
      const tabletRegex = /iPad|Android(?!.*Mobile)|Tablet|Tab/i;
      return !tabletRegex.test(navigator.userAgent);
    }
    return window.innerWidth <= 768;
  }

  /**
   * Clear every setTimeout id stored on the instance under the listed keys,
   * then null the field. Safe to call with a missing field.
   */
  _clearTrackedTimers(keys) {
    for (const key of keys) {
      if (this[key]) {
        clearTimeout(this[key]);
        this[key] = null;
      }
    }
  }

  /**
   * Same as `_clearTrackedTimers` for cancelAnimationFrame ids.
   */
  _cancelTrackedRafs(keys) {
    for (const key of keys) {
      if (this[key]) {
        cancelAnimationFrame(this[key]);
        this[key] = null;
      }
    }
  }

  /**
   * Validate the requested mode and fall back to `bubble` on anything unexpected.
   * Warns once on invalid input so misconfigured embeds fail loud, not silent.
   */
  static _validateMode(rawMode) {
    if (!rawMode) return DEFAULT_MODE;
    if (VALID_MODES.includes(rawMode)) return rawMode;
    console.warn(
      `chatvia: Invalid mode "${rawMode}". Expected ${VALID_MODES.join(' or ')}. Falling back to "${DEFAULT_MODE}".`
    );
    return DEFAULT_MODE;
  }

  // ========================================
  // Initialization
  // ========================================

  async init() {
    return await this._initialize();
  }

  async _initialize() {
    try {
      // Show a centered spinner immediately so the corner isn't blank while the
      // session + settings requests are in flight. Removed once the real widget
      // mounts (after applyConfiguration), so the launcher swaps in seamlessly.
      this._showBootLoader();

      // Initialize i18n system first
      await initI18n({ language: this.language });

      await this._verifyClient();

      this.settings = await getSettings(this.agentId);
      debug('Initial settings', this.settings);

      if (this.isMobileApp) {
        this.settings.show_on_load = false;
        this.settings.is_fullscreen = true;
      }

      // Protected agents must trade their bootstrap token for a session token
      // before any gated request. On failure we still mount the shell but lock
      // it, so the visitor sees the branded window with a sign-in notice rather
      // than a broken/blank corner.
      this.isLocked = this.settings.protected === true && !(await this._authorizeProtectedWidget());

      this.sessionManager = new SessionManager(this.agentId);
      if (!this.isLocked) {
        await this._initializeSession();
      }

      this.storageManager = new StorageManager(this.agentId, this.sessionId);
      if (!this.isLocked) {
        await this.initThreads();
      }

      await this._createWidgetElements();

      await this.applyConfiguration();

      // Real widget is mounted and styled — fade out the boot spinner.
      this._hideBootLoader();

      this._setupEventListeners();

      // Locked: skip session-bound wiring (SSE, threads, heartbeat) and leave
      // the chat in its disabled sign-in state.
      if (this.isLocked) {
        await this.disabledChat(t('errors.auth_required'));
        console.warn('chatvia: widget locked — agent is protected and authorization failed.');
        return;
      }

      this.setupSSE();
      await this.loadActiveThread();

      // Start heartbeat to track online status
      startHeartbeat(this);

      if (this.settings.show_on_load) {
        this._showOnLoadTimeout = setTimeout(() => {
          this._showOnLoadTimeout = null;
          this.toggleChat(true);
        }, this.settings.show_on_load_delay);
      }

      this._initializeMessageBubbles();

      // Initial textarea resize. Tracked so destroy() can clear it if the
      // widget is torn down during the 300ms boot window.
      this._initialResizeTimeout = setTimeout(() => {
        this._initialResizeTimeout = null;
        this.autoResizeInput();
      }, 300);
    } catch (error) {
      console.error('Error during async initialization:', error);
      this._hideBootLoader();
      await this.disabledChat(t('errors.initialization_failed'));
      throw error;
    }
  }

  /**
   * Exchange the embed's signed bootstrap token for a widget session token.
   * @returns {Promise<boolean>} true when a session token was obtained
   */
  async _authorizeProtectedWidget() {
    if (!this.authManager.hasBootstrapToken()) {
      console.warn('chatvia: agent is protected but the embed is missing a data-auth token.');
      return false;
    }
    return await this.authManager.exchange();
  }

  async _verifyClient() {
    const isVerified = await this.agentManager.verifyClient();
    if (!isVerified) {
      console.error('Client verification failed. Disabling chat.');
      await this.disabledChat(t('errors.verification_failed'));
      throw new Error('Client verification failed');
    }
    debug('Client verified.');
  }

  async _initializeSession() {
    debug('Initializing session and thread...');
    const initData = await this.sessionManager.startSession();

    if (!initData || !initData.sessionId) {
      console.error('chatvia: Failed to initialize session. Disabling chat.');
      await this.disabledChat(t('errors.session_failed'));
      throw new Error('Session initialization failed');
    }

    this.sessionId = initData.sessionId;
    this.initialThreadId = initData.threadId;

    debug('Session initialized', {
      sessionId: initData.sessionId,
      threadId: initData.threadId,
      isNewSession: initData.isNewSession,
      isNewThread: initData.isNewThread
    });
  }

  // ========================================
  // Thread Management (delegated)
  // ========================================

  async initThreads() {
    return threads.initThreads(this);
  }

  async createNewThread() {
    return threads.createNewThread(this);
  }

  getActiveThread() {
    return threads.getActiveThread(this);
  }

  getCurrentActiveThreadId() {
    return threads.getCurrentActiveThreadId(this);
  }

  async loadActiveThread() {
    return threads.loadActiveThread(this);
  }

  async startNewThread() {
    return threads.startNewThread(this);
  }

  async loadChatHistory() {
    return threads.loadChatHistory(this);
  }

  confirmDeleteThread() {
    return threads.confirmDeleteThread(this);
  }

  confirmClearAllThreads() {
    return threads.confirmClearAllThreads(this);
  }

  _updateThreadActionButtons() {
    return threads.updateThreadActionButtons(this);
  }

  // ========================================
  // Message Handling (delegated)
  // ========================================

  async addMessage(type, text, addToHistory = true, options = {}) {
    return messages.addMessage(this, type, text, addToHistory, options);
  }

  async sendUserMessage(customText) {
    return messages.sendUserMessage(this, customText);
  }

  async displayHistoryMessages() {
    return messages.displayHistoryMessages(this);
  }

  async parseMarkdown(text) {
    return messages.parseMarkdown(text);
  }

  startStreamingMessage() {
    return messages.startStreamingMessage(this);
  }

  async updateStreamingMessage() {
    return messages.updateStreamingMessage(this);
  }

  async finalizeStreamingMessage() {
    return messages.finalizeStreamingMessage(this);
  }

  async refreshStreamingMessages() {
    if (this.isStreaming) {
      await this.updateStreamingMessage();
    }
  }

  // ========================================
  // SSE Handling (delegated)
  // ========================================

  setupSSE() {
    return sse.setupSSE(this);
  }

  removeConnectionErrorMessages() {
    return sse.removeConnectionErrorMessages(this);
  }

  // ========================================
  // Event Listeners (delegated)
  // ========================================

  _setupEventListeners() {
    return events.setupEventListeners(this);
  }

  // ========================================
  // UI Controls (delegated)
  // ========================================

  toggleChat(open) {
    return controls.toggleChat(this, open);
  }

  toggleExpand() {
    return controls.toggleExpand(this);
  }

  toggleTheme() {
    return controls.toggleTheme(this);
  }

  toggleMenuDropdown() {
    return controls.toggleMenuDropdown(this);
  }

  menuDropdownIsOpened() {
    return controls.menuDropdownIsOpened(this);
  }

  closeMenuDropdown() {
    return controls.closeMenuDropdown(this);
  }

  scrollToBottom() {
    return controls.scrollToBottom(this);
  }

  clearMessages() {
    return controls.clearMessages(this);
  }

  showLoading() {
    return controls.showLoading(this);
  }

  hideLoading() {
    return controls.hideLoading(this);
  }

  autoResizeInput() {
    return controls.autoResizeInput(this);
  }

  hideStarters() {
    return controls.hideStarters(this);
  }

  showStarters() {
    return controls.showStarters(this);
  }

  async disabledChat(message) {
    return controls.disabledChat(this, message);
  }

  // ========================================
  // Configuration (delegated)
  // ========================================

  async applyConfiguration() {
    return config.applyConfiguration(this);
  }

  applyWindowSize() {
    return config.applyWindowSize(this);
  }

  _updateStartersContainer() {
    return config.updateStartersContainer(this);
  }

  // ========================================
  // UI Element Creation
  // ========================================

  _showBootLoader() {
    if (this._bootLoader) return;

    const loader = createElement('div', { className: 'chatvia-widget-boot' });
    loader.appendChild(createElement('div', { className: 'chatvia-widget-boot-spinner' }));

    const mountEl = this.isFlat && this.mountId ? document.getElementById(this.mountId) : null;
    if (mountEl) {
      loader.classList.add('chatvia-widget-boot-flat');
      // inset:0 needs a positioned ancestor; only touch a static mount, and
      // restore it in _hideBootLoader so we don't permanently alter the host.
      if (window.getComputedStyle(mountEl).position === 'static') {
        mountEl.style.position = 'relative';
        this._bootLoaderMountFixed = mountEl;
      }
      mountEl.appendChild(loader);
    } else {
      document.body.appendChild(loader);
    }

    this._bootLoader = loader;
  }

  _hideBootLoader() {
    const loader = this._bootLoader;
    if (!loader) return;
    this._bootLoader = null;

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      loader.remove();
      if (this._bootLoaderMountFixed) {
        this._bootLoaderMountFixed.style.position = '';
        this._bootLoaderMountFixed = null;
      }
    };

    loader.classList.add('chatvia-widget-boot-hiding');
    loader.addEventListener('transitionend', cleanup, { once: true });
    setTimeout(cleanup, 300); // fallback if transitionend doesn't fire
  }

  async _createWidgetElements() {
    return new Promise(resolve => {
      this._loadExternalLibrariesIfNeeded();

      const isFlat = this.isFlat;
      const isBarMode = this.mode === 'bar';

      this.container = createElement('div', { className: CSS_CLASSES.WIDGET });

      if (isBarMode) {
        this.container.classList.add('chatvia-widget-bar-mode');
      }

      if (!isFlat) {
        if (isBarMode) {
          this.bar = this._createBar();
          this.container.appendChild(this.bar);
        } else {
          this.chatBubble = this._createChatBubble();
          this.container.appendChild(this.chatBubble);

          this.messageBubblesContainer = this._createMessageBubblesContainer();
          this.container.appendChild(this.messageBubblesContainer);
        }
      }

      this.chatWindow = this._createChatWindow();

      if (isBarMode) {
        // The chat window itself opens with a slider animation above the bar;
        // the mode it lives in is `bar`, but the window-open style is `slider`.
        this.chatWindow.classList.add('chatvia-widget-slider-mode');
      }

      this.container.appendChild(this.chatWindow);

      if (isFlat) {
        this.chatWindow.classList.add(CSS_CLASSES.WINDOW_OPEN, CSS_CLASSES.WINDOW_FLAT);
        this.isOpen = true;
        if (this.expandButton) this.expandButton.style.display = 'none';
        if (this.closeButton) this.closeButton.style.display = 'none';
      } else if (this.isMobileApp && !isBarMode) {
        this.chatWindow.style.display = 'none';
        this.isOpen = false;
        if (this.expandButton) this.expandButton.style.display = 'none';
      }

      requestAnimationFrame(() => {
        const mountEl = this.mountId ? document.getElementById(this.mountId) : null;
        (mountEl || document.body).appendChild(this.container);
        resolve();
      });
    });
  }

  _createChatBubble() {
    const bubble = createElement('div', {
      className: `${CSS_CLASSES.BUBBLE} ${CSS_CLASSES.BUBBLE_PULSE}`,
      role: 'button',
      'aria-label': t('widget.open_chat'),
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

  /**
   * Build the floating bar launcher for `bar` mode. Returns the container
   * element; instance refs (`barInput`, `barButton`) are stashed so the
   * controls/events modules can wire interactions to them later.
   */
  _createBar() {
    const positionClass =
      this.barPosition === 'top' ? CSS_CLASSES.BAR_POSITION_TOP : CSS_CLASSES.BAR_POSITION_BOTTOM;
    const barContainer = createElement('div', {
      className: `${CSS_CLASSES.BAR_CONTAINER} ${positionClass}`
    });

    const inputWrapper = createElement('div', {
      className: CSS_CLASSES.BAR_INPUT_WRAPPER
    });

    const placeholder =
      this.settings.welcome_message || this.options.placeholder || t('widget.ask_question');

    this.barInput = createElement('input', {
      className: CSS_CLASSES.BAR_INPUT,
      type: 'text',
      placeholder: placeholder
    });

    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const shortcutHint = createElement('span', {
      className: CSS_CLASSES.BAR_SHORTCUT_HINT,
      textContent: isMac ? t('shortcuts.mac') : t('shortcuts.windows'),
      title: t('widget.open_chat')
    });

    this.barHistoryButton = createElement('button', {
      className: CSS_CLASSES.BAR_HISTORY_BUTTON,
      'aria-label': t('widget.view_history'),
      title: t('widget.view_history'),
      type: 'button'
    });
    this.barHistoryButton.appendChild(createIcon('history'));

    this.barButton = createElement('button', {
      className: CSS_CLASSES.BAR_BUTTON,
      'aria-label': t('widget.send_message')
    });
    this.barButton.appendChild(createIcon('arrow-right'));

    inputWrapper.appendChild(this.barInput);
    inputWrapper.appendChild(shortcutHint);
    inputWrapper.appendChild(this.barHistoryButton);
    inputWrapper.appendChild(this.barButton);
    barContainer.appendChild(inputWrapper);

    return barContainer;
  }

  _createMessageBubblesContainer() {
    return createElement('div', {
      className: CSS_CLASSES.MESSAGE_BUBBLES_CONTAINER
    });
  }

  _initializeMessageBubbles() {
    if (
      this.isFlat ||
      !this.settings.bubbles ||
      !Array.isArray(this.settings.bubbles) ||
      this.settings.bubbles.length === 0
    ) {
      return;
    }

    this.currentBubbleIndex = 0;
    this._nextBubbleTimeout = setTimeout(() => this._showNextBubble(), 1000);
  }

  _showNextBubble() {
    if (
      !this.settings.bubbles ||
      this.settings.bubbles.length === 0 ||
      !this.messageBubblesContainer
    ) {
      return;
    }

    if (this.currentBubbleIndex >= this.settings.bubbles.length) {
      return;
    }

    const bubbleText = this.settings.bubbles[this.currentBubbleIndex];

    const bubble = createElement('div', {
      className: CSS_CLASSES.FLOATING_BUBBLE,
      textContent: bubbleText
    });

    bubble.addEventListener('click', () => {
      // Open the chat widget when bubble is clicked
      this.toggleChat(true);

      // Fade out the clicked bubble
      bubble.classList.remove(CSS_CLASSES.FLOATING_BUBBLE_SHOW);
      setTimeout(() => {
        if (bubble.parentNode) {
          bubble.parentNode.removeChild(bubble);
        }
      }, 300);
    });

    this.messageBubblesContainer.appendChild(bubble);

    setTimeout(() => {
      bubble.classList.add(CSS_CLASSES.FLOATING_BUBBLE_SHOW);
    }, 100);

    this.currentBubbleIndex++;

    if (this.currentBubbleIndex < this.settings.bubbles.length) {
      this._nextBubbleTimeout = setTimeout(() => this._showNextBubble(), 2000);
    }
  }

  _createChatWindow() {
    const windowEl = createElement('div', {
      className: CSS_CLASSES.WINDOW,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'chatvia-widget-header-title'
    });

    this.chatHeader = this._createHeader();
    this.messagesContainer = this._createMessagesContainer();
    this.loadingIndicator = this._createLoadingIndicator();
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
      id: 'chatvia-widget-header-title'
    });
    this.menuButton = this._createHeaderButton('menu', t('widget.menu'), CSS_CLASSES.MENU_BUTTON, {
      'aria-haspopup': 'true',
      'aria-expanded': 'false'
    });
    this.deleteThreadButton = this._createHeaderButton(
      'delete',
      t('widget.clear_current_chat'),
      CSS_CLASSES.DELETE_BUTTON
    );
    this.deleteThreadButton.style.display = 'none';
    this.themeToggleButton = this._createHeaderButton(
      'moon',
      t('menu.theme_toggle'),
      CSS_CLASSES.THEME_TOGGLE
    );
    this.expandButton = this._createHeaderButton(
      'expand',
      t('widget.expand_chat'),
      CSS_CLASSES.EXPAND_BUTTON
    );
    this.closeButton = this._createHeaderButton(
      'close',
      t('widget.close_chat'),
      CSS_CLASSES.CLOSE_BUTTON
    );
    this.menuDropdown = this._createMenuDropdown();

    header.appendChild(this.headerLogo);
    header.appendChild(this.headerTitle);
    header.appendChild(this.deleteThreadButton);
    header.appendChild(this.themeToggleButton);
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

    // Wrap actions to check if in human mode
    const guardedAction = action => {
      return () => {
        if (this.isInHumanMode()) {
          // Don't allow navigation during live chat
          return;
        }
        action();
      };
    };

    this.newChatOption = this._createMenuOption(
      t('menu.new_chat'),
      'new-chat',
      guardedAction(() => this.startNewThread())
    );
    this.historyOption = this._createMenuOption(
      t('menu.chat_history'),
      'history',
      guardedAction(() => this.loadChatHistory())
    );
    this.clearCurrentOption = this._createMenuOption(
      t('menu.clear_current'),
      'delete',
      guardedAction(() => this.confirmDeleteThread())
    );
    this.clearAllOption = this._createMenuOption(
      t('menu.clear_all'),
      'clear-all',
      guardedAction(() => this.confirmClearAllThreads())
    );

    dropdown.appendChild(this.newChatOption);
    dropdown.appendChild(this.historyOption);
    dropdown.appendChild(
      createElement('hr', {
        style: 'border:none;border-top:1px solid var(--chat-border);margin:4px 0;'
      })
    );
    dropdown.appendChild(this.clearCurrentOption);
    dropdown.appendChild(this.clearAllOption);
    dropdown.style.display = 'none';
    return dropdown;
  }

  // Update menu options based on handoff state
  _updateMenuForHandoffState() {
    const inHumanMode = this.isInHumanMode();
    const options = [
      this.newChatOption,
      this.historyOption,
      this.clearCurrentOption,
      this.clearAllOption
    ];

    options.forEach(option => {
      if (!option) return;

      if (inHumanMode) {
        option.classList.add('chatvia-widget-menu-disabled');
      } else {
        option.classList.remove('chatvia-widget-menu-disabled');
      }
    });
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
      'aria-label': t('widget.loading')
    });
    const dotsContainer = createElement('div', { className: CSS_CLASSES.LOADING_DOTS });
    for (let i = 0; i < 3; i++) {
      dotsContainer.appendChild(createElement('div', { className: CSS_CLASSES.LOADING_DOT }));
    }
    indicator.appendChild(dotsContainer);
    indicator.style.display = 'none';
    return indicator;
  }

  _createStartersContainer() {
    return createElement('div', {
      className: CSS_CLASSES.STARTERS_CONTAINER
    });
  }

  _createInputContainer() {
    const container = createElement('div', { className: CSS_CLASSES.INPUT_CONTAINER });

    const placeholder =
      this.settings?.welcome_message || this.options?.placeholder || t('widget.type_message');

    this.chatInput = createElement('textarea', {
      className: CSS_CLASSES.INPUT,
      placeholder: placeholder,
      rows: 1,
      'aria-label': placeholder,
      autocomplete: 'off',
      autocorrect: 'on',
      spellcheck: 'true'
    });
    this.sendButton = createElement('div', {
      className: CSS_CLASSES.SEND_BUTTON,
      role: 'button',
      'aria-label': t('widget.send_message'),
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
    // Libraries are now bundled statically, just refresh streaming messages
    await this.refreshStreamingMessages();
  }

  // ========================================
  // Dialogs
  // ========================================

  _showConfirmationDialog(title, message, confirmText, onConfirm) {
    const dialog = createElement('div', { className: CSS_CLASSES.CONFIRM_DIALOG });

    const content = createElement('div', { className: CSS_CLASSES.CONFIRM_CONTENT });

    const titleEl = createElement('h3');
    titleEl.textContent = title;

    const messageEl = createElement('p');
    messageEl.textContent = message;

    const buttonsContainer = createElement('div', { className: CSS_CLASSES.CONFIRM_BUTTONS });

    const cancelButton = createElement('button', {
      className: CSS_CLASSES.CONFIRM_CANCEL,
      textContent: 'Cancel'
    });

    const deleteButton = createElement('button', {
      className: CSS_CLASSES.CONFIRM_DELETE,
      textContent: confirmText
    });

    buttonsContainer.appendChild(cancelButton);
    buttonsContainer.appendChild(deleteButton);

    content.appendChild(titleEl);
    content.appendChild(messageEl);
    content.appendChild(buttonsContainer);
    dialog.appendChild(content);

    document.body.appendChild(dialog);

    cancelButton.addEventListener('click', () => dialog.remove());
    deleteButton.addEventListener('click', () => {
      onConfirm();
      dialog.remove();
    });
  }

  // ========================================
  // Handoff (delegated)
  // ========================================

  isInHumanMode() {
    return handoff.isInHumanMode(this);
  }

  isInPendingMode() {
    return handoff.isInPendingMode(this);
  }

  getHandoffMode() {
    return handoff.getHandoffMode(this);
  }

  getAdminName() {
    return handoff.getAdminName(this);
  }

  async requestHumanAssistance() {
    return handoff.requestHumanAssistance(this);
  }

  async checkHandoffStatus() {
    return handoff.checkHandoffStatus(this);
  }

  sendTypingIndicator(isTyping) {
    return handoff.sendTypingIndicator(this, isTyping);
  }

  createTalkToHumanButton(onClick) {
    return handoff.createTalkToHumanButton(this, onClick);
  }

  // ========================================
  // Cleanup
  // ========================================

  destroy() {
    this._cancelTrackedRafs(['_scrollRAF', '_resizeRAF', '_streamRenderRAF']);
    this._streamRenderScheduled = false;

    this._clearTrackedTimers([
      '_finalizeTimeout',
      '_loadingSafetyTimeout',
      '_wsMessageLoadingTimeout',
      '_loadingTimeout',
      '_nextBubbleTimeout',
      '_showOnLoadTimeout',
      '_initialResizeTimeout',
      '_welcomeMessageTimeout'
    ]);

    // Remove all global document/window listeners in one shot.
    if (this._eventController) {
      this._eventController.abort();
      this._eventController = null;
    }

    // Detach the prefers-color-scheme listener used by 'auto' theme.
    config.teardownAutoThemeListener(this);

    if (this.sseClient) {
      this.sseClient.close();
      this.sseClient = null;
    }

    // Hard teardown of handoff/Pusher: stop the heartbeat interval and fully
    // disconnect the socket (cleanupHandoff only unsubscribes, keeping the
    // client alive — wrong for a destroy).
    handoff.stopHeartbeat(this);
    handoff.disconnectPusher(this);

    controls.unlockBodyScroll(this);

    // Remove the boot spinner if destroy() lands mid-init.
    if (this._bootLoader) {
      this._bootLoader.remove();
      this._bootLoader = null;
    }
    if (this._bootLoaderMountFixed) {
      this._bootLoaderMountFixed.style.position = '';
      this._bootLoaderMountFixed = null;
    }

    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }

    debug('Widget destroyed and resources cleaned up');
  }
}
