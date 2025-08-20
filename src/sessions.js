import { PersistenceManager } from './persistence.js';
import api from './api.js';

export class SessionManager {
  constructor(agentId) {
    this.agentId = agentId;
    this.persistedSessionId = 'chat-widget-session-id';

    this.persistenceManager = new PersistenceManager();
  }

  async startSession() {
    try {
      const sessionId = this.getCurrentPersistedSessionId();

      if (sessionId) {
        console.log('Using existing session ID from cookie');
        return sessionId;
      }

      const response = await api({
        endpoint: 'widget/sessions',
        method: 'POST',
        headers: {
          'X-AGENT-ID': this.agentId
        }
      });

      if (!response.ok) {
        throw new Error('Failed to generate Session ID');
      }

      const data = await response.json();

      if (data.id) {
        console.log('Session ID generated:', data.id);
        this.persistenceManager.set(this.persistedSessionId, data.id);
        console.log('Session ID generated and stored in cookie');

        return data.id;
      }

      return null;
    } catch (error) {
      console.error('Error generating Session ID:', error);
      return null;
    }
  }

  getCurrentPersistedSessionId() {
    return this.persistenceManager.get(this.persistedSessionId);
  }
}
