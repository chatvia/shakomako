/**
 * SearchWidget - A search bar variant of the ChatWidget
 * 
 * This is a convenience wrapper that creates a ChatWidget in 'search' mode,
 * providing a floating search bar that opens a full-height slider panel.
 */

import { ChatWidget } from './widget.js';

export class SearchWidget extends ChatWidget {
  constructor(agentId, options = {}) {
    // Force search mode and merge with user options
    super(agentId, {
      mode: 'search',
      position: options.position || 'bottom',
      placeholder: options.placeholder || 'Ask a question...',
      ...options
    });
  }
}

// Also export ChatWidget for convenience
export { ChatWidget };
