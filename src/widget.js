/**
 * ChatWidget - Main Widget Class
 * Orchestrates all widget functionality using state modules
 */

import '../css/widget.css';

import StorageManager from './storage.js';
import { AgentManager } from './agent.js';
import { getSettings } from './settings.js';
import { SessionManager } from './sessions.js';
import {
  CSS_CLASSES,
  DEFAULT_AVATAR_SVG,
  DEFAULT_LOGO_SVG
} from './utils.js';
import { createElement, createIcon, createLeadForm } from './ui.js';

// Import state modules
import * as threads from './state/threads.js';
import * as messages from './state/messages.js';
import * as sse from './state/sse.js';
import * as events from './state/events.js';
import * as controls from './state/controls.js';
import * as config from './state/config.js';

export class ChatWidget {
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
    
    // Mode: 'bubble' (default chat bubble) or 'search' (search bar with slider)
    this.mode = this.options.mode || 'bubble';
    this.searchPosition = this.options.position || 'bottom';
    
    this.sessionId = null;
    this.isFlat = !!this.mountId;

    this.settings = {};
    this.isMobileApp = this._detectMobile();

    this.agentManager = new AgentManager(agentId);
    this.storageManager = null;
    this.sessionManager = null;

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

    // Internal timers/state
    this._previousWindowSize = null;
    this._finalizeTimeout = null;
    this._loadingSafetyTimeout = null;
    this._wsMessageLoadingTimeout = null;
  }

  _detectMobile() {
    const mobileRegex = /Mobile|Android.*Mobile|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i;
    if (mobileRegex.test(navigator.userAgent)) {
      const tabletRegex = /iPad|Android(?!.*Mobile)|Tablet|Tab/i;
      return !tabletRegex.test(navigator.userAgent);
    }
    return window.innerWidth <= 768;
  }

  // ========================================
  // Initialization
  // ========================================
  
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

      if (this.settings.show_on_load) {
        console.log('Setting up show_on_load timer');
        setTimeout(() => {
          console.log('show_on_load timer fired');
          this.toggleChat(true);
        }, this.settings.show_on_load_delay);
      }
      console.log('Widget initialization complete.');
      
      this._initializeMessageBubbles();

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
      throw new Error('Client verification failed');
    }
    console.log('Client verified.');
  }

  async _initializeSession() {
    console.log('Initializing session...');
    const sessionId = await this.sessionManager.startSession();

    if (!sessionId) {
      console.error('Failed to initialize session. Disabling chat.');
      await this.disabledChat('Session initialization failed.');
      throw new Error('Session initialization failed');
    }

    this.sessionId = sessionId;
    console.log('Session initialized:', sessionId);
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

  _mapRoleToMessageType(role) {
    return messages.mapRoleToMessageType(role);
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

  async _createWidgetElements() {
    return new Promise(resolve => {
      this._loadExternalLibrariesIfNeeded();

      const isFlat = this.isFlat;
      const isSearchMode = this.mode === 'search';

      this.container = createElement('div', { className: CSS_CLASSES.WIDGET });
      
      if (isSearchMode) {
        this.container.classList.add('chatvia-widget-search-mode');
      }

      if (!isFlat) {
        if (isSearchMode) {
          this.searchBar = this._createSearchBar();
          this.container.appendChild(this.searchBar);
        } else {
          this.chatBubble = this._createChatBubble();
          this.container.appendChild(this.chatBubble);
          
          this.messageBubblesContainer = this._createMessageBubblesContainer();
          this.container.appendChild(this.messageBubblesContainer);
        }
      }

      this.chatWindow = this._createChatWindow();
      
      if (isSearchMode) {
        this.chatWindow.classList.add('chatvia-widget-slider-mode');
      }
      
      this.container.appendChild(this.chatWindow);

      if (isFlat) {
        this.chatWindow.classList.add(CSS_CLASSES.WINDOW_OPEN, CSS_CLASSES.WINDOW_FLAT);
        this.isOpen = true;
        if (this.expandButton) this.expandButton.style.display = 'none';
        if (this.closeButton) this.closeButton.style.display = 'none';
      } else if (this.isMobileApp && !isSearchMode) {
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

  _createSearchBar() {
    const positionClass = this.searchPosition === 'top' 
      ? CSS_CLASSES.SEARCH_POSITION_TOP 
      : CSS_CLASSES.SEARCH_POSITION_BOTTOM;
    const searchContainer = createElement('div', {
      className: `${CSS_CLASSES.SEARCH_CONTAINER} ${positionClass}`
    });

    const inputWrapper = createElement('div', {
      className: CSS_CLASSES.SEARCH_INPUT_WRAPPER
    });

    const placeholder = this.settings.welcome_message || this.options.placeholder || 'Ask a question...';

    this.searchInput = createElement('input', {
      className: CSS_CLASSES.SEARCH_INPUT,
      type: 'text',
      placeholder: placeholder
    });

    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const shortcutHint = createElement('span', {
      className: CSS_CLASSES.SEARCH_SHORTCUT_HINT,
      textContent: isMac ? '⌘K' : 'Ctrl+K',
      title: 'Press to toggle search'
    });

    this.searchButton = createElement('button', {
      className: CSS_CLASSES.SEARCH_BUTTON,
      'aria-label': 'Search'
    });
    this.searchButton.appendChild(createIcon('arrow-right'));

    this.historyButton = createElement('button', {
      className: CSS_CLASSES.SEARCH_HISTORY_BUTTON,
      title: 'View chat history'
    });
    this.historyButton.appendChild(createIcon('history'));

    inputWrapper.appendChild(this.searchInput);
    inputWrapper.appendChild(shortcutHint);
    inputWrapper.appendChild(this.searchButton);
    inputWrapper.appendChild(this.historyButton);
    searchContainer.appendChild(inputWrapper);

    return searchContainer;
  }

  _createMessageBubblesContainer() {
    return createElement('div', {
      className: CSS_CLASSES.MESSAGE_BUBBLES_CONTAINER
    });
  }

  _initializeMessageBubbles() {
    if (this.isFlat || !this.settings.bubbles || !Array.isArray(this.settings.bubbles) || this.settings.bubbles.length === 0) {
      return;
    }

    this.currentBubbleIndex = 0;
    setTimeout(() => this._showNextBubble(), 1000);
  }

  _showNextBubble() {
    if (!this.settings.bubbles || this.settings.bubbles.length === 0 || !this.messageBubblesContainer) {
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
      setTimeout(() => this._showNextBubble(), 2000);
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
    this.menuButton = this._createHeaderButton('menu', 'Menu', CSS_CLASSES.MENU_BUTTON, {
      'aria-haspopup': 'true',
      'aria-expanded': 'false'
    });
    this.deleteThreadButton = this._createHeaderButton('delete', 'Clear current chat', CSS_CLASSES.DELETE_BUTTON);
    this.deleteThreadButton.style.display = 'none';
    this.expandButton = this._createHeaderButton('expand', 'Expand chat', CSS_CLASSES.EXPAND_BUTTON);
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

    this.newChatOption = this._createMenuOption('Start new chat', 'new-chat', () => this.startNewThread());
    this.historyOption = this._createMenuOption('Chat history', 'history', () => this.loadChatHistory());
    this.clearCurrentOption = this._createMenuOption('Clear current chat', 'delete', () => this.confirmDeleteThread());
    this.clearAllOption = this._createMenuOption('Clear all', 'clear-all', () => this.confirmClearAllThreads());

    dropdown.appendChild(this.newChatOption);
    dropdown.appendChild(this.historyOption);
    dropdown.appendChild(createElement('hr', {
      style: 'border:none;border-top:1px solid var(--chat-border);margin:4px 0;'
    }));
    dropdown.appendChild(this.clearCurrentOption);
    dropdown.appendChild(this.clearAllOption);
    dropdown.style.display = 'none';
    return dropdown;
  }

  _createMenuOption(text, iconName, action) {
    const option = createElement('div', {
      className: CSS_CLASSES.MENU_OPTION,
      role: 'menuitem',
      tabIndex: 0
    }, {
      click: action,
      keydown: e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          action();
        }
      }
    });
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
    
    const placeholder = this.settings?.welcome_message || this.options?.placeholder || 'Type a message...';
    
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
    await messages.loadLibraries();
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
  // Lead Form
  // ========================================

  async _showLeadForm() {
    console.log('_showLeadForm called - creating and displaying lead form');
    
    const leadForm = await createLeadForm((leadData) => {
      this._handleLeadFormSubmission(leadData);
    }, this.agentId);

    const messagesContainer = this.chatWindow.querySelector(`.${CSS_CLASSES.MESSAGES_CONTAINER}`);
    if (messagesContainer) {
      console.log('Adding lead form to messages container');
      messagesContainer.appendChild(leadForm);
      this.scrollToBottom();
    } else {
      console.log('Messages container not found!');
    }
  }

  async _handleLeadFormSubmission(leadData) {
    console.log('Submitting lead form data:', leadData);
    
    try {
      /* global __API_URL__ */
      const response = await fetch(`${__API_URL__}/leads/form`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AGENT-ID': this.agentId,
          'X-SESSION-ID': this.sessionId,
          'X-THREAD-ID': this.getCurrentActiveThreadId()
        },
        body: JSON.stringify({
          ...leadData,
          page_url: window.location.href,
          user_agent: navigator.userAgent,
          referrer_url: document.referrer || '',
          locale: navigator.language || navigator.userLanguage || 'en-US',
          timestamp: new Date().toISOString()
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to submit lead form: ${response.status}`);
      }

      let result = null;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const text = await response.text();
        if (text) {
          try {
            result = JSON.parse(text);
          } catch (e) {
            console.warn('Response is not valid JSON, treating as success:', text);
            result = { success: true, message: text };
          }
        } else {
          result = { success: true, message: 'Form submitted successfully' };
        }
      } else {
        result = { success: true, message: 'Form submitted successfully' };
      }
      
      console.log('Lead form submitted successfully:', result);

      const leadFormContainer = this.chatWindow.querySelector(`.${CSS_CLASSES.LEAD_FORM_CONTAINER}`);
      if (leadFormContainer) {
        leadFormContainer.innerHTML = '';
        
        let successTitle = 'Thank you!';
        let successMessage = 'Your information has been received and someone will get back to you soon.';
        
        if (result && result.success) {
          if (result.success.title) successTitle = result.success.title;
          if (result.success.message) successMessage = result.success.message;
        }
        
        const successTitleElement = createElement('h3', {
          className: CSS_CLASSES.LEAD_FORM_TITLE,
          textContent: successTitle
        });
        
        const successMessageElement = createElement('div', {
          className: CSS_CLASSES.LEAD_FORM_SUCCESS,
          textContent: successMessage
        });
        
        leadFormContainer.appendChild(successTitleElement);
        leadFormContainer.appendChild(successMessageElement);
        
        setTimeout(() => {
          if (leadFormContainer.parentNode) {
            leadFormContainer.remove();
          }
        }, 3000);
      }

    } catch (error) {
      console.error('Error submitting lead form:', error);
      
      const leadFormContainer = this.chatWindow.querySelector(`.${CSS_CLASSES.LEAD_FORM_CONTAINER}`);
      if (leadFormContainer) {
        const existingError = leadFormContainer.querySelector(`.${CSS_CLASSES.LEAD_FORM_ERROR}`);
        if (existingError) existingError.remove();
        
        const errorMessage = createElement('div', {
          className: CSS_CLASSES.LEAD_FORM_ERROR,
          textContent: 'Failed to submit form. Please try again.'
        });
        
        leadFormContainer.appendChild(errorMessage);
        
        const submitButton = leadFormContainer.querySelector(`.${CSS_CLASSES.LEAD_FORM_SUBMIT}`);
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = 'Submit';
        }
      }
    }

    this.scrollToBottom();
  }

  // ========================================
  // Cleanup
  // ========================================

  destroy() {
    if (this._scrollRAF) {
      cancelAnimationFrame(this._scrollRAF);
      this._scrollRAF = null;
    }
    if (this._resizeRAF) {
      cancelAnimationFrame(this._resizeRAF);
      this._resizeRAF = null;
    }

    if (this._finalizeTimeout) {
      clearTimeout(this._finalizeTimeout);
      this._finalizeTimeout = null;
    }
    if (this._loadingSafetyTimeout) {
      clearTimeout(this._loadingSafetyTimeout);
      this._loadingSafetyTimeout = null;
    }
    if (this._wsMessageLoadingTimeout) {
      clearTimeout(this._wsMessageLoadingTimeout);
      this._wsMessageLoadingTimeout = null;
    }

    if (this.sseClient) {
      this.sseClient.close();
      this.sseClient = null;
    }

    controls.unlockBodyScroll(this);

    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }

    console.log('Widget destroyed and resources cleaned up');
  }
}
