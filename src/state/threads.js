/**
 * Thread Management Module
 * Handles thread CRUD operations, history, and navigation
 */

import { CSS_CLASSES } from '../utils.js';
import { createElement, createIcon } from '../ui.js';

/**
 * Initialize threads from storage
 */
export async function initThreads(widget) {
  console.log('Initializing threads...');
  try {
    const { threads, activeThreadId } = await widget.storageManager.loadThreads();
    console.log('Loaded threads from API:', threads, 'Active ID:', activeThreadId);

    widget.threads = threads || [];
    widget.activeThreadId = activeThreadId || null;

    // Check if the stored active thread ID actually exists in the threads list
    if (widget.activeThreadId && widget.threads.length > 0) {
      const activeThreadExists = widget.threads.find(t => t.id === widget.activeThreadId);
      if (!activeThreadExists) {
        console.log('Stored active thread no longer exists, selecting first available thread');
        const firstThread = widget.threads[0];
        widget.storageManager.setActiveThreadId(firstThread.id);
        widget.activeThreadId = firstThread.id;
      }
    }

    if (widget.threads.length === 0) {
      console.log('No threads found, creating a new one...');
      await createNewThread(widget);
    }
    console.log(`Active thread ID (most recent): ${widget.activeThreadId}`);
  } catch (error) {
    console.error('Error initializing threads:', error);
    await widget.disabledChat('Could not load chat threads.');
    throw error;
  }
}

/**
 * Create a new thread
 */
export async function createNewThread(widget) {
  console.log('Requesting new thread from API...');
  try {
    const newThread = await widget.storageManager.createNewThread();
    if (newThread) {
      widget.threads.unshift(newThread);
      widget.activeThreadId = newThread.id;
      widget.messageHistory = [];
      console.log('New thread created successfully:', newThread);

      // Re-setup SSE with the new thread ID
      widget.setupSSE();

      await widget.displayHistoryMessages();
      widget._updateThreadActionButtons();
      widget.closeMenuDropdown();
      widget.scrollToBottom();

      return newThread;
    } else {
      console.error('API did not return a new thread object.');
      await widget.disabledChat('Failed to create new chat.');
      return null;
    }
  } catch (error) {
    console.error('Failed to create new thread:', error);
    await widget.disabledChat('Error creating new chat.');
    return null;
  }
}

/**
 * Get the active thread
 */
export function getActiveThread(widget) {
  const storedActiveThreadId = widget.storageManager 
    ? widget.storageManager.getActiveThreadId() 
    : widget.activeThreadId;
  return widget.threads.find(t => t.id === storedActiveThreadId);
}

/**
 * Get current active thread ID
 */
export function getCurrentActiveThreadId(widget) {
  return widget.storageManager 
    ? widget.storageManager.getActiveThreadId() 
    : widget.activeThreadId;
}

/**
 * Load the active thread's messages
 */
export async function loadActiveThread(widget) {
  widget.clearMessages();
  if (widget.inputContainer) widget.inputContainer.style.display = 'flex';

  const activeThread = getActiveThread(widget);

  if (!activeThread) {
    console.warn('loadActiveThread called with no active thread. Re-initializing.');
    try {
      await initThreads(widget);
      const potentiallyNewActiveThread = getActiveThread(widget);
      if (!potentiallyNewActiveThread) {
        console.error('Failed to establish an active thread even after re-init.');
        await widget.disabledChat('Cannot load chat.');
        return;
      }
      const messages = await widget.storageManager.getMessages(potentiallyNewActiveThread.id);
      widget.messageHistory = messages || [];
      potentiallyNewActiveThread.messages = widget.messageHistory;
      console.log(`Loaded ${widget.messageHistory.length} messages for thread ${potentiallyNewActiveThread.id}`);
      await widget.displayHistoryMessages();
      widget._updateThreadActionButtons();
      widget.scrollToBottom();
      return;
    } catch (error) {
      console.error('Error during re-initialization in loadActiveThread:', error);
      await widget.disabledChat('Cannot load chat.');
      return;
    }
  }

  console.log(`Loading messages for active thread: ${activeThread.id}`);

  try {
    const messages = await widget.storageManager.getMessages(activeThread.id);
    widget.messageHistory = messages || [];

    activeThread.messages = widget.messageHistory;
    console.log(`Loaded ${widget.messageHistory.length} messages for thread ${activeThread.id}`);
    await widget.displayHistoryMessages();

    // Check if there are any user messages in the thread
    const hasUserMessages = widget.messageHistory.some(message => {
      const messageType = message.role 
        ? widget._mapRoleToMessageType(message.role) 
        : message.type;
      return messageType === CSS_CLASSES.MESSAGE_USER;
    });

    if (hasUserMessages || activeThread.hasUserInteraction) {
      widget.hideStarters();
    } else if (
      !widget.messageHistory.length ||
      (widget.messageHistory.length === 1 &&
        (widget.messageHistory[0].role 
          ? widget._mapRoleToMessageType(widget.messageHistory[0].role) === CSS_CLASSES.MESSAGE_AGENT 
          : widget.messageHistory[0].type === CSS_CLASSES.MESSAGE_AGENT))
    ) {
      widget.showStarters();
    } else {
      widget.hideStarters();
    }

    widget._updateThreadActionButtons();
  } catch (error) {
    console.error(`Error loading messages for thread ${activeThread.id}:`, error);
    await widget.addMessage(
      CSS_CLASSES.MESSAGE_SYSTEM,
      'Error loading messages for this chat.',
      false
    );
  }
  widget.scrollToBottom();
}

/**
 * Start a new thread
 */
export async function startNewThread(widget) {
  const activeThread = getActiveThread(widget);

  // If current thread is already empty, just stay on it
  if (
    activeThread &&
    Array.isArray(activeThread.messages) &&
    activeThread.messages.length === 0
  ) {
    widget.closeMenuDropdown();
    widget.chatInput?.focus();
    return;
  }

  console.log('Starting a new thread...');
  widget.closeMenuDropdown();
  widget.clearMessages();
  widget.showLoading();

  try {
    const newThread = await createNewThread(widget);

    if (newThread) {
      if (widget.inputContainer) widget.inputContainer.style.display = 'flex';
      widget.showStarters();
      setTimeout(() => widget.chatInput?.focus(), 300);
    } else {
      throw new Error('Failed to create new thread');
    }
  } catch (error) {
    console.error('Error starting new thread:', error);
    await widget.addMessage(CSS_CLASSES.MESSAGE_SYSTEM, 'Failed to start a new chat.', false);
  } finally {
    widget.hideLoading();
  }
}

/**
 * Load chat history view
 */
export async function loadChatHistory(widget) {
  widget.closeMenuDropdown();
  widget.clearMessages();
  widget.showLoading();
  if (widget.inputContainer) widget.inputContainer.style.display = 'none';

  try {
    const { threads } = await widget.storageManager.loadThreads();
    widget.threads = threads;
    widget.activeThreadId = widget.storageManager.getActiveThreadId();
    widget.hideLoading();
    widget.hideStarters();

    const threadsContainer = createThreadsContainer(widget, threads);
    widget.messagesContainer?.appendChild(threadsContainer);
  } catch (error) {
    widget.hideLoading();
    console.error('Error loading chat history:', error);
    await widget.addMessage(CSS_CLASSES.MESSAGE_SYSTEM, 'Could not load chat history.', false);
    if (widget.inputContainer) widget.inputContainer.style.display = 'flex';
  }
}

/**
 * Delete current thread
 */
export async function deleteCurrentThread(widget, threadId) {
  if (!threadId) {
    console.error('Cannot delete thread without an ID.');
    return;
  }
  console.log(`Attempting to delete thread: ${threadId}`);
  widget.showLoading();
  try {
    const success = await widget.storageManager.deleteThread(threadId);
    widget.hideLoading();
    if (success) {
      await showDeleteSuccess(widget, threadId);
    } else {
      console.error('Failed to delete thread via API.');
    }
  } catch (error) {
    widget.hideLoading();
    console.error('Error deleting thread:', error);
  }
}

/**
 * Delete all threads
 */
export async function deleteAllThreads(widget) {
  console.log('Attempting to delete all threads via API...');
  widget.showLoading();
  try {
    const success = await widget.storageManager.deleteAllThreads();
    widget.hideLoading();

    if (success) {
      widget.threads = [];
      widget.activeThreadId = null;
      widget.messageHistory = [];
      console.log('Starting a new thread after deleting all...');
      await startNewThread(widget);
    } else {
      console.error('Failed to delete all threads via API.');
    }
  } catch (error) {
    widget.hideLoading();
    console.error('Error deleting all threads:', error);
  }
}

/**
 * Show success after deleting a thread
 */
export async function showDeleteSuccess(widget, deletedThreadId) {
  widget.threads = widget.threads.filter(t => t.id !== deletedThreadId);

  if (widget.threads.length > 0) {
    const sortedThreads = [...widget.threads].sort(
      (a, b) =>
        new Date(b.updatedAt || b.created_at || 0) - new Date(a.updatedAt || a.created_at || 0)
    );
    const nextActiveThreadId = sortedThreads[0].id;
    console.log('Setting next active thread to:', nextActiveThreadId);
    widget.storageManager.setActiveThreadId(nextActiveThreadId);
    widget.activeThreadId = nextActiveThreadId;
    
    widget.setupSSE();
    await loadActiveThread(widget);
  } else {
    console.log('No threads left after deletion. Creating a new one.');
    await startNewThread(widget);
  }
}

/**
 * Confirm delete thread dialog
 */
export function confirmDeleteThread(widget) {
  if (widget.isStreaming) {
    console.log('Preventing delete thread while streaming.');
    return;
  }

  const threadIdToDelete = widget.storageManager.getActiveThreadId();
  const threadToDelete = widget.threads.find(t => t.id === threadIdToDelete);
  if (!threadToDelete) {
    console.log('No active chat to delete.');
    return;
  }
  widget.closeMenuDropdown();
  widget._showConfirmationDialog(
    'Delete Chat',
    `Are you sure you want to delete "${threadToDelete.title || 'Untitled Chat'}"? This action cannot be undone.`,
    'Delete',
    () => deleteCurrentThread(widget, threadIdToDelete)
  );
}

/**
 * Confirm clear all threads dialog
 */
export function confirmClearAllThreads(widget) {
  widget.closeMenuDropdown();
  widget._showConfirmationDialog(
    'Delete All Chats',
    'Are you sure you want to delete ALL your chat history? This action cannot be undone.',
    'Delete All',
    () => deleteAllThreads(widget)
  );
}

/**
 * Create threads container for history view
 */
function createThreadsContainer(widget, threads) {
  const container = createElement('div', {
    className: `${CSS_CLASSES.THREADS_CONTAINER} ${CSS_CLASSES.THREADS_LIST}`
  });

  if (!threads || threads.length === 0) {
    const noThreadsMsg = createElement('p', {
      textContent: 'No chat history available.',
      className: CSS_CLASSES.NO_THREADS_MESSAGE
    });
    container.appendChild(noThreadsMsg);
  } else {
    const sortedThreads = [...threads].sort(
      (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
    );
    sortedThreads.forEach(thread => {
      const threadItem = createThreadItem(widget, thread);
      container.appendChild(threadItem);
    });
  }
  return container;
}

/**
 * Create a single thread item
 */
function createThreadItem(widget, thread) {
  const item = createElement('div', { className: CSS_CLASSES.THREAD_ITEM });
  if (thread.id === widget.activeThreadId) {
    item.classList.add(CSS_CLASSES.THREAD_ITEM_ACTIVE);
  }

  const contentContainer = createElement('div', { className: CSS_CLASSES.THREAD_CONTENT });
  
  const titleEl = createElement('div', { className: CSS_CLASSES.THREAD_TITLE });
  titleEl.textContent = thread.title || getFirstUserMessage(widget, thread) || "New conversation";
  contentContainer.appendChild(titleEl);

  const subtitleEl = createElement('div', { className: CSS_CLASSES.THREAD_SUBTITLE });
  subtitleEl.textContent = widget.settings.title || 'Chatbase AI';
  contentContainer.appendChild(subtitleEl);

  if (thread.timestamp) {
    const timestampEl = createElement('span', { 
      className: CSS_CLASSES.THREAD_DATE,
      textContent: ` • ${formatTimestamp(thread.timestamp)}`
    });
    subtitleEl.appendChild(timestampEl);
  }

  item.appendChild(contentContainer);

  const arrowIcon = createElement('div', { className: CSS_CLASSES.THREAD_ARROW_ICON });
  arrowIcon.appendChild(createIcon('arrow-right'));
  item.appendChild(arrowIcon);

  item.addEventListener('click', async () => {
    widget.storageManager.setActiveThreadId(thread.id);
    widget.activeThreadId = thread.id;
    widget.setupSSE();
    await loadActiveThread(widget);
  });

  return item;
}

/**
 * Get first user message from thread for title
 */
function getFirstUserMessage(widget, thread) {
  if (!thread.messages || !Array.isArray(thread.messages)) return null;
  
  const firstUserMessage = thread.messages.find(msg => {
    const messageType = msg.role ? widget._mapRoleToMessageType(msg.role) : msg.type;
    return messageType === CSS_CLASSES.MESSAGE_USER;
  });
  
  return firstUserMessage 
    ? firstUserMessage.content.substring(0, 50) + (firstUserMessage.content.length > 50 ? '...' : '') 
    : null;
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(timestamp) {
  if (!timestamp) return 'Unknown date';
  
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  
  if (isToday) {
    return `Today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } else if (isYesterday) {
    return `Yesterday at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } else {
    return date.toLocaleDateString([], { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  }
}

/**
 * Update thread action buttons state
 */
export function updateThreadActionButtons(widget) {
  const activeThread = getActiveThread(widget);
  let hasUserMessages = false;
  if (activeThread && Array.isArray(activeThread.messages)) {
    hasUserMessages = activeThread.messages.some(m => {
      const messageType = m.role ? widget._mapRoleToMessageType(m.role) : m.type;
      return messageType === CSS_CLASSES.MESSAGE_USER;
    });
  }

  const deleteDisabled = !hasUserMessages;
  const newChatDisabled = !hasUserMessages;

  const onlyEmptyThread =
    widget.threads.length === 1 &&
    (!activeThread || !activeThread.messages || activeThread.messages.length === 0);

  const setState = (el, disabled) => {
    if (!el) return;
    el.style.pointerEvents = disabled ? 'none' : 'auto';
    el.style.opacity = disabled ? '0.4' : '1';
    el.setAttribute('aria-disabled', disabled);
  };

  setState(widget.deleteThreadButton, deleteDisabled);
  setState(widget.newChatOption, newChatDisabled);
  setState(widget.historyOption, onlyEmptyThread);
  setState(widget.clearCurrentOption, onlyEmptyThread);
  setState(widget.clearAllOption, onlyEmptyThread);
}

