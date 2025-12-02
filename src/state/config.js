/**
 * Configuration Module
 * Handles configuration application and styling
 */

import { CSS_CLASSES, DEFAULT_LOGO_SVG } from '../utils.js';
import { createElement } from '../ui.js';
import { loadLibraries } from './messages.js';

/**
 * Apply all configuration
 */
export async function applyConfiguration(widget) {
  if (!widget.container) return;

  const positionClass = widget.settings.position === 'bottom-left' 
    ? CSS_CLASSES.POSITION_BOTTOM_LEFT 
    : CSS_CLASSES.POSITION_BOTTOM_RIGHT;
  widget.container.className = `${CSS_CLASSES.WIDGET} ${widget.isFlat ? CSS_CLASSES.FLAT_MODE : positionClass}`;

  if (widget.isFlat) {
    if (widget.chatBubble) widget.chatBubble.style.display = 'none';
  }

  applyWindowSize(widget);
  applyColors(widget);
  applyLogos(widget);
  applyTitle(widget);
  applyBranding(widget);
  applyInputPlaceholder(widget);
  await loadLibraries();
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

  if ([CSS_CLASSES.WINDOW_SMALL, CSS_CLASSES.WINDOW_MEDIUM, CSS_CLASSES.WINDOW_LARGE].includes(widget.settings.window_size)) {
    widget.chatWindow.classList.add(widget.settings.window_size);

    if (widget.expandButton) {
      if (widget.settings.window_size === CSS_CLASSES.WINDOW_LARGE) {
        widget.expandButton.style.display = widget._previousWindowSize ? 'flex' : 'none';
      } else {
        widget.expandButton.style.display = 'flex';
      }
    }
  }
}

/**
 * Apply color theme
 */
export function applyColors(widget) {
  const colorTheme = widget.settings.color_theme;
  const colorShade = widget.settings.color_shade;
  
  if (!colorTheme || colorShade == null) {
    return;
  }
  
  document.documentElement.style.setProperty('--chat-primary', `var(--${colorTheme}-${colorShade})`);
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
    
    const isValidUrl = (url) => {
      if (!url) return false;
      try {
        const parsed = new URL(url, window.location.origin);
        return ['http:', 'https:'].includes(parsed.protocol);
      } catch {
        return false;
      }
    };
    
    const container = brandUrl && isValidUrl(brandUrl) 
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
  const placeholder = widget.settings?.welcome_message || widget.options?.placeholder || 'Type a message...';
  
  if (widget.chatInput) {
    widget.chatInput.placeholder = placeholder;
    widget.chatInput.setAttribute('aria-label', placeholder);
  }
  
  if (widget.searchInput) {
    widget.searchInput.placeholder = placeholder;
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

