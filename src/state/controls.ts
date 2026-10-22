/**
 * UI Controls Module
 * Handles toggle, expand, scroll, and other UI state management
 */

import { CSS_CLASSES, prefersReducedMotion, tabbableElements } from '../utils';
import { createIcon, createElement } from '../ui';
import { markMessagesAsRead, HANDOFF_MODE } from './handoff';
import { applyTheme, writeStoredTheme } from './config';
import { t } from '../i18n';
import type { ChatWidget } from '../widget';

/** What holding a pinned message in place takes right now (see measurePin). */
interface PinMeasurement {
  container: HTMLDivElement;
  spacer: HTMLDivElement;
  desiredScrollTop: number;
  spacerHeight: number;
}

/**
 * Toggle chat open/close
 */
export function toggleChat(widget: ChatWidget, open?: boolean): void {
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
  // Nothing to open or close before the widget has mounted (or when this
  // surface is disabled), yet the host page may call chatvia.open() any time.
  if (!widget.container) return;

  widget.isOpen = typeof open === 'boolean' ? open : !widget.isOpen;
  const isBarMode = widget.mode === 'bar';

  // The launcher tells assistive tech whether the chat is open, and its label
  // follows what a press will do next.
  widget.chatBubble?.setAttribute('aria-expanded', String(widget.isOpen));
  widget.chatBubble?.setAttribute(
    'aria-label',
    t(widget.isOpen ? 'widget.close_chat' : 'widget.open_chat')
  );

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
      // Covering the whole screen, the chat is modal.
      widget.chatWindow?.setAttribute('aria-modal', 'true');
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
      // On a touch screen, focusing the composer pops the keyboard up over half
      // the conversation; there the visitor taps the composer when ready.
      if (!isTouchScreen()) widget.chatInput?.focus();
      // Scroll to bottom when opening chat
      widget.scrollToBottom();
      // Mark messages as read if in human mode
      if (widget.handoffMode === HANDOFF_MODE.HUMAN) {
        markMessagesAsRead(widget);
      }
    }, 300);
  } else {
    // Closing hides the window; if focus was inside it, hand it back to the
    // control that reopens the chat rather than dropping it to the page.
    const focusWasInside = widget.chatWindow?.contains(document.activeElement) ?? false;
    // Leave no microphone on behind a hidden window.
    widget.dictation?.cancel();
    widget.chatWindow?.classList.remove(CSS_CLASSES.WINDOW_OPEN);
    widget.chatWindow?.removeAttribute('aria-modal');

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

    if (focusWasInside) {
      (isBarMode ? widget.barHistoryButton : widget.chatBubble)?.focus();
    }
  }

  const event = new CustomEvent(widget.isOpen ? 'chat:opened' : 'chat:closed', {
    detail: { widget }
  });
  document.dispatchEvent(event);
}

/** Primary pointer is a finger: focusing a text field would open the on-screen keyboard. */
function isTouchScreen(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

/**
 * Toggle expand/collapse
 */
export function toggleExpand(widget: ChatWidget): void {
  if (widget.settings.window_size === CSS_CLASSES.WINDOW_LARGE && !widget._previousWindowSize) {
    console.log('Already in large mode, cannot expand further unless collapsed first.');
    return;
  }

  widget.chatWindow?.classList.add(CSS_CLASSES.WINDOW_ANIMATING);

  if (!widget.isWidthExpanded) {
    widget._previousWindowSize = widget.settings.window_size;
    widget.settings.window_size = CSS_CLASSES.WINDOW_LARGE;
    widget.isWidthExpanded = true;
    widget.expandButton.title = t('widget.collapse_chat');
    widget.expandButton.innerHTML = '';
    widget.expandButton.appendChild(createIcon('collapse'));

    // Apply viewport-constrained max height
    constrainToViewport(widget);

    console.log('Expanded chat window to large from ' + widget._previousWindowSize);
  } else {
    widget.settings.window_size = widget._previousWindowSize || CSS_CLASSES.WINDOW_MEDIUM;
    widget._previousWindowSize = null;
    widget.isWidthExpanded = false;
    widget.expandButton.title = t('widget.expand_chat');
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
function constrainToViewport(widget: ChatWidget): void {
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
function removeViewportConstraint(widget: ChatWidget): void {
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
export function toggleTheme(widget: ChatWidget): void {
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
export function toggleMenuDropdown(widget: ChatWidget): void {
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
    widget.menuButton?.setAttribute('aria-expanded', 'false');
    return;
  }

  if (widget._updateMenuForHandoffState) {
    widget._updateMenuForHandoffState();
  }
  widget.menuDropdown.classList.add(CSS_CLASSES.MENU_DROPDOWN_OPEN);
  widget.menuButton?.setAttribute('aria-expanded', 'true');
  // Menu pattern: focus moves into the menu (arrow keys take it from there;
  // see setupMenuKeyboard).
  tabbableElements(widget.menuDropdown)[0]?.focus();
}

/**
 * Check if menu dropdown is opened
 */
export function menuDropdownIsOpened(widget: ChatWidget): boolean {
  return widget.menuDropdown?.classList.contains(CSS_CLASSES.MENU_DROPDOWN_OPEN) || false;
}

/**
 * Close menu dropdown
 */
export function closeMenuDropdown(widget: ChatWidget): void {
  if (menuDropdownIsOpened(widget)) {
    widget.menuDropdown.classList.remove(CSS_CLASSES.MENU_DROPDOWN_OPEN);
    widget.menuButton?.setAttribute('aria-expanded', 'false');
  }
}

/**
 * Gap (px) left above a message that's been pinned to the top of the viewport.
 * Matches the messages container's top padding (--chat-space-4) so the pinned
 * message sits flush against the content area's top edge.
 */
const PIN_TOP_GAP = 16;

/**
 * Lazily create (and keep last) the trailing spacer that reserves scroll room
 * beneath a pinned message. Always re-appended to the end so messages added
 * mid-turn (the streaming reply, typing dots) stay above it.
 */
function ensureScrollSpacer(widget: ChatWidget): HTMLDivElement {
  let spacer = widget._scrollSpacer;
  if (!spacer || !spacer.isConnected) {
    spacer = createElement('div', {
      className: CSS_CLASSES.SCROLL_SPACER,
      'aria-hidden': 'true'
    });
    widget._scrollSpacer = spacer;
  }
  if (widget.messagesContainer.lastElementChild !== spacer) {
    widget.messagesContainer.appendChild(spacer);
  }
  return spacer;
}

/**
 * Measure what it takes to hold `widget._scrollAnchorEl` at the top of the
 * viewport: the spacer height that makes that scroll position reachable, and
 * the scrollTop that lands the anchor PIN_TOP_GAP below the top edge.
 * Returns null when there's nothing to pin.
 */
function measurePin(widget: ChatWidget): PinMeasurement | null {
  const container = widget.messagesContainer;
  const anchor = widget._scrollAnchorEl;
  if (!container || !anchor || !anchor.isConnected) return null;

  const spacer = ensureScrollSpacer(widget);
  const containerTop = container.getBoundingClientRect().top;
  const anchorTop = anchor.getBoundingClientRect().top;
  const clientHeight = container.clientHeight;

  // Distance from the top of the scrollable content to the anchor's top. Adding
  // back scrollTop makes this invariant to the current scroll position, so it
  // stays correct as the reply streams in below.
  const anchorOffset = container.scrollTop + (anchorTop - containerTop);
  // Content height excluding the spacer (the spacer is always last).
  const naturalHeight = container.scrollHeight - spacer.offsetHeight;

  const desiredScrollTop = Math.max(0, anchorOffset - PIN_TOP_GAP);
  // Enough trailing space so `desiredScrollTop` is actually reachable; shrinks
  // toward 0 as the reply grows past one screen.
  const spacerHeight = Math.max(0, desiredScrollTop + clientHeight - naturalHeight);
  return { container, spacer, desiredScrollTop, spacerHeight };
}

/**
 * Share of the distance to the target covered each frame of a glide: an
 * ease-out that also absorbs uneven streaming chunks.
 */
const GLIDE_EASING = 0.2;

/**
 * Pin a message to the top of the viewport (ChatGPT-style). Reserves room below
 * with the spacer, then glides the message up to the top so the incoming reply
 * streams in beneath it. Once the reply outgrows the view, the same glide
 * follows it down. Stays active for the turn — `maintainPin` keeps the spacer
 * right-sized as the reply grows; a programmatic `scrollToBottom` ends it.
 */
export function pinMessageToTop(widget: ChatWidget, anchorEl: HTMLElement | null): void {
  if (!widget.messagesContainer || !anchorEl) return;
  // Drop any pending bottom-scroll (e.g. the one addMessage just queued) so it
  // can't fight the pin.
  if (widget._scrollRAF) cancelAnimationFrame(widget._scrollRAF);
  widget._scrollRAF = null;

  widget._scrollAnchorEl = anchorEl;
  widget._pinActive = true;
  widget._pinReleased = false;
  applyPin(widget);
  hideScrollToBottomButton(widget);
}

/**
 * Size the spacer now, synchronously, then (unless the visitor has scrolled
 * up) glide towards the bottom. While the reply fits under the question the
 * spacer makes the bottom exactly the pinned position; once it outgrows the
 * view, the bottom moves with the newest text and the glide follows it.
 */
function applyPin(widget: ChatWidget): void {
  const m = measurePin(widget);
  if (!m) {
    // Anchor gone (cleared/history reload) — abandon the pin gracefully.
    clearPin(widget);
    return;
  }
  m.spacer.style.height = `${m.spacerHeight}px`;
  // Once the visitor has scrolled up, only the spacer is maintained — never
  // pull them back. Scrolling back to the end resumes (setupScrollListener).
  if (widget._pinReleased) return;
  if (!widget._glideRAF) glideStep(widget);
}

/**
 * One frame of the glide, repeated until it reaches the bottom.
 *
 * Each step is an `instant` scroll, NOT `smooth`: the container sets
 * `scroll-behavior: smooth` in CSS, and a browser-animated scroll gets
 * cancelled the moment the streaming reply mutates the container. Re-measuring
 * every frame also keeps the target right as the reply grows.
 */
function glideStep(widget: ChatWidget): void {
  widget._glideRAF = null;
  if (!widget._pinActive || widget._pinReleased) return;

  const m = measurePin(widget);
  if (!m) {
    clearPin(widget);
    return;
  }
  m.spacer.style.height = `${m.spacerHeight}px`;
  // Flush the spacer's height into layout so the bottom is measured against it.
  const bottom = m.container.scrollHeight - m.container.clientHeight;
  const gap = bottom - m.container.scrollTop;
  if (Math.abs(gap) < 0.5) return;

  const step = prefersReducedMotion()
    ? gap
    : Math.sign(gap) * Math.max(1, Math.ceil(Math.abs(gap) * GLIDE_EASING));
  m.container.scrollTo({ top: m.container.scrollTop + step, behavior: 'instant' });
  widget._glideRAF = requestAnimationFrame(() => glideStep(widget));
}

/**
 * Keep a pinned message in place while content streams in beneath it (coalesced
 * to one frame). Release is gesture-driven (scrolling up sets
 * widget._pinReleased — see setupScrollListener), NOT inferred from scrollTop
 * deltas alone: a delta heuristic can't tell a finalize layout-shift from a
 * real scroll, so it would mistake the finish nudge for the visitor scrolling.
 */
export function maintainPin(widget: ChatWidget): void {
  if (!widget._pinActive) return;
  if (widget._scrollRAF) cancelAnimationFrame(widget._scrollRAF);
  widget._scrollRAF = requestAnimationFrame(() => {
    if (widget._pinActive) applyPin(widget);
  });
}

/**
 * Re-size the spacer synchronously, right now (no rAF). Called at finalize so
 * the small shift from appending the actions row / re-focusing the composer is
 * absorbed by the spacer before the browser can paint it — robust even when
 * rAF is throttled.
 */
export function holdPin(widget: ChatWidget): void {
  if (widget._pinActive) applyPin(widget);
}

/**
 * The visitor scrolled up: stop gliding and leave the view where they put it.
 */
export function releasePin(widget: ChatWidget): void {
  if (!widget._pinActive) return;
  widget._pinReleased = true;
  if (widget._glideRAF) cancelAnimationFrame(widget._glideRAF);
  widget._glideRAF = null;
}

/**
 * The visitor came back to the end (by scrolling or the button): follow the
 * reply again.
 */
export function resumePin(widget: ChatWidget): void {
  if (!widget._pinActive || !widget._pinReleased) return;
  widget._pinReleased = false;
  applyPin(widget);
}

/**
 * Pin-aware auto-follow used by the streaming path: glide with the pinned turn
 * while a pin is active, otherwise fall back to the classic follow-the-bottom.
 */
export function followStream(widget: ChatWidget): void {
  if (widget._pinActive) {
    maintainPin(widget);
  } else {
    scrollToBottom(widget);
  }
}

/**
 * Tear down pin state and collapse the reserved spacer. Called whenever the view
 * explicitly returns to bottom-follow (open, history load, …).
 */
function clearPin(widget: ChatWidget): void {
  widget._pinActive = false;
  widget._pinReleased = false;
  widget._scrollAnchorEl = null;
  if (widget._glideRAF) cancelAnimationFrame(widget._glideRAF);
  widget._glideRAF = null;
  if (widget._scrollSpacer) {
    widget._scrollSpacer.style.height = '0px';
  }
}

/**
 * Scroll to bottom of messages.
 * @param smooth — when true, animates the scroll (used by the
 *   scroll-to-bottom button click). Auto-scroll calls during streaming/load
 *   leave this false so the view jumps instantly without competing animations.
 */
export function scrollToBottom(widget: ChatWidget, smooth = false): void {
  if (!widget.messagesContainer) return;
  // The button during a pinned turn: the pin's bottom is the end of the reply,
  // so resuming the glide gets there and keeps following.
  if (smooth && widget._pinActive && widget._pinReleased) {
    resumePin(widget);
    hideScrollToBottomButton(widget);
    return;
  }
  // Returning to the bottom is incompatible with a top-pin — release it so the
  // reserved spacer collapses and we can reach the true bottom.
  clearPin(widget);
  if (widget._scrollRAF) cancelAnimationFrame(widget._scrollRAF);
  widget._scrollRAF = requestAnimationFrame(() => {
    const container = widget.messagesContainer;
    if (smooth) {
      // scrollTo() honors the `smooth` behavior; the browser animates the
      // scroll over ~300ms. We can't fall back to scrollIntoView here because
      // both methods racing produces a janky double-scroll.
      container.scrollTo({
        top: container.scrollHeight,
        behavior: prefersReducedMotion() ? 'instant' : 'smooth'
      });
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
export function updateScrollToBottomButton(widget: ChatWidget): void {
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

export function showScrollToBottomButton(widget: ChatWidget): void {
  widget.scrollToBottomBtn?.classList.add(CSS_CLASSES.SCROLL_TO_BOTTOM_VISIBLE);
}

export function hideScrollToBottomButton(widget: ChatWidget): void {
  widget.scrollToBottomBtn?.classList.remove(CSS_CLASSES.SCROLL_TO_BOTTOM_VISIBLE);
}

/**
 * Clear all messages
 */
export function clearMessages(widget: ChatWidget): void {
  if (widget.messagesContainer) {
    widget.messagesContainer.innerHTML = '';
  }
}

/**
 * Show loading indicator
 */
export function showLoading(widget: ChatWidget): void {
  if (!widget.loadingIndicator || !widget.messagesContainer) return;

  if (!widget.loadingIndicator.parentNode) {
    widget.messagesContainer.appendChild(widget.loadingIndicator);
  }
  widget.loadingIndicator.style.display = 'flex';
  // Keep the typing dots under a pinned question rather than yanking to bottom.
  followStream(widget);

  if (widget._loadingSafetyTimeout) clearTimeout(widget._loadingSafetyTimeout);
  widget._loadingSafetyTimeout = setTimeout(() => hideLoading(widget), 30000);
}

/**
 * Hide loading indicator
 */
export function hideLoading(widget: ChatWidget): void {
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
export function showFetchSpinner(widget: ChatWidget): void {
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
export function hideFetchSpinner(widget: ChatWidget): void {
  if (!widget.fetchSpinner) return;
  if (widget.fetchSpinner.parentNode) {
    widget.fetchSpinner.parentNode.removeChild(widget.fetchSpinner);
  }
  widget.fetchSpinner.style.display = 'none';
}

/**
 * Auto resize input textarea
 */
export function autoResizeInput(widget: ChatWidget): void {
  if (!widget.chatInput || !widget.inputContainer || !widget.messagesContainer) return;

  if (widget._resizeRAF) cancelAnimationFrame(widget._resizeRAF);
  widget._resizeRAF = requestAnimationFrame(() => {
    widget.chatInput.style.height = 'auto';
    const scrollH = widget.chatInput.scrollHeight;
    // When the widget is closed (its window is display:none) the textarea has
    // no layout, so scrollHeight is 0. Writing `height: 0px` here would pin the
    // composer to its min-height and leave the text sitting low until the first
    // keystroke re-runs this while visible. Bail and let the CSS height stand;
    // this runs again on open/input once the element is actually laid out.
    if (scrollH === 0) {
      widget.chatInput.style.height = '';
      return;
    }
    const newHeight = Math.min(scrollH, 120);
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
 * Lock the host page's scroll while the chat covers it. The page's own inline
 * styles are saved so unlocking restores them, and a repeated lock is ignored
 * (it would otherwise record scroll position 0 and jump the page on close).
 */
export function lockBodyScroll(widget: ChatWidget): void {
  if (widget._savedBodyStyle) return;

  const style = document.body.style;
  widget._savedBodyStyle = {
    overflow: style.overflow,
    position: style.position,
    top: style.top,
    width: style.width
  };
  widget._scrollPosition = window.pageYOffset || document.documentElement.scrollTop;

  style.overflow = 'hidden';
  style.position = 'fixed';
  style.top = `-${widget._scrollPosition}px`;
  style.width = '100%';

  document.body.classList.add('chatvia-scroll-locked');
}

/**
 * Undo lockBodyScroll(). Does nothing unless this widget locked the page, so
 * destroy() never wipes styles the host page set itself.
 */
export function unlockBodyScroll(widget: ChatWidget): void {
  const saved = widget._savedBodyStyle;
  if (!saved) return;
  widget._savedBodyStyle = null;

  Object.assign(document.body.style, saved);
  document.body.classList.remove('chatvia-scroll-locked');

  if (widget._scrollPosition !== undefined) {
    window.scrollTo(0, widget._scrollPosition);
    widget._scrollPosition = undefined;
  }
}

/**
 * Stop message bubbles
 */
export function stopMessageBubbles(widget: ChatWidget): void {
  if (widget.messageBubblesContainer) {
    // Fade out all bubbles with animation
    const bubbles = widget.messageBubblesContainer.querySelectorAll<HTMLElement>(
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
export function hideStarters(widget: ChatWidget): void {
  widget.startersVisible = false;
  widget._updateStartersContainer();
  autoResizeInput(widget);
}

/**
 * Show starters
 */
export function showStarters(widget: ChatWidget): void {
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
export async function disabledChat(
  widget: ChatWidget,
  message: string = t('errors.chat_disabled')
): Promise<void> {
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
