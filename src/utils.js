export const CSS_CLASSES = {
  WIDGET: 'chat-widget',
  BUBBLE: 'chat-bubble',
  BUBBLE_PULSE: 'pulse',
  BUBBLE_ACTIVE: 'active',
  BUBBLE_NEW_MESSAGE: 'new-message',
  WINDOW: 'chat-window',
  WINDOW_OPEN: 'open',
  WINDOW_DARK: 'dark-theme',
  WINDOW_ANIMATING: 'animating',
  HEADER: 'chat-header',
  HEADER_LOGO: 'chat-header-logo',
  HEADER_TITLE: 'chat-header-title',
  MENU_BUTTON: 'chat-menu-button',
  DELETE_BUTTON: 'chat-clean-button',
  EXPAND_BUTTON: 'chat-expand-button',
  THEME_TOGGLE: 'chat-theme-toggle',
  MENU_DROPDOWN: 'chat-menu-dropdown',
  MENU_DROPDOWN_OPEN: 'open',
  MENU_OPTION: 'menu-option',
  CLOSE_BUTTON: 'chat-close',
  MESSAGES_CONTAINER: 'chat-messages',
  MESSAGE: 'message',
  MESSAGE_USER: 'user',
  MESSAGE_AGENT: 'assistant',
  MESSAGE_SYSTEM: 'system',
  MESSAGE_AVATAR: 'message-avatar',
  MESSAGE_BUBBLE: 'message-bubble',
  MESSAGE_ACTIONS: 'message-actions',
  LOADING: 'chat-loading',
  LOADING_DOTS: 'chat-loading-dots',
  LOADING_DOT: 'dot',
  STARTERS_CONTAINER: 'chat-starters-container',
  STARTER_BUTTON: 'chat-starter-button',
  INPUT_CONTAINER: 'chat-input-container',
  INPUT: 'chat-input',
  SEND_BUTTON: 'chat-send',
  BRAND_FOOTER: 'chat-brand-footer',
  CONFIRM_DIALOG: 'chat-confirm-dialog',
  CONFIRM_CONTENT: 'chat-confirm-content',
  CONFIRM_BUTTONS: 'chat-confirm-buttons',
  CONFIRM_CANCEL: 'chat-confirm-cancel',
  CONFIRM_DELETE: 'chat-confirm-delete',
  TOAST_CONTAINER: 'chat-widget-toast-container',
  TOAST: 'chat-widget-toast',
  TOAST_SHOW: 'show',
  THREADS_CONTAINER: 'threads-container',
  THREADS_HEADER: 'threads-header',
  NEW_CHAT_BUTTON: 'new-chat-button',
  NO_THREADS_MESSAGE: 'no-threads-message',
  THREAD_ITEM: 'thread-item',
  THREAD_ITEM_ACTIVE: 'active',
  THREAD_TITLE: 'thread-title',
  THREAD_DATE: 'thread-date',
  STREAMING_MESSAGE: 'streaming-message',
  STREAMING_MESSAGE_CLASS: 'message assistant streaming'
};
export const STREAMING_DONE_MARKER = '[DONE]';
export const STREAMING_FINALIZE_TIMEOUT = 5000; // ms
export const DEFAULT_PRIMARY_COLOR = '#00AEEF';
export const DEFAULT_AVATAR_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
    <circle cx="12" cy="7" r="4"></circle>
  </svg>
`;
export const DEFAULT_LOGO_SVG =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0yMCA0SDRjLTEuMSAwLTEuOTkuOS0xLjk5IDJMMiAxOGMwIDEuMS45IDIgMiAyaDE2YzEuMSAwIDItLjkgMi0yVjZjMC0xLjEtLjktMi0yLTJ6bS0xIDZINXYtMmgxNHYyeiIvPjwvc3ZnPg==';
