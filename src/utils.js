/**
 * The global namespace the embed script attaches everything to:
 * `window.chatvia`. Imported by both the embed loader and the widget
 * so the string lives in exactly one place.
 */
export const NAMESPACE = 'chatvia';

/**
 * Log prefix used in console messages so embedding sites can grep for it.
 */
const LOG_PREFIX = `${NAMESPACE}:`;

/* global __DEV__ */
// __DEV__ is replaced by rollup; default to false if running un-bundled.
const DEBUG_BUILD = typeof __DEV__ !== 'undefined' ? __DEV__ : false;

/**
 * Debug logger. No-op in production builds; in dev, prefixed `chatvia:` log.
 * Use this for anything informational ("starting", "thread loaded", state dumps).
 * Use console.warn / console.error directly for things customers should see.
 */
export function debug(...args) {
  if (!DEBUG_BUILD) return;
  console.log(LOG_PREFIX, ...args);
}

/**
 * Standard warn / error helpers — always log, always prefixed. Use these
 * instead of bare `console.warn`/`console.error` so the prefix stays consistent.
 */
export function warn(...args) {
  console.warn(LOG_PREFIX, ...args);
}

export function error(...args) {
  console.error(LOG_PREFIX, ...args);
}

export const CSS_CLASSES = {
  WIDGET: 'chatvia-widget',
  BUBBLE: 'chatvia-widget-bubble',
  BUBBLE_PULSE: 'chatvia-widget-pulse',
  BUBBLE_ACTIVE: 'chatvia-widget-active',
  BUBBLE_NEW_MESSAGE: 'chatvia-widget-new-message',
  WINDOW: 'chatvia-widget-window',
  WINDOW_OPEN: 'chatvia-widget-open',
  WINDOW_DARK: 'chatvia-widget-dark',
  WINDOW_ANIMATING: 'chatvia-widget-animating',
  HEADER: 'chatvia-widget-header',
  HEADER_LOGO: 'chatvia-widget-header-logo',
  HEADER_TITLE: 'chatvia-widget-header-title',
  MENU_BUTTON: 'chatvia-widget-menu-btn',
  DELETE_BUTTON: 'chatvia-widget-delete-btn',
  EXPAND_BUTTON: 'chatvia-widget-expand-btn',
  THEME_TOGGLE: 'chatvia-widget-theme-toggle',
  MENU_DROPDOWN: 'chatvia-widget-menu-dropdown',
  MENU_DROPDOWN_OPEN: 'chatvia-widget-dropdown-open',
  MENU_OPTION: 'chatvia-widget-menu-option',
  CLOSE_BUTTON: 'chatvia-widget-close-btn',
  MESSAGES_CONTAINER: 'chatvia-widget-messages',
  MESSAGE: 'chatvia-widget-message',
  MESSAGE_USER: 'chatvia-widget-user',
  MESSAGE_AGENT: 'chatvia-widget-assistant',
  MESSAGE_SYSTEM: 'chatvia-widget-system',
  MESSAGE_AVATAR: 'chatvia-widget-avatar',
  MESSAGE_BUBBLE: 'chatvia-widget-bubble-content',
  MESSAGE_ACTIONS: 'chatvia-widget-actions',
  MESSAGE_ACTION_BTN: 'chatvia-widget-action-btn',
  MESSAGE_COPY_BTN: 'chatvia-widget-copy-btn',
  MESSAGE_THUMBS_UP: 'chatvia-widget-thumbs-up',
  MESSAGE_THUMBS_DOWN: 'chatvia-widget-thumbs-down',
  MESSAGE_ACTION_ACTIVE: 'chatvia-widget-active',
  LOADING: 'chatvia-widget-loading',
  LOADING_DOTS: 'chatvia-widget-loading-dots',
  LOADING_DOT: 'chatvia-widget-dot',
  STARTERS_CONTAINER: 'chatvia-widget-starters',
  STARTER_BUTTON: 'chatvia-widget-starter-btn',
  INPUT_CONTAINER: 'chatvia-widget-input-container',
  INPUT: 'chatvia-widget-input',
  SEND_BUTTON: 'chatvia-widget-send-btn',
  BRAND_FOOTER: 'chatvia-widget-footer',
  CONFIRM_DIALOG: 'chatvia-widget-confirm-dialog',
  CONFIRM_CONTENT: 'chatvia-widget-confirm-content',
  CONFIRM_BUTTONS: 'chatvia-widget-confirm-buttons',
  CONFIRM_CANCEL: 'chatvia-widget-confirm-cancel',
  CONFIRM_DELETE: 'chatvia-widget-confirm-delete',
  THREADS_CONTAINER: 'chatvia-widget-threads',
  THREADS_LIST: 'chatvia-widget-threads-list',
  THREADS_HEADER: 'chatvia-widget-threads-header',
  NEW_CHAT_BUTTON: 'chatvia-widget-new-chat-btn',
  NO_THREADS_MESSAGE: 'chatvia-widget-no-threads',
  THREAD_ITEM: 'chatvia-widget-thread-item',
  THREAD_ITEM_ACTIVE: 'chatvia-widget-thread-active',
  THREAD_TITLE: 'chatvia-widget-thread-title',
  THREAD_DATE: 'chatvia-widget-thread-date',
  STREAMING_MESSAGE: 'chatvia-widget-streaming-msg',
  STREAMING_MESSAGE_CLASS:
    'chatvia-widget-message chatvia-widget-assistant chatvia-widget-streaming',
  MESSAGE_BUBBLES_CONTAINER: 'chatvia-widget-msg-bubbles',
  FLOATING_BUBBLE: 'chatvia-widget-floating-bubble',
  FLOATING_BUBBLE_SHOW: 'chatvia-widget-bubble-show',
  FULLSCREEN: 'chatvia-widget-fullscreen',
  WINDOW_SMALL: 'chatvia-widget-small',
  WINDOW_MEDIUM: 'chatvia-widget-medium',
  WINDOW_LARGE: 'chatvia-widget-large',
  STREAMING: 'chatvia-widget-streaming',
  TOOL_ACTIVITY: 'chatvia-widget-tool-activity',
  TOOL_CALLING: 'chatvia-widget-tool-calling',
  // Bar mode classes (the floating-bar variant of the launcher)
  BAR_CONTAINER: 'chatvia-widget-bar-container',
  BAR_CONTAINER_EXPANDED: 'chatvia-widget-expanded',
  BAR_CONTAINER_HIDDEN: 'chatvia-widget-hidden',
  BAR_POSITION_TOP: 'chatvia-widget-bar-top',
  BAR_POSITION_BOTTOM: 'chatvia-widget-bar-bottom',
  BAR_INPUT_WRAPPER: 'chatvia-widget-bar-input-wrapper',
  BAR_INPUT: 'chatvia-widget-bar-input',
  BAR_SHORTCUT_HINT: 'chatvia-widget-shortcut-hint',
  BAR_BUTTON: 'chatvia-widget-bar-btn',
  // Thread content classes
  THREAD_CONTENT: 'chatvia-widget-thread-content',
  THREAD_SUBTITLE: 'chatvia-widget-thread-subtitle',
  THREAD_ARROW_ICON: 'chatvia-widget-thread-arrow',
  // Brand
  BRAND_LOGO: 'chatvia-widget-brand-logo',
  // Position and mode classes
  FLAT_MODE: 'chatvia-widget-flat-mode',
  WINDOW_FLAT: 'chatvia-widget-flat',
  POSITION_BOTTOM_RIGHT: 'chatvia-widget-bottom-right',
  POSITION_BOTTOM_LEFT: 'chatvia-widget-bottom-left',
  // Handoff mode
  HUMAN_MODE: 'chatvia-widget-human-mode',
  MESSAGE_HUMAN_AGENT: 'chatvia-widget-human-agent',
  MESSAGE_TIME: 'chatvia-widget-message-time'
};
export const STREAMING_DONE_MARKER = '[DONE]';
export const STREAMING_FINALIZE_TIMEOUT = 5000; // ms

export const DEFAULT_AVATAR_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
    <circle cx="12" cy="7" r="4"></circle>
  </svg>
`;
export const DEFAULT_LOGO_SVG =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0yMCA0SDRjLTEuMSAwLTIgLjktMiAydjEwYzAgMS4xLjkgMiAyIDJoMTJsNCA0VjZjMC0xLjEtLjktMi0yLTJ6Ii8+PC9zdmc+';
