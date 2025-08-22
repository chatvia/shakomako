import { PersistenceManager } from './persistence.js';
import api from './api.js';

export default class StorageManager {
  constructor(agentId, sessionId) {
    this.agentId = agentId;
    this.sessionId = sessionId;

    this.persistenceManager = new PersistenceManager(agentId);
    this.activeThreadPersistedId = 'chat-widget-active-thread-id';
  }

  getActiveThreadId() {
    return this.persistenceManager.get(this.activeThreadPersistedId);
  }

  setActiveThreadId(threadId) {
    this.persistenceManager.set(this.activeThreadPersistedId, threadId);
  }

  async loadThreads() {
    try {
      const response = await api({
        endpoint: 'widget/threads',
        method: 'GET',
        headers: {
          'X-AGENT-ID': this.agentId,
          'X-SESSION-ID': this.sessionId
        }
      });

      if (!response.ok) {
        throw new Error('Failed to load threads');
      }

      const data = await response.json();

      if (data.active_thread_id) {
        this.setActiveThreadId(data.active_thread_id);
      }

      return {
        threads: data.threads || [],
        activeThreadId: data.active_thread_id
      };
    } catch (error) {
      console.error('Error loading threads from API:', error);
      return { threads: [], activeThreadId: null };
    }
  }

  async createNewThread() {
    try {
      const response = await api({
        endpoint: 'widget/threads',
        method: 'POST',
        headers: {
          'X-AGENT-ID': this.agentId,
          'X-SESSION-ID': this.sessionId
        }
      });

      if (!response.ok) {
        throw new Error('Failed to create new thread');
      }

      const newThread = await response.json();

      if (newThread.id) {
        this.setActiveThreadId(newThread.id);
        console.log('New thread created and set as active:', newThread.id);
        return newThread;
      } else {
        throw new Error('Thread ID not found in create response.');
      }
    } catch (error) {
      console.error('Error creating new thread:', error);
      throw error;
    }
  }

  async deleteThread(threadId) {
    const response = await api({
      endpoint: 'widget/threads',
      method: 'DELETE',
      headers: {
        'X-AGENT-ID': this.agentId,
        'X-SESSION-ID': this.sessionId,
        'X-THREAD-ID': threadId
      }
    });

    if (!response.ok) {
      console.error('Failed to delete thread:', threadId);
      return false;
    }

    console.log('Thread deleted successfully:', threadId);

    await this.createNewThread();

    return true;
  }

  async deleteAllThreads() {
    try {
      await api({
        endpoint: 'threads/all',
        method: 'DELETE',
        headers: {
          'X-AGENT-ID': this.agentId,
          'X-SESSION-ID': this.sessionId
        }
      });
      this.setActiveThreadId(null);
      return true;
    } catch (error) {
      console.error('Error deleting all threads:', error);
      return false;
    }
  }

  async getMessages(threadId) {
    try {
      const response = await api({
        endpoint: 'widget/threads/messages',
        method: 'GET',
        headers: {
          'X-AGENT-ID': this.agentId,
          'X-SESSION-ID': this.sessionId,
          'X-THREAD-ID': threadId,
          'Cache-Control': 'no-cache'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to load messages');
      }

      return await response.json();
    } catch (error) {
      console.error(`Error loading messages for thread ${threadId}:`, error);
      return [];
    }
  }
}
