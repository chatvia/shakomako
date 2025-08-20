import api from './api.js';
import { PersistenceManager } from './persistence.js';

export class AgentManager {
  constructor(agentId) {
    this.agentId = agentId;
    this.persistenceId = 'chat-widget-agent-id';
    this.persistenceManager = new PersistenceManager();
  }

  async verifyClient() {
    try {
      const verifiedClient = this.getPersistedVerifiedAgent();

      if (verifiedClient === this.agentId) {
        console.log('Client already verified from cookie');
        return true;
      }

      const response = await api({
        endpoint: 'widget/agents/verify',
        method: 'GET',
        headers: {
          'X-AGENT-ID': this.agentId
        }
      });

      if (response.ok) {
        this.setPersistedVerifiedAgent(this.agentId);
        return true;
      }

      return false;
    } catch (error) {
      console.error('Error verifying agent:', error);
      return false;
    }
  }

  getPersistedVerifiedAgent() {
    return this.persistenceManager.get(this.persistenceId);
  }

  setPersistedVerifiedAgent(agentId) {
    this.persistenceManager.set(this.persistenceId, agentId);
  }
}
