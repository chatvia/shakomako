import { PersistenceManager } from './persistence.js';
import api from './api.js';

export class SessionManager {
  constructor(agentId) {
    this.agentId = agentId;
    this.persistedSessionId = 'chat-widget-session-id';
    this.persistedThreadId = 'chat-widget-active-thread-id'; // Existing key used by StorageManager

    this.persistenceManager = new PersistenceManager(agentId);
  }

  /**
   * Initialize session and thread.
   * Always calls the backend to validate/create session and thread.
   * 
   * @returns {Promise<{sessionId: string, threadId: string, isNewSession: boolean, isNewThread: boolean}>}
   */
  async startSession() {
    try {
      const existingSessionId = this.getCurrentPersistedSessionId();
      const existingThreadId = this.getCurrentPersistedThreadId();

      const headers = {
        'X-AGENT-ID': this.agentId
      };

      // Include existing session if we have one (for HMAC validation)
      if (existingSessionId) {
        headers['X-SESSION-ID'] = existingSessionId;
        console.log('Sending existing session ID for validation:', existingSessionId);
      }

      // Include existing thread if we have one (for validation)
      if (existingThreadId) {
        headers['X-THREAD-ID'] = existingThreadId;
        console.log('Sending existing thread ID for validation:', existingThreadId);
      }

      const response = await api({
        endpoint: 'sessions/init',
        method: 'POST',
        headers
      });

      if (!response.ok) {
        throw new Error('Failed to initialize session');
      }

      const data = await response.json();

      if (!data.session_id) {
        throw new Error('No session ID returned from init');
      }

      // Update localStorage if session changed
      if (data.session_id !== existingSessionId) {
        console.log(
          data.is_new_session
            ? '✨ New session created:'
            : '🔄 Session restored from server:',
          data.session_id
        );
        this.persistenceManager.set(this.persistedSessionId, data.session_id);
      } else {
        console.log('✅ Session validated:', data.session_id);
      }

      // Note: Thread ID persistence is handled by StorageManager.setActiveThreadId()
      // We just log the status here
      if (data.thread_id) {
        if (data.thread_id !== existingThreadId) {
          console.log(
            data.is_new_thread
              ? '✨ New thread created:'
              : '🔄 Thread restored from server:',
            data.thread_id
          );
        } else {
          console.log('✅ Thread validated:', data.thread_id);
        }
      }

      return {
        sessionId: data.session_id,
        threadId: data.thread_id,
        isNewSession: data.is_new_session || false,
        isNewThread: data.is_new_thread || false
      };
    } catch (error) {
      console.error('Error initializing session:', error);
      return null;
    }
  }

  getCurrentPersistedSessionId() {
    return this.persistenceManager.get(this.persistedSessionId);
  }

  getCurrentPersistedThreadId() {
    return this.persistenceManager.get(this.persistedThreadId);
  }
}
