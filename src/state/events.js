/**
 * Event Handlers Module
 * Sets up all event listeners for the widget
 */

import { CSS_CLASSES } from '../utils.js';

/**
 * Setup all event listeners
 */
export function setupEventListeners(widget) {
  // One controller for all global (document/window) listeners so destroy() can
  // remove them in a single abort() — element-scoped listeners die with the DOM.
  if (!widget._eventController) widget._eventController = new AbortController();

  if (widget.mode === 'search') {
    setupSearchBarListeners(widget);
  } else {
    setupBubbleListeners(widget);
  }
  setupWindowControlListeners(widget);
  setupInputListeners(widget);
  setupHeaderButtonListeners(widget);
  setupGlobalListeners(widget);
  widget.autoResizeInput();
}

/**
 * Setup bubble click listeners
 */
export function setupBubbleListeners(widget) {
  widget.chatBubble?.addEventListener('click', () => widget.toggleChat());
  widget.chatBubble?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      widget.toggleChat();
    }
  });
}

/**
 * Setup search bar listeners
 */
export function setupSearchBarListeners(widget) {
  // Expand search bar on focus
  widget.searchInput?.addEventListener('focus', () => {
    widget.searchBar?.classList.add('chatvia-widget-expanded');
  });

  // Contract search bar on blur (if panel is not open)
  widget.searchInput?.addEventListener('blur', () => {
    if (!widget.isOpen) {
      widget.searchBar?.classList.remove('chatvia-widget-expanded');
    }
  });

  // Also expand on click anywhere in the search bar
  widget.searchBar?.addEventListener('click', () => {
    widget.searchBar?.classList.add('chatvia-widget-expanded');
    widget.searchInput?.focus();
  });

  // Search input - submit on Enter
  widget.searchInput?.addEventListener('keydown', async e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      await handleSearchSubmit(widget);
    }
  });

  // Search button click
  widget.searchButton?.addEventListener('click', async () => {
    await handleSearchSubmit(widget);
  });

  // History button - open panel with thread list
  widget.historyButton?.addEventListener('click', () => {
    widget.toggleChat(true);
    showThreadsList(widget);
  });
}

/**
 * Handle search submit
 */
async function handleSearchSubmit(widget) {
  const query = widget.searchInput?.value?.trim();
  if (!query) return;

  widget.searchInput.value = '';

  if (!widget.isOpen) {
    widget.toggleChat(true);
  }

  await widget.sendUserMessage(query);
}

/**
 * Show threads list
 */
function showThreadsList(widget) {
  widget.toggleMenuDropdown();
}

/**
 * Setup window control listeners
 */
export function setupWindowControlListeners(widget) {
  widget.closeButton?.addEventListener('click', () => widget.toggleChat(false));
  widget.closeButton?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      widget.toggleChat(false);
    }
  });
}

/**
 * Setup input listeners
 */
export function setupInputListeners(widget) {
  widget.sendButton?.addEventListener('click', () => widget.sendUserMessage());
  widget.sendButton?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      widget.sendUserMessage();
    }
  });
  widget.chatInput?.addEventListener('keydown', async e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      await widget.sendUserMessage();
    }
  });
  widget.chatInput?.addEventListener('input', () => {
    widget.autoResizeInput();
    
    // Send typing indicator in human mode
    if (widget.isInHumanMode && widget.isInHumanMode()) {
      const hasText = widget.chatInput.value.trim().length > 0;
      widget.sendTypingIndicator(hasText);
    }
  });
}

/**
 * Setup header button listeners
 */
export function setupHeaderButtonListeners(widget) {
  widget.expandButton?.addEventListener('click', () => widget.toggleExpand());
  widget.expandButton?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      widget.toggleExpand();
    }
  });
  widget.deleteThreadButton?.addEventListener('click', () => widget.confirmDeleteThread());
  widget.deleteThreadButton?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      widget.confirmDeleteThread();
    }
  });
  widget.menuButton?.addEventListener('click', e => {
    e.stopPropagation();
    widget.toggleMenuDropdown();
  });
  widget.menuButton?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      widget.toggleMenuDropdown();
    }
  });
}

/**
 * Setup global listeners
 */
export function setupGlobalListeners(widget) {
  const closeMenuOnOutside = e => {
    if (
      widget.menuDropdown?.classList.contains(CSS_CLASSES.MENU_DROPDOWN_OPEN) &&
      !widget.menuDropdown.contains(e.target) &&
      !widget.menuButton?.contains(e.target)
    ) {
      widget.closeMenuDropdown();
    }
  };
  
  const signal = widget._eventController?.signal;
  document.addEventListener('mousedown', closeMenuOnOutside, { signal });
  document.addEventListener('touchstart', closeMenuOnOutside, { passive: true, signal });

  setupKeyboardShortcuts(widget);
}

/**
 * Setup keyboard shortcuts
 */
export function setupKeyboardShortcuts(widget) {
  widget._historyIndex = -1;
  widget._userInputHistory = [];

  document.addEventListener('keydown', e => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modifierKey = isMac ? e.metaKey : e.ctrlKey;

    // Cmd/Ctrl + K to toggle search/chat
    if (modifierKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      
      if (widget.mode === 'search') {
        if (widget.isOpen) {
          widget.toggleChat(false);
        } else if (widget.searchBar?.classList.contains('chatvia-widget-expanded')) {
          widget.searchBar.classList.remove('chatvia-widget-expanded');
          widget.searchInput?.blur();
        } else {
          widget.searchBar?.classList.add('chatvia-widget-expanded');
          widget.searchInput?.focus();
        }
      } else {
        widget.toggleChat();
        if (widget.isOpen) {
          setTimeout(() => widget.chatInput?.focus(), 100);
        }
      }
      return;
    }

    // Escape to close panel
    if (e.key === 'Escape') {
      if (widget.menuDropdownIsOpened()) {
        widget.closeMenuDropdown();
        return;
      }
      if (widget.isOpen) {
        e.preventDefault();
        widget.toggleChat(false);
        return;
      }
      if (widget.mode === 'search' && widget.searchBar?.classList.contains('chatvia-widget-expanded')) {
        widget.searchBar.classList.remove('chatvia-widget-expanded');
        widget.searchInput?.blur();
        return;
      }
    }

    // Arrow up/down to navigate user message history
    const activeElement = document.activeElement;
    const isInputFocused = activeElement === widget.chatInput || activeElement === widget.searchInput;
    
    if (isInputFocused && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const userMessages = getUserMessageHistory(widget);
      if (userMessages.length === 0) return;

      e.preventDefault();

      if (e.key === 'ArrowUp') {
        if (widget._historyIndex < userMessages.length - 1) {
          if (widget._historyIndex === -1) {
            widget._savedInput = activeElement.value;
          }
          widget._historyIndex++;
          activeElement.value = userMessages[userMessages.length - 1 - widget._historyIndex];
        }
      } else if (e.key === 'ArrowDown') {
        if (widget._historyIndex > 0) {
          widget._historyIndex--;
          activeElement.value = userMessages[userMessages.length - 1 - widget._historyIndex];
        } else if (widget._historyIndex === 0) {
          widget._historyIndex = -1;
          activeElement.value = widget._savedInput || '';
        }
      }

      activeElement.selectionStart = activeElement.selectionEnd = activeElement.value.length;
    }
  }, { signal: widget._eventController?.signal });

  // Reset history index when user types
  const resetHistoryIndex = () => {
    widget._historyIndex = -1;
    widget._savedInput = '';
  };

  widget.chatInput?.addEventListener('input', resetHistoryIndex);
  widget.searchInput?.addEventListener('input', resetHistoryIndex);
  
  // Window resize listener to recalculate dynamic widget height
  let resizeTimeout;
  window.addEventListener('resize', () => {
    // Debounce resize events
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (widget.applyWindowSize && !widget.isFlat) {
        widget.applyWindowSize();
      }
    }, 150);
  }, { signal: widget._eventController?.signal });
}

/**
 * Get user message history
 */
function getUserMessageHistory(widget) {
  const activeThread = widget.getActiveThread();
  if (!activeThread?.messages) return [];
  
  return activeThread.messages
    .filter(m => m.role === 'user')
    .map(m => m.content);
}

