/**
 * Configuration Module
 * Handles configuration application and styling
 */

import { CSS_CLASSES, DEFAULT_LOGO_SVG, isOneOf, safeImageUrl } from '../utils';
import { createElement, createIcon } from '../ui';
import { getDirection, pickLocalized, t } from '../i18n';
import type { TextDirection } from '../i18n';
import type { ChatWidget } from '../widget';

const THEME_STORAGE_PREFIX = 'chatvia-theme:';
const PRIVACY_DISMISSED_PREFIX = 'chatvia-privacy-dismissed:';

/**
 * Read a visitor's saved theme choice (set via the header toggle).
 * Returns 'light' | 'dark' | null. Namespaced per agent so multiple
 * widgets on one page don't clobber each other.
 */
export function readStoredTheme(agentId: string): 'light' | 'dark' | null {
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
export function writeStoredTheme(agentId: string, value: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_PREFIX + agentId, value);
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/**
 * Whether the visitor has dismissed the privacy-consent strip for this agent.
 * Namespaced per agent, same scheme as the theme choice.
 */
export function readPrivacyDismissed(agentId: string): boolean {
  try {
    return window.localStorage.getItem(PRIVACY_DISMISSED_PREFIX + agentId) === '1';
  } catch {
    return false;
  }
}

/**
 * Remember that the visitor dismissed the privacy-consent strip. Silently
 * no-ops when storage is unavailable (private mode / sandboxed iframe).
 */
export function writePrivacyDismissed(agentId: string): void {
  try {
    window.localStorage.setItem(PRIVACY_DISMISSED_PREFIX + agentId, '1');
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/**
 * Apply all configuration
 */
export function applyConfiguration(widget: ChatWidget): void {
  if (!widget.container) return;

  const positionClass =
    resolvePlacement(widget.settings.position, getDirection()) === 'bottom-left'
      ? CSS_CLASSES.POSITION_BOTTOM_LEFT
      : CSS_CLASSES.POSITION_BOTTOM_RIGHT;
  widget.container.className = `${CSS_CLASSES.WIDGET} ${widget.isFlat ? CSS_CLASSES.FLAT_MODE : positionClass}`;

  if (widget.isFlat) {
    if (widget.chatBubble) widget.chatBubble.style.display = 'none';
  }

  applyDirection(widget);
  applyWindowSize(widget);
  applyColors(widget);
  applyTheme(widget);
  applyLogos(widget);
  applyTitle(widget);
  applyBranding(widget);
  applyInputPlaceholder(widget);
  applyFooterText(widget);
  applyPrivacyNotice(widget);
  widget._updateStartersContainer();
}

/**
 * Which corner the bubble sits in for the active text direction. The agent's
 * configured placement describes the left-to-right layout; in a right-to-left
 * language the whole page mirrors, so the bubble mirrors with it — the default
 * bottom-right becomes bottom-left for Arabic readers, and vice versa.
 *
 * @param configured - 'bottom-left' | 'bottom-right' (anything else = bottom-right)
 */
export function resolvePlacement(
  configured: string | null | undefined,
  direction: TextDirection
): 'bottom-left' | 'bottom-right' {
  const ltr = configured === 'bottom-left' ? 'bottom-left' : 'bottom-right';
  if (direction !== 'rtl') return ltr;
  return ltr === 'bottom-left' ? 'bottom-right' : 'bottom-left';
}

/**
 * Apply the text direction for the active language onto every top-level widget
 * surface. `dir="rtl"` triggers the `[dir="rtl"]` overrides in widget.css that
 * mirror padding/margin, send-button placement, dropdown anchoring, etc.
 *
 * We stamp `dir` on each surface independently because the bar launcher,
 * floating bubble container, and chat window can all live outside `container`
 * in different render modes — relying on inheritance alone would miss them.
 */
export function applyDirection(widget: ChatWidget): void {
  const dir = getDirection();
  const surfaces = [
    widget.container,
    widget.chatWindow,
    widget.bar,
    widget.messageBubblesContainer
  ];
  for (const el of surfaces) {
    if (el) el.setAttribute('dir', dir);
  }
}

// Map the API's semantic window size ('small' / 'medium' / 'large') to the CSS
// class the window logic works in ('chatvia-widget-large'). applyWindowSize()
// and the expand/collapse controls (controls.ts) both compare against and assign
// these classes, so we normalize once at settings ingestion. Valid classes pass
// through; anything unrecognised (incl. null) falls back to large — the default.
const WINDOW_SIZE_CLASS: Record<string, string> = {
  small: CSS_CLASSES.WINDOW_SMALL,
  medium: CSS_CLASSES.WINDOW_MEDIUM,
  large: CSS_CLASSES.WINDOW_LARGE
};

export function normalizeWindowSize(size: string | null | undefined): string {
  if (size && WINDOW_SIZE_CLASS[size]) return WINDOW_SIZE_CLASS[size];
  return isOneOf(Object.values(WINDOW_SIZE_CLASS), size) ? size : CSS_CLASSES.WINDOW_LARGE;
}

/**
 * Apply window size
 */
export function applyWindowSize(widget: ChatWidget): void {
  if (!widget.chatWindow) return;

  // Skip applying window sizes in flat mode
  if (widget.isFlat) return;

  widget.chatWindow.classList.remove(
    CSS_CLASSES.WINDOW_SMALL,
    CSS_CLASSES.WINDOW_MEDIUM,
    CSS_CLASSES.WINDOW_LARGE
  );

  if (
    isOneOf(
      [CSS_CLASSES.WINDOW_SMALL, CSS_CLASSES.WINDOW_MEDIUM, CSS_CLASSES.WINDOW_LARGE],
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
function applyDynamicHeightConstraint(widget: ChatWidget): void {
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
// Allowlists for the parts that get interpolated into a CSS custom-property
// value. `colorTheme` is a Tailwind-style palette name ("blue", "red", "sky");
// `colorShade` is a 50-950 numeric shade. Anything outside these shapes would
// produce invalid CSS (silently dropped by the CSSOM) and shouldn't reach the
// stylesheet — refuse and warn instead. Defence-in-depth even though the
// CSSOM rejects break-out attempts; keeps the surface obviously inert.
const COLOR_THEME_RE = /^[a-z]+$/;
const COLOR_SHADE_RE = /^\d{1,4}$/;

export function applyColors(widget: ChatWidget): void {
  if (!widget.container) return;

  const colorTheme = widget.settings.color_theme;
  const colorShade = widget.settings.color_shade;

  if (!colorTheme || colorShade === null || colorShade === undefined) {
    console.warn(
      'chatvia: agent settings missing color_theme and/or color_shade — ' +
        'the widget will render with the unset (transparent) sentinel. ' +
        'Backend must supply both fields.',
      { color_theme: colorTheme, color_shade: colorShade }
    );
    return;
  }

  if (!COLOR_THEME_RE.test(String(colorTheme)) || !COLOR_SHADE_RE.test(String(colorShade))) {
    console.warn(
      'chatvia: rejected color_theme/color_shade with unexpected characters. ' +
        'Expected lowercase letters and a numeric shade.',
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

const VALID_THEMES = ['auto', 'light', 'dark'] as const;
export type ThemePreference = (typeof VALID_THEMES)[number];

function systemPrefersDark(): boolean {
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
export function applyTheme(widget: ChatWidget): void {
  const requested = widget.themePreference || widget.settings?.theme || 'light';
  const pref: ThemePreference = isOneOf(VALID_THEMES, requested) ? requested : 'light';
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
function applyResolvedTheme(widget: ChatWidget): void {
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
export function updateThemeToggleButton(widget: ChatWidget): void {
  const btn = widget.themeToggleButton;
  if (!btn) return;

  const isDark = widget.settings.theme === 'dark';
  const label = isDark ? t('menu.switch_to_light') : t('menu.switch_to_dark');
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.innerHTML = '';
  btn.appendChild(createIcon(isDark ? 'sun' : 'moon'));
}

function setupAutoThemeListener(widget: ChatWidget): void {
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

export function teardownAutoThemeListener(widget: ChatWidget): void {
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
export function applyLogos(widget: ChatWidget): void {
  const logoUrl = safeImageUrl(widget.settings.logo_url) || DEFAULT_LOGO_SVG;
  if (widget.headerLogo && !widget.headerLogo.src) {
    widget.headerLogo.src = logoUrl;
    // Don't leak the embedding host's URL to the logo origin (set on the
    // element rather than the createElement attrs because the element was
    // built earlier in _createHeader without knowing the src).
    widget.headerLogo.referrerPolicy = 'no-referrer';
  }
}

/**
 * Apply title
 */
export function applyTitle(widget: ChatWidget): void {
  if (widget.headerTitle) {
    widget.headerTitle.textContent =
      pickLocalized(widget.settings?.text_translations?.title, widget.settings.title) ?? null;
  }
}

/**
 * Apply branding
 */
export function applyBranding(widget: ChatWidget): void {
  if (!widget.brandFooter) return;
  // `chatvia_branding` is the install-wide gate: Chatvia sets it to false only
  // when the install has a license that hides the credit. Absent (older
  // payloads) → treat as true and fall back to the legacy branding.enabled
  // flag, which the backend drives from the same value.
  const chatviaVisible = widget.settings.chatvia_branding !== false;
  const showBranding = chatviaVisible && widget.settings.branding?.enabled;
  if (showBranding) {
    widget.brandFooter.innerHTML = '';

    const brandName = widget.settings.branding!.name || '';

    // The credit always links to chatvia.ai: fixed here, never taken from the
    // settings payload, so no install can point it somewhere else.
    const container = createElement('a', {
      href: 'https://chatvia.ai',
      target: '_blank',
      rel: 'noopener'
    });

    // The ChatVia mark is drawn inline, as in the hosted chat, rather than
    // from branding.logo_url: that SVG picks its colour from the OS dark-mode
    // setting, so it vanished on a light widget under a dark OS. Decorative,
    // since the label next to it names the product.
    const logo = createIcon('chatvia');
    logo.setAttribute('class', CSS_CLASSES.BRAND_LOGO);
    logo.setAttribute('aria-hidden', 'true');
    container.appendChild(logo);

    const textNode = document.createTextNode(brandName);
    container.appendChild(textNode);

    widget.brandFooter.appendChild(container);
    widget.brandFooter.style.display = 'block';
  } else {
    widget.brandFooter.style.display = 'none';
  }
}

/**
 * Apply the disclaimer text strip below the composer (e.g. "AI can make
 * mistakes…"). When the agent hasn't configured one, hide the element so the
 * input sits flush against the brand footer.
 */
export function applyFooterText(widget: ChatWidget): void {
  if (!widget.footerText) return;
  const text = widget.settings?.chat_footer_text;
  if (typeof text === 'string' && text.trim() !== '') {
    widget.footerText.textContent = text;
    widget.footerText.style.display = '';
  } else {
    widget.footerText.textContent = '';
    widget.footerText.style.display = 'none';
  }
}

/**
 * Render the "By chatting, you agree to our privacy policy" consent strip above
 * the composer. Shown only when the agent has a valid http(s)
 * `privacy_policy_url` set AND the visitor hasn't dismissed it for this agent.
 *
 * The sentence and the link text are both translated. The sentence carries a
 * `{link}` placeholder we split on, so the anchor lands inline without ever
 * injecting translated/owner-supplied strings as HTML — text goes in as text
 * nodes, the URL only as a validated href.
 */
export function applyPrivacyNotice(widget: ChatWidget): void {
  const el = widget.privacyNotice;
  const textEl = widget.privacyNoticeText;
  if (!el || !textEl) return;

  const url = widget.settings?.privacy_policy_url;

  const isValidLinkUrl = (u: unknown): u is string => {
    if (!u || typeof u !== 'string') return false;
    try {
      return ['http:', 'https:'].includes(new URL(u, window.location.origin).protocol);
    } catch {
      return false;
    }
  };

  if (!isValidLinkUrl(url) || readPrivacyDismissed(widget.agentId)) {
    el.style.display = 'none';
    textEl.textContent = '';
    return;
  }

  const template = t('widget.privacy_consent'); // "By chatting, you agree to our {link}."
  const linkText = t('widget.privacy_policy'); // "privacy policy"
  const [before, after = ''] = template.split('{link}');

  textEl.textContent = '';
  textEl.appendChild(document.createTextNode(before));
  textEl.appendChild(
    createElement('a', {
      className: CSS_CLASSES.PRIVACY_NOTICE_LINK,
      href: url,
      target: '_blank',
      rel: 'noopener noreferrer',
      textContent: linkText
    })
  );
  textEl.appendChild(document.createTextNode(after));

  el.style.display = '';
}

/**
 * Apply input placeholder from settings.
 * Pulls from `composer_placeholder` (configured in the dashboard's appearance
 * group). `welcome_message` is intentionally NOT read here — it's the full
 * greeting rendered as the first assistant message.
 */
export function applyInputPlaceholder(widget: ChatWidget): void {
  const placeholder =
    pickLocalized(
      widget.settings?.text_translations?.composer_placeholder,
      widget.settings?.composer_placeholder
    ) ||
    widget.options?.placeholder ||
    t('widget.type_message');

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
export function updateStartersContainer(widget: ChatWidget): void {
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
    // Starters may be plain strings (legacy) or { text, icon, translations }
    // objects; localize the text to the widget's active language.
    const text =
      typeof starter === 'string' ? starter : pickLocalized(starter?.translations, starter?.text);
    if (!text) return;

    const starterButton = createElement('div', {
      className: CSS_CLASSES.STARTER_BUTTON,
      textContent: text,
      role: 'button',
      tabIndex: 0
    });

    starterButton.addEventListener('click', () => {
      widget.sendUserMessage(text);
      widget.hideStarters();
    });

    starterButton.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        widget.sendUserMessage(text);
        widget.hideStarters();
      }
    });

    widget.startersContainer.appendChild(starterButton);
  });
}
