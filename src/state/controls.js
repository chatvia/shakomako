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
  if (!widget.menuDropdown) return;

  // Hidden / shown is fully class-driven now — the CSS handles the fade-in
  // and fade-out symmetrically via opacity + visibility. Don't poke inline
  // styles here, or they'll override the class and the close transition
  // won't run (you'll see the menu sit fully visible until display:none).
  if (widget.menuDropdown.classList.contains(CSS_CLASSES.MENU_DROPDOWN_OPEN)) {
    widget.menuDropdown.classList.remove(CSS_CLASSES.MENU_DROPDOWN_OPEN);
    return;
  }

  if (widget._updateMenuForHandoffState) {
    widget._updateMenuForHandoffState();
  }
  widget.menuDropdown.classList.add(CSS_CLASSES.MENU_DROPDOWN_OPEN);
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
  }
}

/**
 * Scroll to bottom of messages.
 * @param {object} widget
 * @param {boolean} [smooth] — when true, animates the scroll (used by the
 *   scroll-to-bottom button click). Auto-scroll calls during streaming/load
 *   leave this false so the view jumps instantly without competing animations.
 */
export function scrollToBottom(widget, smooth = false) {
  if (!widget.messagesContainer) return;
  if (widget._scrollRAF) cancelAnimationFrame(widget._scrollRAF);
  widget._scrollRAF = requestAnimationFrame(() => {
    const container = widget.messagesContainer;
    if (smooth) {
      // scrollTo() honors the `smooth` behavior; the browser animates the
      // scroll over ~300ms. We can't fall back to scrollIntoView here because
      // both methods racing produces a janky double-scroll.
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    } else {
      // Direct scrollTop assignment is the most reliable instant-scroll path —
      // works in every browser/embed context, including ones where
      // `scrollTo({behavior:'instant'})` silently no-ops.
      container.scrollTop = container.scrollHeight;
      // Backup for deeply nested overflow contexts where scrollTop alone
      // didn't move the viewport.
      const lastMessage = container.lastElementChild;
      if (lastMessage) {
        lastMessage.scrollIntoView({ behavior: 'instant', block: 'end' });
      }
    }
  });
  // Hide the scroll-to-bottom button immediately so it doesn't linger while
  // the smooth scroll plays out — the scroll listener will recompute and
  // re-show it only if needed.
  hideScrollToBottomButton(widget);
}

/**
 * Show/hide the floating scroll-to-bottom button based on scroll position.
 * Visible when the user has scrolled up away from the bottom AND there's
 * actually more content below to scroll to (i.e. the messages overflow).
 */
export function updateScrollToBottomButton(widget) {
  if (!widget.scrollToBottomBtn || !widget.messagesContainer) return;
  const el = widget.messagesContainer;
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  // 40px threshold — small floating-point gaps when at-bottom shouldn't keep
  // the button visible, but the visitor genuinely scrolling up by a line
  // should reveal it.
  const isScrolledUp = distanceFromBottom > 40;
  const hasOverflow = el.scrollHeight > el.clientHeight;
  if (isScrolledUp && hasOverflow) {
    showScrollToBottomButton(widget);
  } else {
    hideScrollToBottomButton(widget);
  }
}

export function showScrollToBottomButton(widget) {
  widget.scrollToBottomBtn?.classList.add(CSS_CLASSES.SCROLL_TO_BOTTOM_VISIBLE);
}

export function hideScrollToBottomButton(widget) {
  widget.scrollToBottomBtn?.classList.remove(CSS_CLASSES.SCROLL_TO_BOTTOM_VISIBLE);
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
 * Show a centered spinner over the chat window while fetching messages,
 * conversations, or history. Separate from the typing dots in `showLoading` —
 * those mean "agent is responding"; this means "loading data from server".
 * Lazily built on first use and mounted in chatWindow (positioned ancestor)
 * so it stays centered regardless of message-list scroll.
 */
export function showFetchSpinner(widget) {
  if (!widget.chatWindow) return;
  if (!widget.fetchSpinner) {
    widget.fetchSpinner = widget._createFetchSpinner();
  }
  if (widget.fetchSpinner.parentNode !== widget.chatWindow) {
    widget.chatWindow.appendChild(widget.fetchSpinner);
  }
  widget.fetchSpinner.style.display = 'flex';
}

/**
 * Hide the centered fetch spinner. Detaches from the DOM so subsequent
 * inserts via showFetchSpinner stack correctly above any new content.
 */
export function hideFetchSpinner(widget) {
  if (!widget.fetchSpinner) return;
  if (widget.fetchSpinner.parentNode) {
    widget.fetchSpinner.parentNode.removeChild(widget.fetchSpinner);
  }
  widget.fetchSpinner.style.display = 'none';
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
    const bubbles = widget.messageBubblesContainer.querySelectorAll(
      '.chatvia-widget-floating-bubble'
    );
    bubbles.forEach((bubble, index) => {
      bubble.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      bubble.style.opacity = '0';
      bubble.style.transform = 'scale(0.9) translateY(10px)';

      // Remove after animation completes
      setTimeout(
        () => {
          if (bubble.parentNode) {
            bubble.parentNode.removeChild(bubble);
          }
        },
        300 + index * 50
      ); // Stagger the removal
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
 *
 * Hides every interactive affordance that would either fail without a session
 * or mutate state the visitor can't reach: composer (textarea + send + attach),
 * menu dropdown (new chat / clear / history all need a conversation). Header chrome
 * the visitor *can* still use — close, expand, theme toggle — stays enabled so
 * they can dismiss the locked widget or flip the theme while reading the
 * sign-in notice. The `chatvia-widget-locked` class on the container lets CSS
 * dim the disabled controls in one place.
 */
export async function disabledChat(widget, message = 'Chat disabled') {
  if (widget.sendButton) {
    widget.sendButton.disabled = true;
  }
  if (widget.chatInput) {
    widget.chatInput.disabled = true;
    widget.chatInput.placeholder = message;
  }
  // `<div role="button">` buttons (attach, menu) can't use the native
  // `disabled` attribute, so mark them via aria-disabled + tabindex=-1 and
  // let the locked class handle the visual + pointer-events lockout.
  for (const btn of [widget.attachButton, widget.menuButton]) {
    if (!btn) continue;
    btn.setAttribute('aria-disabled', 'true');
    btn.setAttribute('tabindex', '-1');
  }
  // If the menu happens to be open when we lock, close it so its items
  // aren't sitting on top of the disabled widget.
  if (widget.menuDropdown) {
    widget.menuDropdown.style.display = 'none';
    widget.menuButton?.setAttribute('aria-expanded', 'false');
  }
  if (widget.container) {
    widget.container.classList.add('chatvia-widget-locked');
  }
  clearMessages(widget);
  await widget.addMessage(CSS_CLASSES.MESSAGE_SYSTEM, message, false);
}
