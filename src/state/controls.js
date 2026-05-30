/**
 * UI Controls Module
 * Handles toggle, expand, scroll, and other UI state management
 */

import { CSS_CLASSES } from '../utils.js';
import { createIcon } from '../ui.js';
import { markMessagesAsRead, HANDOFF_MODE } from './handoff.js';
import { applyTheme, writeStoredTheme } from './config.js';

/**
 * Toggle chat open/close
 */
export function toggleChat(widget, open) {
  console.log(
    'toggleChat called with:',
    open,
    'isMobile:',
    widget.isMobileApp,
    'show_on_load:',
    widget.settings.show_on_load,
    'mode:',
    widget.mode
  );
  widget.isOpen = typeof open === 'boolean' ? open : !widget.isOpen;
  const isBarMode = widget.mode === 'bar';

  if (widget.isOpen) {
    widget.chatWindow?.classList.add(CSS_CLASSES.WINDOW_OPEN);

    if (isBarMode) {
      widget.bar?.classList.add('chatvia-widget-hidden');
    } else {
      widget.chatBubble?.classList.add(CSS_CLASSES.BUBBLE_ACTIVE);
      stopMessageBubbles(widget);
    }

    if (widget.settings.is_fullscreen && !isBarMode) {
      widget.container.classList.add(CSS_CLASSES.FULLSCREEN);
      if (widget.chatBubble) {
        widget.chatBubble.style.display = 'none';
      }
    }

    // Bar mode is a self-contained fixed-position panel — it must not touch
    // the host page. Only lock the host scroll for true fullscreen/mobile.
    if (widget.settings.is_fullscreen || widget.isMobileApp) {
      lockBodyScroll(widget);
    }

    setTimeout(() => {
      widget.chatInput?.focus();
      // Scroll to bottom when opening chat
      widget.scrollToBottom();
      // Mark messages as read if in human mode
      if (widget.handoffMode === HANDOFF_MODE.HUMAN) {
        markMessagesAsRead(widget);
      }
    }, 300);
  } else {
    widget.chatWindow?.classList.remove(CSS_CLASSES.WINDOW_OPEN);

    if (isBarMode) {
      widget.bar?.classList.remove('chatvia-widget-hidden', 'chatvia-widget-expanded');
    } else {
      widget.chatBubble?.classList.remove(CSS_CLASSES.BUBBLE_ACTIVE);
      if (widget.settings.is_fullscreen) {
        widget.container.classList.remove(CSS_CLASSES.FULLSCREEN);
        if (widget.chatBubble) {
          widget.chatBubble.style.display = 'flex';
        }
      }
    }

    if (widget.settings.is_fullscreen || widget.isMobileApp) {
      unlockBodyScroll(widget);
    }
  }

  const event = new CustomEvent(widget.isOpen ? 'chat:opened' : 'chat:closed', {
    detail: { widget }
  });
  document.dispatchEvent(event);
}

/**
 * Toggle expand/collapse
 */
export function toggleExpand(widget) {
  if (widget.settings.window_size === CSS_CLASSES.WINDOW_LARGE && !widget._previousWindowSize) {
    console.log('Already in large mode, cannot expand further unless collapsed first.');
    return;
  }

  widget.chatWindow?.classList.add(CSS_CLASSES.WINDOW_ANIMATING);

  if (!widget.isWidthExpanded) {
    widget._previousWindowSize = widget.settings.window_size;
    widget.settings.window_size = CSS_CLASSES.WINDOW_LARGE;
    widget.isWidthExpanded = true;
    widget.expandButton.title = 'Collapse chat';
    widget.expandButton.innerHTML = '';
    widget.expandButton.appendChild(createIcon('collapse'));

    // Apply viewport-constrained max height
    constrainToViewport(widget);

    console.log('Expanded chat window to large from ' + widget._previousWindowSize);
  } else {
    widget.settings.window_size = widget._previousWindowSize || CSS_CLASSES.WINDOW_MEDIUM;
    widget._previousWindowSize = null;
    widget.isWidthExpanded = false;
    widget.expandButton.title = 'Expand chat';
    widget.expandButton.innerHTML = '';
    widget.expandButton.appendChild(createIcon('expand'));

    // Clear viewport constraint and cleanup
    removeViewportConstraint(widget);

    console.log('Collapsed chat window to ' + widget.settings.window_size);
  }

  widget.applyWindowSize();

  setTimeout(() => {
    widget.chatWindow?.classList.remove(CSS_CLASSES.WINDOW_ANIMATING);
  }, 600);

  setTimeout(() => widget.scrollToBottom(), 300);
}

/**
 * Constrain widget to viewport bounds
 * Calculates available height based on viewport and bottom offset
 */
function constrainToViewport(widget) {
  if (!widget.chatWindow) return;

  const viewportHeight = window.innerHeight;
  const bottomOffset = 100; // Standard bottom position for the chat bubble
  const topMargin = 20; // Minimum margin from top of viewport

  // Calculate maximum safe height
  const maxSafeHeight = viewportHeight - bottomOffset - topMargin;

  // Apply constraint
  widget.chatWindow.style.maxHeight = `${maxSafeHeight}px`;

  // Set up resize listener if not already set
  if (!widget._viewportResizeHandler) {
    widget._viewportResizeHandler = () => {
      if (widget.isWidthExpanded && widget.chatWindow) {
        const vh = window.innerHeight;
        const maxHeight = vh - bottomOffset - topMargin;
        widget.chatWindow.style.maxHeight = `${maxHeight}px`;
      }
    };
    window.addEventListener('resize', widget._viewportResizeHandler, {
      signal: widget._eventController?.signal
    });
  }
}

/**
 * Remove viewport constraint and cleanup resize listener
 */
function removeViewportConstraint(widget) {
  if (widget.chatWindow) {
    widget.chatWindow.style.maxHeight = '';
  }

  if (widget._viewportResizeHandler) {
    window.removeEventListener('resize', widget._viewportResizeHandler);
    widget._viewportResizeHandler = null;
  }
}

/**
 * Toggle theme
 */
export function toggleTheme(widget) {
  // A manual toggle is an explicit choice — flip to the opposite concrete mode
  // and opt out of 'auto'. applyTheme() handles the class on every surface,
  // detaches the prefers-color-scheme listener, syncs settings.theme, and
  // updates the toggle button's icon/label via updateThemeToggleButton().
  const isDark = widget.chatWindow?.classList.contains(CSS_CLASSES.WINDOW_DARK);
  widget.themePreference = isDark ? 'light' : 'dark';
  writeStoredTheme(widget.agentId, widget.themePreference);
  applyTheme(widget);

  // Brief rotate flourish on the icon (animation defined in CSS).
  const btn = widget.themeToggleButton;
  if (btn) {
    btn.classList.add('chatvia-widget-animating');
    setTimeout(() => btn.classList.remove('chatvia-widget-animating'), 500);
  }

  widget._updateStartersContainer();

  const event = new CustomEvent('chat:theme-changed', {
    detail: { widget, theme: widget.settings.theme }
  });
  document.dispatchEvent(event);
}

/**
 * Toggle menu dropdown
 */
export function toggleMenuDropdown(widget) {
  if (widget.isStreaming) {
    console.log('Preventing menu open while streaming.');
    return;
  }

  const isOpen = widget.menuDropdown?.classList.contains(CSS_CLASSES.MENU_DROPDOWN_OPEN);

  if (isOpen) {
    widget.menuDropdown.classList.remove(CSS_CLASSES.MENU_DROPDOWN_OPEN);
    const onTransitionEnd = e => {
      if (e.propertyName === 'opacity') {
        widget.menuDropdown.style.display = 'none';
        widget.menuDropdown.removeEventListener('transitionend', onTransitionEnd);
      }
    };
    widget.menuDropdown.addEventListener('transitionend', onTransitionEnd);
    if (
      widget.menuDropdown &&
      !widget.menuDropdown.classList.contains(CSS_CLASSES.MENU_DROPDOWN_OPEN)
    ) {
      widget.menuDropdown.style.display = 'none';
    }
  } else if (widget.menuDropdown) {
    // Update menu items state based on handoff mode before showing
    if (widget._updateMenuForHandoffState) {
      widget._updateMenuForHandoffState();
    }

    widget.menuDropdown.style.display = 'block';
    void widget.menuDropdown.offsetWidth;
    widget.menuDropdown.classList.add(CSS_CLASSES.MENU_DROPDOWN_OPEN);
    widget.menuDropdown.style.opacity = '1';
    widget.menuDropdown.style.zIndex = '10001';
  }
}

/**
 * Check if menu dropdown is opened
 */
export function menuDropdownIsOpened(widget) {
  return widget.menuDropdown?.classList.contains(CSS_CLASSES.MENU_DROPDOWN_OPEN) || false;
}

/**
 * Close menu dropdown
 */
export function closeMenuDropdown(widget) {
  if (menuDropdownIsOpened(widget)) {
    widget.menuDropdown.classList.remove(CSS_CLASSES.MENU_DROPDOWN_OPEN);
    const onTransitionEnd = e => {
      if (e.propertyName === 'opacity') {
        widget.menuDropdown.style.display = 'none';
        widget.menuDropdown.removeEventListener('transitionend', onTransitionEnd);
      }
    };
    widget.menuDropdown.addEventListener('transitionend', onTransitionEnd);
    setTimeout(() => {
      if (widget.menuDropdown && !menuDropdownIsOpened(widget)) {
        widget.menuDropdown.style.display = 'none';
      }
    }, 300);
  }
}

/**
 * Scroll to bottom of messages
 */
export function scrollToBottom(widget) {
  if (!widget.messagesContainer) return;
  if (widget._scrollRAF) cancelAnimationFrame(widget._scrollRAF);
  widget._scrollRAF = requestAnimationFrame(() => {
    // Try scrollTop approach
    widget.messagesContainer.scrollTop = widget.messagesContainer.scrollHeight;

    // Also try scrollIntoView on the last child as backup
    const lastMessage = widget.messagesContainer.lastElementChild;
    if (lastMessage) {
      lastMessage.scrollIntoView({ behavior: 'instant', block: 'end' });
    }
  });
}

/**
 * Clear all messages
 */
export function clearMessages(widget) {
  if (widget.messagesContainer) {
    widget.messagesContainer.innerHTML = '';
  }
}

/**
 * Show loading indicator
 */
export function showLoading(widget) {
  if (!widget.loadingIndicator || !widget.messagesContainer) return;

  if (!widget.loadingIndicator.parentNode) {
    widget.messagesContainer.appendChild(widget.loadingIndicator);
  }
  widget.loadingIndicator.style.display = 'flex';
  scrollToBottom(widget);

  if (widget._loadingSafetyTimeout) clearTimeout(widget._loadingSafetyTimeout);
  widget._loadingSafetyTimeout = setTimeout(() => hideLoading(widget), 30000);
}

/**
 * Hide loading indicator
 */
export function hideLoading(widget) {
  if (widget._loadingSafetyTimeout) {
    clearTimeout(widget._loadingSafetyTimeout);
    widget._loadingSafetyTimeout = null;
  }
  if (widget.loadingIndicator) {
    if (widget.loadingIndicator.parentNode === widget.messagesContainer) {
      widget.messagesContainer.removeChild(widget.loadingIndicator);
    }
    widget.loadingIndicator.style.display = 'none';
  }
}

/**
 * Auto resize input textarea
 */
export function autoResizeInput(widget) {
  if (!widget.chatInput || !widget.inputContainer || !widget.messagesContainer) return;

  if (widget._resizeRAF) cancelAnimationFrame(widget._resizeRAF);
  widget._resizeRAF = requestAnimationFrame(() => {
    widget.chatInput.style.height = 'auto';
    const newHeight = Math.min(widget.chatInput.scrollHeight, 120);
    widget.chatInput.style.height = `${newHeight}px`;

    const inputHeight = widget.inputContainer.offsetHeight;

    const startersHeight =
      widget.startersContainer &&
        widget.startersVisible &&
        widget.settings.starters &&
        widget.settings.starters.length > 0
        ? widget.startersContainer.offsetHeight
        : 0;

    widget.messagesContainer.style.bottom = `${inputHeight + startersHeight}px`;
  });
}

/**
 * Lock body scroll
 */
export function lockBodyScroll(widget) {
  widget._scrollPosition = window.pageYOffset || document.documentElement.scrollTop;

  document.body.style.overflow = 'hidden';
  document.body.style.position = 'fixed';
  document.body.style.top = `-${widget._scrollPosition}px`;
  document.body.style.width = '100%';

  document.body.classList.add('chatvia-scroll-locked');
}

/**
 * Unlock body scroll
 */
export function unlockBodyScroll(widget) {
  document.body.style.overflow = '';
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';

  document.body.classList.remove('chatvia-scroll-locked');

  if (widget._scrollPosition !== undefined) {
    window.scrollTo(0, widget._scrollPosition);
    widget._scrollPosition = undefined;
  }
}

/**
 * Stop message bubbles
 */
export function stopMessageBubbles(widget) {
  if (widget.messageBubblesContainer) {
    // Fade out all bubbles with animation
    const bubbles = widget.messageBubblesContainer.querySelectorAll('.chatvia-widget-floating-bubble');
    bubbles.forEach((bubble, index) => {
      bubble.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      bubble.style.opacity = '0';
      bubble.style.transform = 'scale(0.9) translateY(10px)';

      // Remove after animation completes
      setTimeout(() => {
        if (bubble.parentNode) {
          bubble.parentNode.removeChild(bubble);
        }
      }, 300 + (index * 50)); // Stagger the removal
    });

    // Also stop any pending bubble timeouts
    if (widget._nextBubbleTimeout) {
      clearTimeout(widget._nextBubbleTimeout);
      widget._nextBubbleTimeout = null;
    }
  }
}

/**
 * Hide starters
 */
export function hideStarters(widget) {
  widget.startersVisible = false;
  widget._updateStartersContainer();
  autoResizeInput(widget);
}

/**
 * Show starters
 */
export function showStarters(widget) {
  widget.startersVisible = true;
  widget._updateStartersContainer();
  autoResizeInput(widget);
}

/**
 * Disable chat
 */
export async function disabledChat(widget, message = 'Chat disabled') {
  if (widget.sendButton) {
    widget.sendButton.disabled = true;
  }
  if (widget.chatInput) {
    widget.chatInput.disabled = true;
    widget.chatInput.placeholder = message;
  }
  clearMessages(widget);
  await widget.addMessage(CSS_CLASSES.MESSAGE_SYSTEM, message, false);
}

