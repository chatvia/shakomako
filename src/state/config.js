/**
 * Configuration Module
 * Handles configuration application and styling
 */

import { CSS_CLASSES, DEFAULT_LOGO_SVG } from '../utils.js';
import { createElement, createIcon } from '../ui.js';

const THEME_STORAGE_PREFIX = 'chatvia-theme:';

/**
 * Read a visitor's saved theme choice (set via the header toggle).
 * Returns 'light' | 'dark' | null. Namespaced per agent so multiple
 * widgets on one page don't clobber each other.
 */
export function readStoredTheme(agentId) {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_PREFIX + agentId);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Persist the visitor's explicit theme choice.
 * Silently no-ops when storage is unavailable (private mode / sandboxed iframe).
 */
export function writeStoredTheme(agentId, value) {
  try {
    window.localStorage.setItem(THEME_STORAGE_PREFIX + agentId, value);
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/**
 * Apply all configuration
 */
export function applyConfiguration(widget) {
  if (!widget.container) return;

  const positionClass =
    widget.settings.position === 'bottom-left'
      ? CSS_CLASSES.POSITION_BOTTOM_LEFT
      : CSS_CLASSES.POSITION_BOTTOM_RIGHT;
  widget.container.className = `${CSS_CLASSES.WIDGET} ${widget.isFlat ? CSS_CLASSES.FLAT_MODE : positionClass}`;

  if (widget.isFlat) {
    if (widget.chatBubble) widget.chatBubble.style.display = 'none';
  }

  applyWindowSize(widget);
  applyColors(widget);
  applyTheme(widget);
  applyLogos(widget);
  applyTitle(widget);
  applyBranding(widget);
  applyInputPlaceholder(widget);
  widget._updateStartersContainer();
}

/**
 * Apply window size
 */
export function applyWindowSize(widget) {
  if (!widget.chatWindow) return;

  // Skip applying window sizes in flat mode
  if (widget.isFlat) return;

  widget.chatWindow.classList.remove(
    CSS_CLASSES.WINDOW_SMALL,
    CSS_CLASSES.WINDOW_MEDIUM,
    CSS_CLASSES.WINDOW_LARGE
  );

  if (
    [CSS_CLASSES.WINDOW_SMALL, CSS_CLASSES.WINDOW_MEDIUM, CSS_CLASSES.WINDOW_LARGE].includes(
      widget.settings.window_size
    )
  ) {
    widget.chatWindow.classList.add(widget.settings.window_size);

    if (widget.expandButton) {
      if (widget.settings.window_size === CSS_CLASSES.WINDOW_LARGE) {
        widget.expandButton.style.display = widget._previousWindowSize ? 'flex' : 'none';
      } else {
        widget.expandButton.style.display = 'flex';
      }
    }
  }

  // Apply dynamic height constraint based on viewport
  applyDynamicHeightConstraint(widget);
}

/**
 * Apply dynamic height constraint based on viewport
 * Ensures widget never gets cut off at the top
 */
function applyDynamicHeightConstraint(widget) {
  if (!widget.chatWindow || widget.isFlat) return;

  const viewportHeight = window.innerHeight;
  const bottomOffset = 100; // Bottom position from CSS (bottom: 100px when open)
  const topMargin = 20; // Minimum margin from top of viewport

  // Calculate maximum safe height
  const maxSafeHeight = viewportHeight - bottomOffset - topMargin;

  // Apply constraint inline (overrides CSS if needed)
  widget.chatWindow.style.maxHeight = `${maxSafeHeight}px`;
}

/**
 * Apply the brand color from the agent's settings as a set of CSS variables
 * on the widget container.
 *
 * Contract: `settings.color_theme` (palette name, e.g. "blue") and
 * `settings.color_shade` (Tailwind-style shade, e.g. 600) MUST be supplied
 * by the backend. Every brand-colored surface in the widget — header,
 * user bubble, focus ring, send button, focused input — resolves through
 * `--chat-primary`, so a missing setting means a broken render. We warn
 * loudly rather than substituting a fake default; the CSS sentinel for
 * "unset" is transparent (see shared.css :root --chat-primary).
 *
 * Scoping: the variables are set on `widget.container`, never on
 * `document.documentElement`, so multiple widgets on the same host page can
 * carry different brands and the host site's :root is left untouched.
 *
 * Indirection re-binding: `--chat-user-bubble` and `--chat-focus-ring` are
 * declared at :root as `var(--chat-primary)` and a `color-mix()` through it.
 * Custom-property `var()` substitution is resolved at the declaration site,
 * so those indirections capture :root's value of `--chat-primary` (the
 * transparent sentinel) and an override on `widget.container` does NOT
 * propagate through them. We rebind both here explicitly — without this the
 * header would carry the brand color (it reads `--chat-primary` directly)
 * but the user bubble would render as transparent washout. If a future
 * variable is declared as an indirection through `--chat-primary`, it must
 * also be re-bound here.
 */
export function applyColors(widget) {
  if (!widget.container) return;

  const colorTheme = widget.settings.color_theme;
  const colorShade = widget.settings.color_shade;

  if (!colorTheme || colorShade == null) {
    console.warn(
      'chatvia: agent settings missing color_theme and/or color_shade — ' +
        'the widget will render with the unset (transparent) sentinel. ' +
        'Backend must supply both fields.',
      { color_theme: colorTheme, color_shade: colorShade }
    );
    return;
  }

  const primary = `var(--${colorTheme}-${colorShade})`;
  widget.container.style.setProperty('--chat-primary', primary);
  // Re-bound indirections — see function-level comment.
  widget.container.style.setProperty('--chat-user-bubble', primary);
  widget.container.style.setProperty(
    '--chat-focus-ring',
    `color-mix(in srgb, ${primary} 16%, transparent)`
  );
}

const VALID_THEMES = ['auto', 'light', 'dark'];

function systemPrefersDark() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

/**
 * Apply the theme (light / dark / auto).
 * Precedence: embed data-theme (widget.themePreference) > backend settings.theme > 'light'.
 * 'auto' follows the OS color scheme and keeps following it via a media-query listener.
 */
export function applyTheme(widget) {
  let pref = widget.themePreference || widget.settings?.theme || 'light';
  if (!VALID_THEMES.includes(pref)) pref = 'light';
  widget.themePreference = pref;

  applyResolvedTheme(widget);

  if (pref === 'auto') {
    setupAutoThemeListener(widget);
  } else {
    teardownAutoThemeListener(widget);
  }
}

/**
 * Toggle the dark class on every theming surface based on the resolved mode,
 * and keep settings.theme in sync for any runtime toggle.
 */
function applyResolvedTheme(widget) {
  const isDark =
    widget.themePreference === 'dark' || (widget.themePreference === 'auto' && systemPrefersDark());

  [widget.chatWindow, widget.bar].forEach(el => {
    el?.classList.toggle(CSS_CLASSES.WINDOW_DARK, isDark);
  });

  widget.settings.theme = isDark ? 'dark' : 'light';
  updateThemeToggleButton(widget);
}

/**
 * Keep the header toggle's icon and label in sync with the resolved theme.
 * Shows the icon of the mode the visitor would switch TO (moon in light, sun in dark).
 */
export function updateThemeToggleButton(widget) {
  const btn = widget.themeToggleButton;
  if (!btn) return;

  const isDark = widget.settings.theme === 'dark';
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.innerHTML = '';
  btn.appendChild(createIcon(isDark ? 'sun' : 'moon'));
}

function setupAutoThemeListener(widget) {
  if (widget._themeMediaQuery || typeof window.matchMedia !== 'function') return;

  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    if (widget.themePreference === 'auto') applyResolvedTheme(widget);
  };

  // addEventListener is preferred; addListener is the Safari < 14 fallback.
  if (mql.addEventListener) mql.addEventListener('change', handler);
  else if (mql.addListener) mql.addListener(handler);

  widget._themeMediaQuery = mql;
  widget._themeMediaListener = handler;
}

export function teardownAutoThemeListener(widget) {
  const mql = widget._themeMediaQuery;
  const handler = widget._themeMediaListener;
  if (mql && handler) {
    if (mql.removeEventListener) mql.removeEventListener('change', handler);
    else if (mql.removeListener) mql.removeListener(handler);
  }
  widget._themeMediaQuery = null;
  widget._themeMediaListener = null;
}

/**
 * Apply logos
 */
export function applyLogos(widget) {
  const logoUrl = widget.settings.logo_url || DEFAULT_LOGO_SVG;
  if (widget.headerLogo && !widget.headerLogo.src) {
    widget.headerLogo.src = logoUrl;
  }
}

/**
 * Apply title
 */
export function applyTitle(widget) {
  if (widget.headerTitle) {
    widget.headerTitle.textContent = widget.settings.title;
  }
}

/**
 * Apply branding
 */
export function applyBranding(widget) {
  if (!widget.brandFooter) return;
  const showBranding = widget.settings.branding?.enabled;
  if (showBranding) {
    widget.brandFooter.innerHTML = '';

    const brandName = widget.settings.branding.name || '';
    const brandUrl = widget.settings.branding.url || '';
    const brandLogoUrl = widget.settings.branding.logo_url || '';

    const isValidUrl = url => {
      if (!url) return false;
      try {
        const parsed = new URL(url, window.location.origin);
        return ['http:', 'https:'].includes(parsed.protocol);
      } catch {
        return false;
      }
    };

    const container =
      brandUrl && isValidUrl(brandUrl)
        ? createElement('a', {
            href: brandUrl,
            target: '_blank',
            rel: 'noopener noreferrer'
          })
        : createElement('span');

    if (brandLogoUrl && isValidUrl(brandLogoUrl)) {
      const logo = createElement('img', {
        src: brandLogoUrl,
        alt: 'Logo',
        className: CSS_CLASSES.BRAND_LOGO
      });
      container.appendChild(logo);
    }

    const textNode = document.createTextNode(brandName);
    container.appendChild(textNode);

    widget.brandFooter.appendChild(container);
    widget.brandFooter.style.display = 'block';
  } else {
    widget.brandFooter.style.display = 'none';
  }
}

/**
 * Apply input placeholder from settings
 */
export function applyInputPlaceholder(widget) {
  const placeholder =
    widget.settings?.welcome_message || widget.options?.placeholder || 'Type a message...';

  if (widget.chatInput) {
    widget.chatInput.placeholder = placeholder;
    widget.chatInput.setAttribute('aria-label', placeholder);
  }

  if (widget.barInput) {
    widget.barInput.placeholder = placeholder;
  }
}

/**
 * Update starters container
 */
export function updateStartersContainer(widget) {
  if (!widget.startersContainer) return;

  widget.startersContainer.innerHTML = '';

  if (
    !widget.settings.starters ||
    !Array.isArray(widget.settings.starters) ||
    widget.settings.starters.length === 0 ||
    !widget.startersVisible
  ) {
    widget.startersContainer.style.height = '0';
    widget.startersContainer.style.padding = '0';
    widget.startersContainer.style.opacity = '0';
    widget.startersContainer.style.overflow = 'hidden';
    return;
  }

  widget.startersContainer.style.display = 'flex';
  widget.startersContainer.style.height = 'auto';
  widget.startersContainer.style.padding = '16px';
  widget.startersContainer.style.opacity = '1';
  widget.startersContainer.style.overflow = 'auto';

  widget.settings.starters.forEach(starter => {
    const starterButton = createElement('div', {
      className: CSS_CLASSES.STARTER_BUTTON,
      textContent: starter,
      role: 'button',
      tabIndex: 0
    });

    starterButton.addEventListener('click', () => {
      widget.sendUserMessage(starter);
      widget.hideStarters();
    });

    starterButton.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        widget.sendUserMessage(starter);
        widget.hideStarters();
      }
    });

    widget.startersContainer.appendChild(starterButton);
  });
}
