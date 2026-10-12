import api from './api';
import { PersistenceManager } from './persistence';

/** Outcome of AgentManager.verifyClient(). */
export type VerificationResult = 'verified' | 'unverified' | 'error';

export class AgentManager {
  agentId: string;
  persistenceId: string;
  persistenceManager: PersistenceManager;

  constructor(agentId: string) {
    this.agentId = agentId;
    this.persistenceId = 'chat-widget-agent-id';
    this.persistenceManager = new PersistenceManager(agentId);
  }

  /**
   * Verify the agent with the backend.
   * @returns
   *   - 'verified'   cached, or the server confirmed the agent.
   *   - 'unverified' the server was reachable but rejected the agent — a real
   *                  "this agent is invalid/disabled/not allowed here" signal.
   *                  The widget should surface a signed-out state, not pass.
   *   - 'error'      the server could not be reached (network/infra). This is
   *                  NOT a statement about the agent, so callers must not treat
   *                  it as a rejection.
   *
   * Storage goes through PersistenceManager, which never throws (it degrades to
   * no-persistence). A blocked localStorage in Safari therefore no longer
   * masquerades as a verification failure — the old try/catch here swallowed
   * that SecurityError and returned false, blanking the widget.
   */
  async verifyClient(): Promise<VerificationResult> {
    if (this.getPersistedVerifiedAgent() === this.agentId) {
      console.log('Client already verified from cache');
      return 'verified';
    }

    let response;
    try {
      response = await api({
        endpoint: 'agents/verify',
        method: 'GET',
        headers: {
          'X-AGENT-ID': this.agentId
        }
      });
    } catch (error) {
      // Could not reach the verification endpoint (offline, timeout, TLS, DNS).
      console.error('chatvia: could not reach verification endpoint:', error);
      return 'error';
    }

    if (response.ok) {
      this.setPersistedVerifiedAgent(this.agentId);
      return 'verified';
    }

    return 'unverified';
  }

  getPersistedVerifiedAgent(): string | null {
    return this.persistenceManager.get(this.persistenceId);
  }

  setPersistedVerifiedAgent(agentId: string): void {
    this.persistenceManager.set(this.persistenceId, agentId);
  }
}
